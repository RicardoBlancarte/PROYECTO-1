// Reads bulk/historical prices exclusively from Supabase `asset_historical_prices`, which is
// populated once a day by the external GitHub Actions pipeline (Paso A: Supabase primero,
// costo de API = 0). Bulk history must never be pulled from the market data API here.
// A live "today" quote is only fetched when the caller explicitly asks for it (?live=1,
// e.g. a refresh button), and even then it goes through a 60-minute edge cache first
// (Paso B) so repeated clicks within the hour never spend an extra API call (Paso C).
const RETENTION = { daily: 504, weekly: 500, monthly: 60, yearly: 5 };
const LIVE_QUOTE_TTL_SECONDS = 60 * 60;

export async function onRequestGet(context) {
  const symbol = context.params.symbol || 'GC=F';
  const url = new URL(context.request.url);
  const interval = ['daily', 'weekly', 'monthly', 'yearly'].includes(url.searchParams.get('interval')) ? url.searchParams.get('interval') : 'daily';
  const wantsLive = ['1', 'true'].includes((url.searchParams.get('live') || '').toLowerCase());
  if (!context.env.SUPABASE_URL || !context.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ error: 'Supabase historical store is not configured.' }, { status: 503 });
  try {
    const daily = await readDailyRows(context.env, symbol);
    if (!daily.length) return Response.json({ error: 'No historical data cached for this symbol yet.' }, { status: 404 });
    const { rows: withToday, live } = wantsLive ? await appendTodayQuoteCached(context, symbol, daily) : { rows: daily, live: false };
    const series = interval === 'daily' ? withToday.slice(-RETENTION.daily)
      : interval === 'weekly' ? toWeekly(withToday).slice(-RETENTION.weekly)
      : interval === 'monthly' ? toMonthly(withToday).slice(-RETENTION.monthly)
      : toYearly(withToday).slice(-RETENTION.yearly);
    return jsonResponse(symbol, interval, series, live);
  } catch (error) { return Response.json({ error: 'Unable to load market data.' }, { status: 502 }); }
}

function jsonResponse(symbol, interval, rows, live) { const ordered = rows.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))); const close = ordered.map(row => Number(row.close)); return Response.json({ symbol, interval, live, dates: ordered.map(row => row.date), close, prices: close }, { headers: { 'Cache-Control': 'public, max-age=300' } }); }
function headers(env) { return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }; }

async function readDailyRows(env, symbol) {
  const endpoint = new URL(`${env.SUPABASE_URL}/rest/v1/asset_historical_prices`);
  endpoint.search = new URLSearchParams({ symbol: `eq.${symbol}`, order: 'date.asc', select: 'date,close', limit: '1826' }).toString();
  const response = await fetch(endpoint, { headers: headers(env) });
  return response.ok ? response.json() : [];
}

// Explicit, user-triggered point-in-time quote only (never a bulk historical pull).
// Cached at the edge for LIVE_QUOTE_TTL_SECONDS so repeated "actualizar en vivo" clicks
// within the hour reuse the same response instead of spending another API credit.
async function appendTodayQuoteCached(context, symbol, rows) {
  const today = new Date().toISOString().slice(0, 10);
  if (rows.at(-1)?.date === today || !context.env.FMP_API_KEY) return { rows, live: false };
  const cache = caches.default;
  const cacheKey = new Request(`https://asset-quote-cache.internal/${encodeURIComponent(symbol)}`);
  const cached = await cache.match(cacheKey);
  if (cached) return { rows: [...rows, await cached.json()], live: true };
  try {
    const endpoint = new URL('https://financialmodelingprep.com/stable/quote');
    endpoint.search = new URLSearchParams({ symbol, apikey: context.env.FMP_API_KEY }).toString();
    const response = await fetch(endpoint);
    if (!response.ok) return { rows, live: false };
    const payload = await response.json();
    const quote = Array.isArray(payload) ? payload[0] : payload;
    if (!quote || typeof quote.price !== 'number') return { rows, live: false };
    const quoteRow = { date: today, close: quote.price };
    const cacheResponse = new Response(JSON.stringify(quoteRow), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${LIVE_QUOTE_TTL_SECONDS}` } });
    context.waitUntil(cache.put(cacheKey, cacheResponse));
    return { rows: [...rows, quoteRow], live: true };
  } catch { return { rows, live: false }; }
}

function isoWeekKey(dateString) { const date = new Date(`${dateString}T00:00:00Z`), target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())), day = target.getUTCDay() || 7; target.setUTCDate(target.getUTCDate() + 4 - day); const start = new Date(Date.UTC(target.getUTCFullYear(), 0, 1)); return `${target.getUTCFullYear()}-W${Math.ceil((((target - start) / 86400000) + 1) / 7)}`; }
function toWeekly(rows) { const map = new Map(); rows.forEach(row => map.set(isoWeekKey(row.date), row)); return [...map.values()]; }
function toMonthly(rows) { const map = new Map(); rows.forEach(row => map.set(row.date.slice(0, 7), row)); return [...map.values()]; }
function toYearly(rows) { const map = new Map(); rows.forEach(row => map.set(row.date.slice(0, 4), row)); return [...map.values()]; }
