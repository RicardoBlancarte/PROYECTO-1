// Bloque S (fase-3-plan.md, S2): el sitio se publica desde la raíz del repo
// (pages_build_output_dir = "."), así que sin esto se servirían docs/, schema.sql, scripts .py,
// el workflow, etc. Lista de permitidos: solo pasa lo que usa la página; todo lo demás, 404
// (un archivo nuevo queda bloqueado por defecto). _routes.json manda aquí todo menos los
// estáticos permitidos más frecuentes, para no gastar invocaciones en ellos.
const ALLOWED = [
  /^\/$/, /^\/index(\.html)?$/,                   // terminal
  /^\/admin(\.html)?$/,                            // backoffice (clave verificada en /api/admin/check)
  /^\/homepage(\/.*)?$/,                           // homepage, assets/*.png y locales/*.json
  /^\/sw\.js$/, /^\/supabase-config\.js$/,
  /^\/favicon\.png$/, /^\/logo_algorithm\.svg$/,
  /^\/functions\/_shared\/engine-params\.json$/,   // parámetros públicos del motor (decisión del usuario)
  /^\/api\//,                                      // Functions
];

const BLOCKED = /^\/(docs|\.github|\.git|functions\/(?!_shared\/engine-params\.json$)|node_modules|scratch)(\/|$)|\.(md|sql|py|pyc|toml|ya?ml|map|log|bak|tmp|example)$|(^|\/)(\.gitignore|\.dev\.vars[^/]*|\.env[^/]*|package(-lock)?\.json|wrangler\.toml|_routes\.json|shanghai-hero\.jpg\.png)$/i;

export async function onRequest(context) {
  let path;
  try { path = decodeURIComponent(new URL(context.request.url).pathname); } catch { path = ''; }
  if (path && !BLOCKED.test(path) && ALLOWED.some(rule => rule.test(path))) return context.next();
  return new Response('No encontrado.', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}
