const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' }
});

export async function onRequestGet(context) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = context.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: 'Public auth configuration is unavailable.' }, 503);
  return json({ url: normalizedSupabaseUrl(SUPABASE_URL, SUPABASE_ANON_KEY), anonKey: SUPABASE_ANON_KEY });
}

function normalizedSupabaseUrl(url, anonKey) { const ref = jwtRef(anonKey); return ref ? `https://${ref}.supabase.co` : url; }
function jwtRef(token) { try { const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return payload.ref || ''; } catch (error) { return ''; } }
