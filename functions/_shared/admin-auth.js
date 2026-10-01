// Parche interino de acceso para los endpoints de solo-lectura/escritura del panel de
// superadmin y del motor v2 (winrate, winrate-shadow, admin/metrics, track-view,
// patterns-vectors, sensitivity-factor, markov-matrix, montecarlo). No es autenticación real:
// compara un header contra una variable de entorno. La autenticación real de todo el
// backoffice (hoy un bypass 100% client-side, ver AGENTS.md) queda como proyecto aparte.
//
// FAIL-CLOSED: si ADMIN_API_SECRET no está configurada, el endpoint responde 503 (nunca queda
// abierto). Antes dejaba pasar la petición sin autenticación si la variable no estaba fijada
// -- documentado en .dev.vars.example como conveniencia de desarrollo local, pero eso mismo
// significaba que un despliegue sin esa variable fijada por error (o un entorno nuevo) dejaba
// estos endpoints completamente abiertos sin que nadie lo notara. Ahora hay que configurar
// ADMIN_API_SECRET explícitamente, en local también (ver .dev.vars.example), para poder usar
// cualquiera de estos endpoints.
export function checkAdminAuth(request, env) {
  if (!env.ADMIN_API_SECRET) {
    return new Response(JSON.stringify({ error: 'Servicio no disponible (ADMIN_API_SECRET no configurada).' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  if (request.headers.get('X-Admin-Secret') !== env.ADMIN_API_SECRET) {
    return new Response(JSON.stringify({ error: 'No autorizado.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  return null;
}
