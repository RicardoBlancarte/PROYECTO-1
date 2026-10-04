-- Fase 2 — Monte Carlo v2: migración de public.asset_montecarlo_simulation
-- Aprobada por el usuario el 2026-10-03 (D1). La ejecuta el usuario en el SQL Editor de
-- Supabase el lunes 2026-10-05, DESPUÉS de verificar la corrida programada desde main
-- (fase-2-plan.md, 6.2.A) y ANTES de la corrida de la rama con only_montecarlo.
-- Ver docs/lanzamiento/fase-2-plan.md, sección 3.
--
-- Cambios:
--   1. Columna nueva base_close_date (date, nula, aditiva): fecha del cierre sobre el que se
--      simuló. La página la compara con el último cierre mostrado ("No disponible" si difiere).
--   2. CHECK de horizon: agrega 'two_day' (2 sesiones, "pasado mañana").
-- No toca RLS, la clave primaria, otras tablas ni asset_historical_prices.


-- ---------------------------------------------------------------------------
-- PASO 0 (solo lectura): confirmar el nombre real del CHECK de horizon.
-- Esperado: dos filas; la de horizon debería llamarse
-- asset_montecarlo_simulation_horizon_check (la otra es la de probability_up).
-- Si el nombre es distinto, ajustarlo en el PASO 1 antes de ejecutar.
-- ---------------------------------------------------------------------------
select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'public.asset_montecarlo_simulation'::regclass
  and contype = 'c';


-- ---------------------------------------------------------------------------
-- PASO 1: migración (transacción única).
-- ---------------------------------------------------------------------------
begin;

alter table public.asset_montecarlo_simulation
  add column if not exists base_close_date date;

alter table public.asset_montecarlo_simulation
  drop constraint asset_montecarlo_simulation_horizon_check;

alter table public.asset_montecarlo_simulation
  add constraint asset_montecarlo_simulation_horizon_check
  check (horizon in ('daily', 'two_day', 'weekly', 'monthly'));

commit;


-- ---------------------------------------------------------------------------
-- PASO 2 (solo lectura): verificación posterior.
-- ---------------------------------------------------------------------------

-- 2a. Definición del CHECK. Esperado:
--     CHECK ((horizon = ANY (ARRAY['daily'::text, 'two_day'::text, 'weekly'::text, 'monthly'::text])))
select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'public.asset_montecarlo_simulation'::regclass
  and conname = 'asset_montecarlo_simulation_horizon_check';

-- 2b. Tipo y nulabilidad de base_close_date. Esperado: data_type = date,
--     is_nullable = YES, column_default = null.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'asset_montecarlo_simulation'
  and column_name = 'base_close_date';

-- Si /api/escenarios respondiera con "columna desconocida" después de la migración,
-- recargar la caché de esquema de PostgREST:
-- notify pgrst, 'reload schema';
