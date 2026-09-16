// Alta/baja de suscripciones Web Push (punto 12). La fila es autocontenida (endpoint + llaves
// + símbolo + meta) porque el invitado (nombre+correo, sin cuenta) es hoy toda la base real
// de usuarios y su portafolio nunca llega a Supabase; no depende de auth.
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Push subscriptions are unavailable.' }, 503);
  const body = await request.json().catch(() => ({}));
  const endpoint = String(body.endpoint || '').slice(0, 2000);
  const p256dh = String(body.keys?.p256dh || '').slice(0, 300);
  const auth = String(body.keys?.auth || '').slice(0, 300);
  const assetSymbol = String(body.assetSymbol || '').slice(0, 32).toUpperCase();
  const goal = Number(body.goal);
  const email = body.email ? String(body.email).trim().slice(0, 320) : null;
  if (!endpoint || !p256dh || !auth || !assetSymbol || !Number.isFinite(goal) || goal <= 0) {
    return json({ error: 'Faltan campos requeridos (endpoint, keys, assetSymbol, goal).' }, 400);
  }
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
  const insert = await fetch(`${env.SUPABASE_URL}/rest/v1/push_subscriptions?on_conflict=endpoint,asset_symbol`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ endpoint, keys_p256dh: p256dh, keys_auth: auth, asset_symbol: assetSymbol, goal, email, last_phase: 'blue', updated_at: new Date().toISOString() })
  });
  if (!insert.ok) return json({ error: 'No se pudo guardar la suscripción.' }, 502);
  return json({ subscribed: true, assetSymbol });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Push subscriptions are unavailable.' }, 503);
  const body = await request.json().catch(() => ({}));
  const endpoint = String(body.endpoint || '').slice(0, 2000);
  if (!endpoint) return json({ error: 'Falta endpoint.' }, 400);
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/push_subscriptions`);
  const params = { endpoint: `eq.${endpoint}` };
  if (body.assetSymbol) params.asset_symbol = `eq.${String(body.assetSymbol).slice(0, 32).toUpperCase()}`;
  url.search = new URLSearchParams(params).toString();
  const deleted = await fetch(url, { method: 'DELETE', headers: { ...headers, Prefer: 'return=minimal' } });
  if (!deleted.ok) return json({ error: 'No se pudo eliminar la suscripción.' }, 502);
  return json({ unsubscribed: true });
}
