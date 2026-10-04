// FASE 2 de lanzamiento (Monte Carlo v2 en la gráfica; ver docs/lanzamiento/fase-2-plan.md, 2.2).
// Endpoint PÚBLICO de solo lectura, separado de /api/montecarlo (admin, select=*). Lee las filas
// que montecarlo_engine.py ya guardó (no calcula nada) y expone solo lo que dibuja la interfaz:
// probabilidad de cerrar arriba del último cierre y los cuantiles p5/p10/p25/p50/p75/p90/p95 en
// retorno simple, por horizonte. La tabla no tiene políticas RLS para anon: se lee aquí con service_role,
// del lado del servidor, y los errores son genéricos (sin nombres de tablas ni de variables).
const HORIZON_SESSIONS = { daily: 1, two_day: 2, weekly: 5, monthly: 21 };
const PUBLIC_QUANTILES = ['p5', 'p10', 'p25', 'p50', 'p75', 'p90', 'p95'];
const SYMBOL_PATTERN = /^[A-Z0-9^=.\-]{1,15}$/;
const CACHE_OK = 'public, max-age=900, stale-while-revalidate=3600';
const CACHE_NOT_FOUND = 'public, max-age=300';

const json = (body, status, cacheControl) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff' },
});
const unavailable = status => json({ error: 'Servicio no disponible por el momento.' }, status, 'no-store');

export async function onRequestGet(context) {
  const symbol = (new URL(context.request.url).searchParams.get('symbol') || '').trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) return json({ error: 'Solicitud no válida.' }, 400, 'no-store');
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return unavailable(503);

  const selectUrl = new URL(`${SUPABASE_URL}/rest/v1/asset_montecarlo_simulation`);
  selectUrl.search = new URLSearchParams({ symbol: `eq.${symbol}`, select: 'horizon,probability_up,quantiles,base_close_date,computed_at' }).toString();
  let rows;
  try {
    const response = await fetch(selectUrl, { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } });
    if (!response.ok) return unavailable(502);
    rows = await response.json();
  } catch (error) {
    return unavailable(502);
  }

  const horizons = {};
  let updatedAt = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    const point = toPublicPoint(row);
    if (!point) continue;
    horizons[row.horizon] = point;
    if (row.computed_at && (!updatedAt || row.computed_at > updatedAt)) updatedAt = row.computed_at;
  }
  if (!Object.keys(horizons).length) return json({ error: 'No disponible para este activo.' }, 404, CACHE_NOT_FOUND);
  return json({ symbol, updatedAt, horizons }, 200, CACHE_OK);
}

// Una fila incompleta o con valores fuera de rango se omite (la interfaz la muestra como
// "No disponible") en vez de publicar cifras dudosas. baseCloseDate va por horizonte: si la
// cascada actualizó unos horizontes y otros no, la interfaz compara cada uno por separado.
function toPublicPoint(row) {
  const sessions = HORIZON_SESSIONS[row?.horizon];
  const probUp = Number(row?.probability_up);
  const baseCloseDate = typeof row?.base_close_date === 'string' ? row.base_close_date : null;
  if (!sessions || !Number.isFinite(probUp) || probUp < 0 || probUp > 1 || !baseCloseDate) return null;
  const q = {};
  for (const key of PUBLIC_QUANTILES) {
    const value = Number(row.quantiles?.[key]);
    if (!Number.isFinite(value)) return null;
    q[key] = value;
  }
  return { sessions, baseCloseDate, probUp, q };
}
