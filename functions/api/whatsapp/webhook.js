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
    if (
      body.object === "whatsapp_business_account" &&
      body.entry &&
      body.entry[0].changes &&
      body.entry[0].changes[0].value.messages
    ) {
      const change = body.entry[0].changes[0].value;
      const message = change.messages[0];
      
      const senderPhone = message.from; // Número de teléfono del remitente
      const messageText = message.text ? message.text.body.trim() : ""; // Texto enviado por el usuario
      const recipientId = change.metadata.phone_number_id; // ID del número de WhatsApp Business que recibe

      // Token de acceso de Meta (asegúrate de configurarlo en las variables de entorno de Cloudflare Pages como WHATSAPP_TOKEN)
      const WHATSAPP_TOKEN = context.env.WHATSAPP_TOKEN;

      if (messageText && WHATSAPP_TOKEN) {
        // 1. Identificar al usuario en tu plataforma/base de datos usando su número (senderPhone)
        // const userData = await fetchUserFromDatabase(senderPhone);

        // 2. Generar la respuesta del Asistente de IA aplicando las limitaciones de seguridad:
        // "Solo dar información exclusiva del usuario que está enviando el mensaje."
        let aiResponseText = "";

        if (messageText.toLowerCase().includes("perfil") || messageText.toLowerCase().includes("cuenta")) {
          // Ejemplo aplicando la restricción de seguridad estricta
          aiResponseText = `Hola. Validando tu número (${senderPhone}), tu acceso a Algorithm Private Intelligence Terminal se encuentra activo. (Nota de seguridad: Solo mostramos datos correspondientes a esta línea).`;
        } else {
          aiResponseText = `Hola, soy tu asistente de Algorithm. He recibido tu mensaje: "${messageText}". ¿En qué puedo ayudarte hoy dentro de tu espacio de análisis cuantitativo y geopolítico?`;
        }

        // 3. Enviar la respuesta de vuelta a WhatsApp mediante la API oficial de Meta
        await sendWhatsAppMessage(recipientId, senderPhone, aiResponseText, WHATSAPP_TOKEN);
      }
    }

    // Meta siempre exige un código 200 rápido para confirmar la recepción del webhook
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

// Función auxiliar para enviar mensajes a través de la API Graph de Meta
async function sendWhatsAppMessage(phoneNumberId, recipientPhone, messageText, token) {
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientPhone,
      type: "text",
      text: { body: messageText },
    }),
  });

  if (!response.ok) {
    const errorData = await response.text();
    console.error("Error al enviar mensaje a Meta:", errorData);
  }
}
