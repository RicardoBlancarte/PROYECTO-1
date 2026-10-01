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

create table if not exists public.whatsapp_events (
  id bigint generated always as identity primary key,
  meta_message_id text unique,
  phone text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.whatsapp_events enable row level security;
create index if not exists whatsapp_events_phone_date_idx on public.whatsapp_events (phone, created_at desc);

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
  interval text not null check (interval in ('daily', 'weekly', 'monthly', 'yearly')),
  price_date date not null,
  close numeric not null,
  exchange text,
  asset_type text,
  last_queried_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (symbol, interval, price_date)
);

alter table public.asset_history enable row level security;

alter table public.asset_history drop constraint if exists asset_history_interval_check;
alter table public.asset_history add constraint asset_history_interval_check
  check (interval in ('daily', 'weekly', 'monthly', 'yearly'));

create index if not exists asset_history_symbol_interval_idx on public.asset_history (symbol, interval, price_date desc);
create index if not exists asset_history_last_queried_idx on public.asset_history (last_queried_at);

-- Source of truth for daily OHLCV bars. Populated once a day by the external GitHub Actions
-- pipeline (service role). Cloudflare Functions only READ this table for bulk/historical
-- analytics; they must never bulk-fetch history from the market data API again.
create table if not exists public.asset_historical_prices (
  symbol text not null,
  asset_type text,
  date date not null,
  open numeric,
  high numeric,
  low numeric,
  close numeric not null,
  volume bigint,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (symbol, date)
);

alter table public.asset_historical_prices enable row level security;
create index if not exists asset_historical_prices_symbol_date_idx on public.asset_historical_prices (symbol, date desc);

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

-- Retention policy: 126 daily bars (~6 market months), 500 weekly bars, 60 monthly bars and 5 yearly bars per symbol.
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
    and ranked.rn > case a.interval when 'daily' then 126 when 'weekly' then 500 when 'monthly' then 60 when 'yearly' then 5 else 126 end;
end;
$$;

-- FASE 2: aviso de privacidad multilingue y consentimiento de invitados.
-- La entrada "invitado" (nombre + correo, sin cuenta de Supabase Auth) es hoy el flujo
-- principal de la plataforma (premium/elite "coming soon"), asi que el consentimiento debe
-- poder registrarse tambien sin sesion autenticada para que el punto 6 sea auditable en la
-- practica y no solo para las cuentas registradas.
alter table public.privacy_consents alter column user_id drop not null;
alter table public.privacy_consents add column if not exists email text;
alter table public.privacy_consents add column if not exists full_name text;
alter table public.privacy_consents add column if not exists idioma text not null default 'es';
alter table public.privacy_consents add column if not exists ccpa_do_not_sell boolean not null default false;

alter table public.privacy_consents drop constraint if exists privacy_consents_idioma_check;
alter table public.privacy_consents add constraint privacy_consents_idioma_check check (idioma in ('es', 'en', 'zh'));

alter table public.privacy_consents drop constraint if exists privacy_consents_identity_check;
alter table public.privacy_consents add constraint privacy_consents_identity_check check (user_id is not null or email is not null);

create index if not exists privacy_consents_email_idx on public.privacy_consents (email, timestamp_aceptacion desc);

-- FASE 3: puntuacion dual liberal/conservadora de noticias (News Box, punto 8) y
-- persistencia de sesion server-side para cuentas autenticadas (punto 7).
alter table public.asset_news_scores add column if not exists liberal_impact numeric check (liberal_impact between -10 and 10);
alter table public.asset_news_scores add column if not exists conservative_impact numeric check (conservative_impact between -10 and 10);
alter table public.asset_news_scores add column if not exists scoring_method text not null default 'heuristic';
alter table public.asset_news_scores drop constraint if exists asset_news_scores_scoring_method_check;
alter table public.asset_news_scores add constraint asset_news_scores_scoring_method_check check (scoring_method in ('heuristic', 'llm'));

-- El invitado (nombre + correo, sin cuenta) sigue usando localStorage; esta tabla es solo
-- para cuando la cuenta autenticada (premium/elite) este activa, protegida por RLS propia.
create table if not exists public.user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  portfolio jsonb not null default '[]'::jsonb,
  last_asset_key text,
  prediction_horizon text check (prediction_horizon in ('daily', 'weekly', 'monthly')),
  chart_range text check (chart_range in ('1d', '1w', '1m', '3m', '1y', '2y')),
  risk_posture text check (risk_posture in ('conservative', 'open')),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.user_state enable row level security;

drop policy if exists "users manage their own state" on public.user_state;
create policy "users manage their own state"
on public.user_state for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- FASE 4: motor de prediccion por senales binarias (punto 9). Una fila por activo/fecha
-- (no 30 columnas fijas), llenada por lectura derivada de asset_historical_prices, nunca
-- escribiendo sobre ella. La llena actualizar_automatico.py como parte de la misma cascada
-- diaria que ya hace el upsert de precios, no un cron/Edge Function paralelo.
create table if not exists public.asset_signals (
  symbol text not null,
  date date not null,
  signal smallint not null check (signal in (0, 1)),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (symbol, date)
);

alter table public.asset_signals enable row level security;
create index if not exists asset_signals_symbol_date_idx on public.asset_signals (symbol, date desc);

-- Historial diario del Win Rate de ambos motores (el actual "legacy" y el nuevo "shadow_v2"
-- de senales/patrones), para poder comparar antes de decidir promover el motor nuevo a
-- produccion. Lo llena la misma cascada de actualizar_automatico.py, no un cron aparte.
create table if not exists public.win_rate_history (
  date date not null,
  engine text not null check (engine in ('legacy', 'shadow_v2')),
  global_win_rate numeric,
  details jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default timezone('utc', now()),
  primary key (date, engine)
);

alter table public.win_rate_history enable row level security;

-- Patron sin precedente historico exacto para esa ventana (9.3): se calcula en
-- functions/api/patterns.js y se persiste aqui para auditoria, junto al resto del snapshot.
alter table public.asset_pattern_snapshots add column if not exists is_singularity boolean not null default false;

-- FASE 5: alertas por Web Push (punto 12), reemplaza WhatsApp para el semaforo de activos.
-- La meta y el simbolo viven en la propia fila de suscripcion (autocontenida): el invitado
-- (nombre+correo, sin cuenta) es hoy el 100% de la base real de usuarios, y su portafolio
-- solo vive en localStorage, nunca en Supabase, asi que un cron server-side no puede evaluar
-- "cambio de fase respecto a la meta" si la meta no viaja con la suscripcion. user_id/email
-- quedan opcionales para cuando exista una cuenta autenticada real.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null,
  keys_p256dh text not null,
  keys_auth text not null,
  asset_symbol text not null,
  goal numeric not null,
  last_phase text not null default 'blue' check (last_phase in ('blue', 'yellow', 'red')),
  user_id uuid references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (endpoint, asset_symbol)
);

alter table public.push_subscriptions enable row level security;
create index if not exists push_subscriptions_asset_symbol_idx on public.push_subscriptions (asset_symbol);

-- FASE 6: tour de bienvenida (punto 10) y contador de visitas del panel de superadmin (punto 14).
alter table public.profiles add column if not exists has_completed_onboarding boolean not null default false;

-- Log simple de vistas (una fila por carga de página, no una cuenta agregada) para poder
-- evolucionar despues a "sesiones unicas" sin rehacer nada, tal como se pidio explicitamente.
create table if not exists public.page_views (
  id bigint generated always as identity primary key,
  page text not null check (page in ('platform', 'homepage')),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.page_views enable row level security;
create index if not exists page_views_page_created_idx on public.page_views (page, created_at desc);

-- FASE 7: persistencia real de las sugerencias enviadas desde el botón "Sugerencias" de la
-- cintilla superior (antes se perdían: el handler solo limpiaba el campo y mostraba un toast).
-- Se inserta vía functions/api/suggestions.js con service role (igual que privacy-consent.js),
-- para que un invitado sin sesión de Supabase también pueda enviar una sugerencia.
create table if not exists public.user_suggestions (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  email text,
  full_name text,
  message text not null,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.user_suggestions enable row level security;
create index if not exists user_suggestions_created_idx on public.user_suggestions (created_at desc);

-- Misma politica que "authenticated users can view profiles": deja que el panel de
-- superadmin (pestaña Sugerencias del modal de Usuarios) lea el listado con supabaseClient,
-- igual que ya hace loadUsers() contra profiles.
create policy "authenticated users can view suggestions"
on public.user_suggestions for select to authenticated using (true);

-- MOTOR V2 — FASE A (puntos 2 y 3 de la instrucción de calibración matemática): representación
-- vectorial de patrones (retorno, volumen) con distancia de Mahalanobis y kernel continuo, en
-- lugar de la señal binaria 1/0 del motor shadow_v2 existente (asset_signals /
-- asset_pattern_snapshots, que NO se tocan). Todo esto vive en tablas nuevas, se calcula en
-- functions/api/patterns-vectors.js (endpoint aparte, no enlazado desde ninguna UI) y no se
-- integra a la cascada de actualizar_automatico.py en esta fase.
--
-- Cache de auditoría de los vectores (r_t, v_t) por símbolo/horizonte/fecha, normalizados por
-- MAD contra el propio historial del activo. Solo se persisten los últimos N por llamada
-- (ver PERSIST_LIMIT en el endpoint); el cálculo de Sigma/N/W_total en memoria usa el
-- historial completo disponible en asset_historical_prices, no lo que quede persistido aquí.
create table if not exists public.asset_pattern_vectors (
  symbol text not null,
  horizon text not null check (horizon in ('daily', 'weekly', 'monthly')),
  date date not null,
  return_mad_norm numeric not null,
  volume_mad_norm numeric not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (symbol, horizon, date)
);

alter table public.asset_pattern_vectors enable row level security;
create index if not exists asset_pattern_vectors_symbol_horizon_date_idx
  on public.asset_pattern_vectors (symbol, horizon, date desc);

-- Snapshot del motor vectorial: probabilidad candidata (kernel-weighted, sin clamp artificial:
-- una media ponderada de valores en [0,1] ya queda en [0,1] por construcción), más N, W_total,
-- N_min (regla de Silverman) y la etiqueta de confianza del punto 3. Una fila por
-- símbolo/horizonte, sobrescrita en cada cálculo (mismo patrón que asset_pattern_snapshots).
create table if not exists public.asset_pattern_vectors_snapshots (
  symbol text not null,
  horizon text not null check (horizon in ('daily', 'weekly', 'monthly')),
  probability_up numeric not null check (probability_up between 0 and 1),
  n_patterns integer not null,
  n_min numeric not null,
  w_total numeric not null,
  sigma_scale numeric not null,
  range_used numeric not null,
  pattern_confidence_label text not null
    check (pattern_confidence_label in ('historial_insuficiente', 'anomalia_genuina', 'precedente_solido')),
  model_notes jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default timezone('utc', now()),
  primary key (symbol, horizon)
);

alter table public.asset_pattern_vectors_snapshots enable row level security;

-- MOTOR V2 — FASE B, sub-fase 1 (Punto 1 de la instrucción de calibración matemática): Factor
-- de Sensibilidad bayesiano. El modelo legacy no tiene ni Markov ni Monte Carlo reales (son
-- etiquetas de UI sobre una fórmula cerrada `precio*(1+sigma*step)`); lo único real y fijo es
-- la constante `step` por horizonte en index.html (PREDICTION_HORIZON: .21/.55/1.15), que nunca
-- se calibró. Esta tabla guarda la versión bayesiana (Student-t, MAD, por símbolo+horizonte) de
-- ese factor, calculada en functions/api/sensitivity-factor.js (endpoint aparte, admin-gated,
-- no enlazado desde ninguna UI). No se toca index.html ni la cascada de
-- actualizar_automatico.py en esta sub-fase.
create table if not exists public.asset_sensitivity_factor (
  symbol text not null,
  horizon text not null check (horizon in ('daily', 'weekly', 'monthly')),
  sensitivity_factor numeric not null,
  prior_mean numeric not null,
  tau_scale numeric not null,
  degrees_of_freedom numeric not null,
  sample_kurtosis numeric not null,
  n_observations integer not null,
  iterations integer not null,
  model_notes jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default timezone('utc', now()),
  primary key (symbol, horizon)
);

alter table public.asset_sensitivity_factor enable row level security;

-- MOTOR V2 — FASE B, sub-fase 2 (Punto 1, parte de la matriz de Markov): matriz de transición
-- real de 3 estados (bajista/neutral/alcista), estimada en pasos DIARIOS (no re-muestreada a
-- semanal/mensual: una matriz de transición necesita mucha más muestra por celda que una
-- regresión escalar, y B1 ya mostró que mensual no tiene suficiente profundidad histórica
-- todavía). Los horizontes semanal/mensual se derivan elevando esta misma matriz a una potencia
-- (P^5, P^21), no reajustando con menos datos — por eso no hay columna de horizonte aquí. Se
-- calcula en functions/api/markov-matrix.js (endpoint aparte, admin-gated, no enlazado desde
-- ninguna UI), solo lectura sobre asset_historical_prices.
--
-- Sin inclinar por skewness (corregido antes de desplegar nada: inclinar la matriz de
-- transición con la asimetría muestral era un error de categoría — la asimetría mide forma/
-- magnitud de colas, no frecuencia de transición entre terciles, y alejaba la estacionaria de
-- (1/3,1/3,1/3), que es la frecuencia marginal real por construcción). `sample_skewness` se
-- guarda igual, como dato informativo para la Fase B3 (Monte Carlo: magnitud de movimiento
-- dentro de cada estado + semi-desviación del VaR), no para ajustar esta matriz.
create table if not exists public.asset_markov_matrix (
  symbol text primary key,
  low_threshold numeric not null,
  high_threshold numeric not null,
  sample_skewness numeric not null,
  transition_matrix jsonb not null,
  current_state text not null check (current_state in ('bajista', 'neutral', 'alcista')),
  n_observations integer not null,
  model_notes jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default timezone('utc', now())
);

alter table public.asset_markov_matrix enable row level security;

-- MOTOR V2 — FASE B, sub-fase 3 (Punto 1, la parte de Monte Carlo): Filtered Historical
-- Simulation con remuestreo ponderado (lambda_pool^antiguedad * exp(-Mahalanobis), kernel de
-- Fase A recalculado fresco), nunca una Student-t parametrica. Se calcula en Python
-- (montecarlo_engine.py, invocado desde actualizar_automatico.py — no cabe en 10ms de
-- Cloudflare Workers Free), no en una Pages Function. Esta tabla es la UNICA escritura del
-- paso de Monte Carlo; se lee de solo lectura desde functions/api/montecarlo.js.
--
-- lambda_pool queda fijo en 1.0 en produccion (ver LAMBDA_POOL_MODE en montecarlo_engine.py):
-- validado con sinteticos de propiedades conocidas que a la profundidad real de datos
-- (~760 dias) la calibracion por validacion cruzada no separa de forma confiable un pool
-- estable de uno con cambio de regimen (si separa con mas datos, confirmado a n=5000) — se
-- reactivara tras un backfill historico real. model_notes.lambda_pool_at_boundary=true NO es
-- un error: significa pool sin decaimiento por antiguedad (deliberado en este modo, o genuino
-- si algun dia se recalibra y no se detecta cambio de regimen).
--
-- Volatilidad vía GARCH(1,1) con Student-t (garch_omega/alpha/beta), no una recursion EWMA:
-- la EWMA usada originalmente era tipo IGARCH (coeficientes sumando exactamente 1, solo
-- marginalmente estable) y mostro retroalimentacion real en produccion para INTC/META (sigma
-- explotando 12x-42x en trayectorias mensuales). Un GARCH con alpha+beta<1 estricto es estable
-- por construccion. garch_persistence_at_boundary=true NO es un error: significa que los datos
-- no muestran reversion a la media detectable. El pool de shocks tambien se renormaliza para
-- que su E[z^2] ponderado sea exactamente 1 antes de simular (ver model_notes.
-- pool_e_z2_before_rescale para el valor previo a esa correccion).
--
-- var_95/cvar_95/var_99/cvar_99/semi_deviation/quantiles estan en RETORNO SIMPLE (exp(x)-1),
-- no log — las versiones en log quedan en model_notes.log_units para quien las necesite.
create table if not exists public.asset_montecarlo_simulation (
  symbol text not null,
  horizon text not null check (horizon in ('daily', 'weekly', 'monthly')),
  n_paths integer not null,
  seed bigint not null,
  garch_omega numeric not null,
  garch_alpha numeric not null,
  garch_beta numeric not null,
  garch_persistence numeric not null,        -- alpha+beta; estacionario por construccion (<1)
  garch_half_life_days numeric,
  lambda_pool numeric not null,
  degrees_of_freedom numeric not null,
  effective_sample_size numeric not null,
  n_min_threshold numeric not null,          -- N_min de Silverman (Fase A), para contrastar el ESS
  pool_size integer not null,
  probability_up numeric not null check (probability_up between 0 and 1),
  quantiles jsonb not null,                  -- {p5,p10,p25,p50,p75,p90,p95}, retorno simple
  var_95 numeric not null,
  cvar_95 numeric not null,
  var_99 numeric not null,
  cvar_99 numeric not null,
  semi_deviation numeric not null,
  sample_skewness_classical numeric not null,
  sample_skewness_robust numeric not null,   -- Bowley, cuantiles
  realized_skewness_simulated numeric not null,
  news_uncertainty_variance numeric not null default 0,
  b1_crosscheck jsonb,                       -- snapshot de asset_sensitivity_factor al momento del calculo
  b2_crosscheck jsonb,                       -- snapshot de asset_markov_matrix al momento del calculo
  model_notes jsonb not null default '{}'::jsonb,  -- incluye lambda_pool_mode, garch_persistence_at_boundary, pool_e_z2_before_rescale, log_units
  computed_at timestamptz not null default timezone('utc', now()),
  primary key (symbol, horizon)
);

alter table public.asset_montecarlo_simulation enable row level security;
