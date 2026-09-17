// KPIs reales para el panel de rendimiento del superadmin (punto 1 de la auditoría móvil):
// "Uso por día" sale de page_views y "Nuevos registros por semana" sale de profiles.created_at.
// No existe todavía (ni aquí ni en ningún otro endpoint) un log de latencia/errores HTTP ni de
// consultas por activo, así que esas dos gráficas se dejan fuera de este endpoint a propósito:
// el frontend las muestra como "sin datos" en vez de simular números.
import { isAdminRequestAuthorized } from '../../_shared/admin-auth.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=900' } });

const DAY_MS = 86400000;
const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export async function onRequestGet(context) {
  const { env } = context;
  if (!isAdminRequestAuthorized(context.request, env)) return json({ error: 'No autorizado.' }, 401);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ usageByDay: { labels: [], platform: [] }, registrationsByWeek: { labels: [], counts: [] } });
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
  const [usageByDay, registrationsByWeek] = await Promise.all([
    computeUsageByDay(env, headers),
    computeRegistrationsByWeek(env, headers)
  ]);
  return json({ usageByDay, registrationsByWeek, computedAt: new Date().toISOString() });
}

async function computeUsageByDay(env, headers) {
  const since = new Date(Date.now() - 7 * DAY_MS);
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/page_views`);
  url.search = new URLSearchParams({ page: 'eq.platform', created_at: `gte.${since.toISOString()}`, select: 'created_at', limit: '10000' }).toString();
  const response = await fetch(url, { headers });
  if (!response.ok) return { labels: [], platform: [] };
  const rows = await response.json();
  const buckets = new Map();
  const labels = [];
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * DAY_MS);
    const key = date.toISOString().slice(0, 10);
    buckets.set(key, 0);
    labels.push(DAY_LABELS[date.getUTCDay()]);
  }
  rows.forEach(row => { const key = String(row.created_at).slice(0, 10); if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1); });
  return { labels, platform: [...buckets.values()] };
}

async function computeRegistrationsByWeek(env, headers) {
  const since = new Date(Date.now() - 28 * DAY_MS);
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/profiles`);
  url.search = new URLSearchParams({ created_at: `gte.${since.toISOString()}`, select: 'created_at', limit: '10000' }).toString();
  const response = await fetch(url, { headers });
  if (!response.ok) return { labels: [], counts: [] };
  const rows = await response.json();
  const counts = [0, 0, 0, 0];
  const now = Date.now();
  rows.forEach(row => {
    const age = now - Date.parse(row.created_at);
    const weekIndex = 3 - Math.min(3, Math.floor(age / (7 * DAY_MS)));
    if (weekIndex >= 0 && weekIndex <= 3) counts[weekIndex] += 1;
  });
  return { labels: ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4'], counts };
}
