// MOTOR V2 — FASE B, sub-fase 3 (Punto 1, la parte de Monte Carlo). Endpoint aparte,
// admin-gated, no enlazado desde ninguna UI. A diferencia de patterns-vectors.js/
// sensitivity-factor.js/markov-matrix.js, este NO calcula nada: el Monte Carlo corre en
// Python (montecarlo_engine.py) desde actualizar_automatico.py, porque miles de trayectorias
// no caben en el límite de 10ms de Cloudflare Workers Free. Este endpoint es un SELECT de
// solo lectura sobre lo que esa cascada ya calculó y guardó.
import { isAdminRequestAuthorized } from '../_shared/admin-auth.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function onRequestGet(context) {
  if (!isAdminRequestAuthorized(context.request, context.env)) return json({ error: 'No autorizado.' }, 401);
  const url = new URL(context.request.url);
  const symbol = (url.searchParams.get('symbol') || '').slice(0, 32).toUpperCase();
  const horizon = ['daily', 'weekly', 'monthly'].includes(url.searchParams.get('horizon')) ? url.searchParams.get('horizon') : 'daily';
  if (!symbol || !context.env.SUPABASE_URL || !context.env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Servicio no disponible.' }, 503);
  const headers = { apikey: context.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${context.env.SUPABASE_SERVICE_ROLE_KEY}` };

  const selectUrl = new URL(`${context.env.SUPABASE_URL}/rest/v1/asset_montecarlo_simulation`);
  selectUrl.search = new URLSearchParams({ symbol: `eq.${symbol}`, horizon: `eq.${horizon}`, select: '*', limit: '1' }).toString();
  const response = await fetch(selectUrl, { headers });
  if (!response.ok) return json({ error: 'No se pudo leer la simulación.' }, 502);
  const rows = await response.json();
  if (!rows.length) return json({ error: 'Todavía no hay una simulación Monte Carlo guardada para este símbolo/horizonte.' }, 404);
  return json(rows[0]);
}
