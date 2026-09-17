// Contador de visitas del panel de superadmin (punto 14). Registro server-side simple (un
// insert por carga de página, sin deduplicación todavía) para que no sea trivial de inflar
// solo con JS del cliente; queda aislado en este archivo para poder evolucionar más adelante
// a "sesiones únicas" sin tocar nada más.
import { isAdminRequestAuthorized } from '../_shared/admin-auth.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// onRequestPost se queda público a propósito: cada visita (invitado o no) necesita poder
// registrarse sin autenticación. Solo el GET (conteo agregado, usado en el panel de
// superadmin) queda detrás del secreto interino.
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ tracked: false }, 200);
  const body = await request.json().catch(() => ({}));
  const page = ['platform', 'homepage'].includes(body.page) ? body.page : 'platform';
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
  await fetch(`${env.SUPABASE_URL}/rest/v1/page_views`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ page })
  }).catch(() => {});
  return json({ tracked: true });
}

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!isAdminRequestAuthorized(request, env)) return json({ error: 'No autorizado.' }, 401);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ platform: 0, homepage: 0, total: 0 });
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
  const [platform, homepage] = await Promise.all([
    countPage(env, headers, 'platform'),
    countPage(env, headers, 'homepage')
  ]);
  return json({ platform, homepage, total: platform + homepage });
}

async function countPage(env, headers, page) {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/page_views`);
  url.search = new URLSearchParams({ page: `eq.${page}`, select: 'id' }).toString();
  const response = await fetch(url, { headers: { ...headers, Prefer: 'count=exact', Range: '0-0' } });
  if (!response.ok) return 0;
  const range = response.headers.get('content-range') || '';
  const total = Number(range.split('/')[1]);
  return Number.isFinite(total) ? total : 0;
}
