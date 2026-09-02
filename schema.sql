-- HORIZON V2: run this script in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  folio text not null unique default ('HZ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  full_name text not null default '',
  email text not null unique,
  comments text not null default '',
  user_level text not null default 'normal' check (user_level in ('normal', 'premium', 'elite')),
  privacy_accepted_at timestamptz,
  last_login timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles enable row level security;

alter table public.profiles add column if not exists privacy_accepted_at timestamptz;

create table if not exists public.privacy_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  timestamp_aceptacion timestamptz not null default timezone('utc', now()),
  version_aviso_privacidad text not null,
  ip_origen text not null,
  hash_consentimiento text not null unique
);

alter table public.privacy_consents enable row level security;
create index if not exists privacy_consents_user_idx on public.privacy_consents (user_id, timestamp_aceptacion desc);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
after update of email on auth.users
for each row execute procedure public.sync_profile_email();

-- One account type is used. These policies let signed-in users view the registry;
-- keep this policy only if the control panel is intended for all authenticated users.
create policy "authenticated users can view profiles"
on public.profiles for select to authenticated using (true);

create policy "users can update their own profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create index if not exists profiles_last_login_idx on public.profiles (last_login desc);

-- Hard historical cache for the market explorer. Populated and pruned exclusively by the
-- Cloudflare Function using the service role key; RLS blocks anon/authenticated access entirely.
create table if not exists public.asset_history (
  symbol text not null,
  interval text not null check (interval in ('daily', 'weekly', 'yearly')),
  price_date date not null,
  close numeric not null,
  exchange text,
  asset_type text,
  last_queried_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (symbol, interval, price_date)
);

alter table public.asset_history enable row level security;

create index if not exists asset_history_symbol_interval_idx on public.asset_history (symbol, interval, price_date desc);
create index if not exists asset_history_last_queried_idx on public.asset_history (last_queried_at);

-- Derived research cache, written only by Cloudflare Functions with the service role.
create table if not exists public.asset_news_scores (
  id bigint generated always as identity primary key,
  symbol text not null,
  published_at timestamptz,
  headline text not null,
  source text,
  impact_score numeric not null check (impact_score between -10 and 10),
  conservative_summary text,
  liberal_summary text,
  neutral_summary text,
  content_hash text not null unique,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists asset_news_scores_symbol_date_idx on public.asset_news_scores (symbol, published_at desc);

create table if not exists public.asset_pattern_snapshots (
  symbol text not null,
  horizon text not null check (horizon in ('daily', 'weekly', 'monthly')),
  window_size smallint not null check (window_size in (3, 5)),
  pattern text not null check (pattern ~ '^[01]+$'),
  next_up_probability numeric not null check (next_up_probability between 0 and 1),
  sample_size integer not null,
  news_adjustment numeric not null default 0 check (news_adjustment between -10 and 10),
  computed_at timestamptz not null default timezone('utc', now()),
  primary key (symbol, horizon, window_size, pattern)
);

create table if not exists public.asset_prediction_audit (
  id bigint generated always as identity primary key,
  symbol text not null,
  tier text not null check (tier in ('normal', 'premium', 'elite')),
  horizon_days smallint not null check (horizon_days between 1 and 30),
  pattern_3 text,
  pattern_5 text,
  probability_up numeric not null check (probability_up between 0 and 1),
  news_adjustment numeric not null check (news_adjustment between -10 and 10),
  model_notes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists asset_prediction_audit_symbol_date_idx on public.asset_prediction_audit (symbol, created_at desc);

alter table public.asset_news_scores enable row level security;
alter table public.asset_pattern_snapshots enable row level security;
alter table public.asset_prediction_audit enable row level security;

-- Retention policy: 126 daily bars (~6 market months), 500 weekly bars, 5 yearly bars per symbol.
-- Any symbol untouched for 3 months is dropped entirely so it is refetched fresh on next request.
create or replace function public.prune_asset_history()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.asset_history where last_queried_at < timezone('utc', now()) - interval '3 months';

  delete from public.asset_history a
  using (
    select symbol, interval, price_date,
           row_number() over (partition by symbol, interval order by price_date desc) as rn
    from public.asset_history
  ) ranked
  where a.symbol = ranked.symbol and a.interval = ranked.interval and a.price_date = ranked.price_date
    and ranked.rn > case a.interval when 'daily' then 126 when 'weekly' then 500 when 'yearly' then 5 else 126 end;
end;
$$;
