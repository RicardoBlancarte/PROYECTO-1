-- HORIZON V2: run this script in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  folio text not null unique default ('HZ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  full_name text not null default '',
  email text not null unique,
  comments text not null default '',
  user_level text not null default 'normal' check (user_level in ('normal', 'premium', 'elite')),
  last_login timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles enable row level security;

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
