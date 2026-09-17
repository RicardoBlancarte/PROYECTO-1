// Parche interino de acceso para los endpoints de solo-lectura del panel de superadmin
// (winrate, winrate-shadow, admin/metrics, el GET de track-view). No es autenticación real:
// compara un header contra una variable de entorno. La autenticación real de todo el
// backoffice (hoy un bypass 100% client-side, ver AGENTS.md) queda como proyecto aparte.
// Si ADMIN_API_SECRET no está configurada en el entorno, se deja pasar la petición (mismo
// comportamiento que antes de este parche) para no romper despliegues que no la hayan fijado.
export function isAdminRequestAuthorized(request, env) {
  if (!env.ADMIN_API_SECRET) return true;
  return request.headers.get('X-Admin-Secret') === env.ADMIN_API_SECRET;
}
