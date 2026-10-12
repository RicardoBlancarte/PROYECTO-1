// Bloque S (fase-3-plan.md): verifica la clave de administrador sin exponer nada más.
// El navegador ya no compara una contraseña fija: manda la clave tecleada como X-Admin-Secret
// y este endpoint responde 200 si coincide con ADMIN_API_SECRET, 401 si no y 503 si no está
// configurada (checkAdminAuth). No lee ni escribe datos.
import { checkAdminAuth } from '../../_shared/admin-auth.js';

export async function onRequestGet(context) {
  const authError = checkAdminAuth(context.request, context.env);
  if (authError) return authError;
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
