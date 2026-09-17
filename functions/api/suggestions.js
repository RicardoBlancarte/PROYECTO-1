// Persiste las sugerencias del botón "Sugerencias" (antes se perdían: el handler del
// frontend solo limpiaba el campo y mostraba un toast, sin guardar nada). Mismo patrón dual
// invitado/autenticado que privacy-consent.js, porque el invitado (nombre+correo, sin cuenta
// de Supabase Auth) sigue siendo el flujo principal de la plataforma.
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'No disponible.' }, 503);
  const body = await request.json().catch(() => ({}));
  const message = String(body.message || '').trim().slice(0, 2000);
  if (!message) return json({ error: 'Falta el texto de la sugerencia.' }, 400);

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  let userId = null;
  let email = null;
  let fullName = null;

  if (token) {
    const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY } });
    if (!userResponse.ok) return json({ error: 'No autorizado.' }, 401);
    const user = await userResponse.json();
    userId = user.id;
    email = user.email;
    fullName = String(body.name || '').trim().slice(0, 200) || null;
  } else {
    email = String(body.email || '').trim().slice(0, 320) || null;
    fullName = String(body.name || '').trim().slice(0, 200) || null;
  }

  const insert = await fetch(`${env.SUPABASE_URL}/rest/v1/user_suggestions`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: userId, email, full_name: fullName, message })
  });
  if (!insert.ok) return json({ error: 'No se pudo guardar la sugerencia.' }, 502);
  return json({ saved: true });
}
