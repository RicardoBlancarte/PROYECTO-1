// Maneja la verificación del Webhook (GET) y la recepción/respuesta de mensajes (POST)

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

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

    // Verificamos si el evento contiene un mensaje de WhatsApp válido
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (message && message.type === "text") {
      const senderPhone = message.from; // Número del remitente (ej: 52155...)
      const userText = message.text.body;

      // 1. Consultar Supabase utilizando el teléfono del remitente
      const responseText = await querySupabaseByPhone(senderPhone, userText, context.env);

      // 2. Enviar la respuesta de vuelta a WhatsApp
      await sendWhatsAppResponse(value, senderPhone, responseText, context.env.WHATSAPP_TOKEN);
    }

    return new Response("EVENT_RECEIVED", { status: 200 });
  } catch (error) {
    console.error("Error en webhook POST:", error);
    return new Response("Error procesando webhook", { status: 500 });
  }
}

async function querySupabaseByPhone(phone, userQuery, env) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return "Error de configuración en el servidor.";
  }

  // Filtramos la tabla de clientes o usuarios por el número de teléfono
  const url = `${supabaseUrl}/rest/v1/clients?phone=eq.${phone}&select=*`;

  try {
    const response = await fetch(url, {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json"
      }
    });

    const data = await response.json();

    if (data && data.length > 0) {
      // Usuario encontrado, puedes personalizar la respuesta con sus datos
      const userData = data[0];
      return `Hola ${userData.name || ""}. Tu consulta fue recibida. Información asociada: ${userData.details || "Sin detalles adicionales"}`;
    } else {
      return "Lo sentimos, tu número no se encuentra registrado en nuestro sistema autorizado.";
    }
  } catch (err) {
    console.error("Error consultando Supabase:", err);
    return "Ocurrió un error al consultar tus datos.";
  }
}

async function sendWhatsAppResponse(value, recipientPhone, messageText, whatsappToken) {
  // Extraemos dinámicamente el Phone Number ID desde el payload de Meta
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return;

  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;

  await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${whatsappToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: recipientPhone,
      text: { body: messageText }
    })
  });
}
