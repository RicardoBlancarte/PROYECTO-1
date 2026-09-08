const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && token && token === context.env.WHATSAPP_VERIFY_TOKEN) return new Response(challenge || '', { status: 200 });
  return new Response('Forbidden', { status: 403 });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID || !env.META_APP_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'WhatsApp bindings are incomplete.' }, 503);
  }
  const rawBody = await request.text();
  if (!await signatureIsValid(rawBody, request.headers.get('X-Hub-Signature-256'), env.META_APP_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid payload', { status: 400 });
  }

  const messages = payload.entry?.flatMap(entry => entry.changes || []).flatMap(change => change.value?.messages || []) || [];

  for (const message of messages) {
    try {
      await handleMessage(env, message);
    } catch (error) {
      await logEvent(env, {
        meta_message_id: message.id || null,
        phone: String(message.from || '').replace(/\D/g, ''),
        direction: 'inbound',
        event_type: 'processing_error',
        payload: { error: error.message }
      });
    }
  }

  return json({ received: messages.length });
}

async function handleMessage(env, message) {
  const phone = String(message.from || '').replace(/\D/g, '');
  if (!phone || !message.id || await alreadyProcessed(env, message.id)) return;
  const client = await findClient(env, phone);
  const name = String(client?.full_name || client?.name || '').trim().split(' ')[0];
  const tier = String(client?.user_level || client?.tier || 'free').toUpperCase();
  const reply = client ? `Hola ${name || 'cliente'}. Tu acceso ${tier} está activo en Algorithm. Escribe "portafolio" para consultar tus alertas.` : 'Hola. No encontramos un acceso activo para este número. Regístrate en Algorithm para vincular tu cuenta.';
  await logEvent(env, { meta_message_id: message.id, phone, direction: 'inbound', event_type: client ? 'known_client' : 'unknown_client', payload: { type: message.type } });
  const sent = await sendText(env, phone, reply);
  await logEvent(env, { meta_message_id: sent.messages?.[0]?.id || null, phone, direction: 'outbound', event_type: 'reply', payload: { replyTo: message.id, knownClient: Boolean(client) } });
}

async function signatureIsValid(body, signature, secret) {
  if (!signature?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  const expected = signature.slice(7).toLowerCase();
  const actual = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < actual.length; index += 1) mismatch |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return mismatch === 0;
}

function headers(env) { return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }; }
async function findClient(env, phone) { const endpoint = new URL(`${env.SUPABASE_URL}/rest/v1/clients`); endpoint.search = new URLSearchParams({ phone: `eq.${phone}`, select: '*', limit: '1' }).toString(); const response = await fetch(endpoint, { headers: headers(env) }); const rows = response.ok ? await response.json() : []; return rows[0] || null; }
async function alreadyProcessed(env, messageId) { const endpoint = new URL(`${env.SUPABASE_URL}/rest/v1/whatsapp_events`); endpoint.search = new URLSearchParams({ meta_message_id: `eq.${messageId}`, select: 'id', limit: '1' }).toString(); const response = await fetch(endpoint, { headers: headers(env) }); return response.ok && (await response.json()).length > 0; }
async function logEvent(env, row) { await fetch(`${env.SUPABASE_URL}/rest/v1/whatsapp_events`, { method: 'POST', headers: { ...headers(env), Prefer: 'return=minimal' }, body: JSON.stringify(row) }).catch(() => {}); }
async function sendText(env, to, body) { const response = await fetch(`https://graph.facebook.com/v22.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }) }); if (!response.ok) throw new Error('Meta Graph API rejected the reply.'); return response.json(); }
