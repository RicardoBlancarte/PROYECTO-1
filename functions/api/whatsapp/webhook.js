export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === "algorithm_secret_2026") {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    // Aquí puedes procesar los mensajes entrantes de WhatsApp en el futuro
    return new Response("EVENT_RECEIVED", { status: 200 });
  } catch (err) {
    return new Response("Bad Request", { status: 400 });
  }
}
