const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function onRequestPost(context) {
  const { request, env } = context;
  const trigger = request.headers.get('X-WhatsApp-Test-Token');
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_TEST_RECIPIENT || !env.WHATSAPP_TEST_TRIGGER_TOKEN) return json({ error: 'WhatsApp test bindings are incomplete.' }, 503);
  if (!trigger || trigger !== env.WHATSAPP_TEST_TRIGGER_TOKEN) return json({ error: 'Unauthorized.' }, 401);
  const to = env.WHATSAPP_TEST_RECIPIENT.replace(/\D/g, '');
  const body = 'Algorithm: mensaje de prueba entregado correctamente.';
  const response = await fetch(`https://graph.facebook.com/v22.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return json({ error: 'Meta Graph API rejected the test.', details: data.error?.message || 'Unknown error' }, 502);
  return json({ sent: true, messageId: data.messages?.[0]?.id || null });
}
