const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Consent audit is unavailable.' }, 503);
  const body = await request.json().catch(() => ({}));
  const version = String(body.version || '2026-09-01').slice(0, 40);
  const language = ['es', 'en', 'zh'].includes(body.language) ? body.language : 'es';
  const ccpaOptOut = body.ccpaOptOut === true;
  const timestamp = new Date().toISOString();
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unavailable';

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  let userId = null;
  let email = null;
  let fullName = null;

  if (token) {
    // Registered account: consent is tied to the authenticated Supabase user.
    const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY } });
    if (!userResponse.ok) return json({ error: 'Unauthorized.' }, 401);
    const user = await userResponse.json();
    userId = user.id;
    email = user.email;
  } else {
    // Guest entry (name + email, no Supabase Auth session) is the platform's primary
    // access path today; still record a verifiable, auditable consent row for it.
    email = String(body.email || '').trim().slice(0, 320);
    fullName = String(body.name || '').trim().slice(0, 200);
    if (!email || !EMAIL_RE.test(email)) return json({ error: 'Falta un correo válido.' }, 400);
  }

  const raw = `${userId || email}|${timestamp}|${version}|${ip}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');

  const insert = await fetch(`${env.SUPABASE_URL}/rest/v1/privacy_consents`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: userId, email, full_name: fullName, timestamp_aceptacion: timestamp, version_aviso_privacidad: version, idioma: language, ccpa_do_not_sell: ccpaOptOut, ip_origen: ip, hash_consentimiento: hash })
  });
  if (!insert.ok) return json({ error: 'Could not persist consent.' }, 502);
  return json({ acceptedAt: timestamp, version, language });
}
