const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' }
});

export async function onRequestGet(context) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = context.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: 'Public auth configuration is unavailable.' }, 503);
  return json({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
}
