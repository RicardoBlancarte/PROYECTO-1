const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestPost(context) {
  const { request, env } = context;
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Consent audit is unavailable.' }, 503);
  const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY } });
  if (!userResponse.ok) return json({ error: 'Unauthorized.' }, 401);
  const user = await userResponse.json();
  const { version = '2026-09-01' } = await request.json().catch(() => ({}));
  const timestamp = new Date().toISOString();
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unavailable';
  const raw = `${user.id}|${timestamp}|${version}|${ip}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const insert = await fetch(`${env.SUPABASE_URL}/rest/v1/privacy_consents`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: user.id, timestamp_aceptacion: timestamp, version_aviso_privacidad: version, ip_origen: ip, hash_consentimiento: hash })
  });
  if (!insert.ok) return json({ error: 'Could not persist consent.' }, 502);
  return json({ acceptedAt: timestamp, version });
}
