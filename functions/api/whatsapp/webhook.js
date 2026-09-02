// Maneja la verificación del Webhook (GET) y la recepción de mensajes (POST)

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  // Reemplaza con tu token secreto configurado
  const VERIFY_TOKEN = "algorithm_secret_2026";

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    } else {
      return new Response("Error de verificación", { status: 403 });
    }
  }
  return new Response("Solicitud GET inválida", { status: 400 });
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    // Verificamos si el evento contiene un mensaje de WhatsApp
    if (
      body.object === "whatsapp_business_account" &&
      body.entry &&
      body.entry[0].changes &&
      body.entry[0].changes[0].value.messages
    ) {
      const change = body.entry[0].changes[0].value;
      const message = change.messages[0];
      
      // Extraemos los datos clave del remitente y el contenido
      const senderPhone = message.from; // Número de teléfono de quien envía
      const messageText = message.text ? message.text.body : ""; // Texto del mensaje
      const messageId = message.id; // ID único del mensaje

      console.log(`Mensaje recibido de ${senderPhone}: "${messageText}" (ID: ${messageId})`);

      // Aquí puedes agregar la lógica para guardar en Supabase o responder automáticamente
    }

    // Meta siempre espera una respuesta HTTP 200 rápida para confirmar la recepción
    return new Response(JSON.stringify({ status: "success" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error procesando el webhook POST:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
