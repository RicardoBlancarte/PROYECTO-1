const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

export async function onRequestGet(context) {
  const bindings = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEWS_API_KEY', 'FMP_API_KEY', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_BUSINESS_ACCOUNT_ID', 'WHATSAPP_VERIFY_TOKEN', 'META_APP_SECRET', 'WHATSAPP_TEST_RECIPIENT', 'WHATSAPP_TEST_TRIGGER_TOKEN'];
  const configured = Object.fromEntries(bindings.map(name => [name, Boolean(context.env[name])]));
  const missing = bindings.filter(name => !configured[name]);
  return json({ ok: missing.length === 0, configured, missing }, missing.length ? 503 : 200);
}
