// Reads bulk/historical prices exclusively from Supabase `asset_historical_prices`, which is
// populated once a day by the external GitHub Actions pipeline. Bulk history must never be
// pulled from the market data API here (prohibited); FMP is reserved for a single point-in-time
// quote used only to fill in "today" when the daily pipeline has not run yet.
const RETENTION = { daily: 126, weekly: 500, monthly: 60, yearly: 5 };

export async function onRequestGet(context) {
  const symbol = context.params.symbol || 'GC=F';
  const url = new URL(context.request.url);
  const interval = ['daily', 'weekly', 'monthly', 'yearly'].includes(url.searchParams.get('interval')) ? url.searchParams.get('interval') : 'daily';
  if (!context.env.SUPABASE_URL || !context.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ error: 'Supabase historical store is not configured.' }, { status: 503 });
  try {
    const daily = await readDailyRows(context.env, symbol);
    if (!daily.length) return Response.json({ error: 'No historical data cached for this symbol yet.' }, { status: 404 });
    const withToday = await appendTodayQuote(context.env, symbol, daily);
    const series = interval === 'daily' ? withToday.slice(-RETENTION.daily)
      : interval === 'weekly' ? toWeekly(withToday).slice(-RETENTION.weekly)
      : interval === 'monthly' ? toMonthly(withToday).slice(-RETENTION.monthly)
      : toYearly(withToday).slice(-RETENTION.yearly);
    return jsonResponse(symbol, interval, series);
  } catch (error) { return Response.json({ error: 'Unable to load market data.' }, { status: 502 }); }
}

function jsonResponse(symbol, interval, rows) { return Response.json({ symbol, interval, dates: rows.map(row => row.date), prices: rows.map(row => Number(row.close)) }, { headers: { 'Cache-Control': 'public, max-age=300' } }); }
function headers(env) { return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }; }

async function readDailyRows(env, symbol) {
  const endpoint = new URL(`${env.SUPABASE_URL}/rest/v1/asset_historical_prices`);
  endpoint.search = new URLSearchParams({ symbol: `eq.${symbol}`, order: 'date.asc', select: 'date,close', limit: '1826' }).toString();
  const response = await fetch(endpoint, { headers: headers(env) });
  return response.ok ? response.json() : [];
}

// Point-in-time quote only (never a bulk historical pull), used solely to bridge the gap
// between "yesterday" (last row synced by the pipeline) and "today".
async function appendTodayQuote(env, symbol, rows) {
  const today = new Date().toISOString().slice(0, 10);
  if (rows.at(-1)?.date === today || !env.FMP_API_KEY) return rows;
  try {
    const endpoint = new URL('https://financialmodelingprep.com/stable/quote');
    endpoint.search = new URLSearchParams({ symbol, apikey: env.FMP_API_KEY }).toString();
    const response = await fetch(endpoint);
    if (!response.ok) return rows;
    const payload = await response.json();
    const quote = Array.isArray(payload) ? payload[0] : payload;
    if (!quote || typeof quote.price !== 'number') return rows;
    return [...rows, { date: today, close: quote.price }];
  } catch { return rows; }
}

function isoWeekKey(dateString) { const date = new Date(`${dateString}T00:00:00Z`), target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())), day = target.getUTCDay() || 7; target.setUTCDate(target.getUTCDate() + 4 - day); const start = new Date(Date.UTC(target.getUTCFullYear(), 0, 1)); return `${target.getUTCFullYear()}-W${Math.ceil((((target - start) / 86400000) + 1) / 7)}`; }
function toWeekly(rows) { const map = new Map(); rows.forEach(row => map.set(isoWeekKey(row.date), row)); return [...map.values()]; }
function toMonthly(rows) { const map = new Map(); rows.forEach(row => map.set(row.date.slice(0, 7), row)); return [...map.values()]; }
function toYearly(rows) { const map = new Map(); rows.forEach(row => map.set(row.date.slice(0, 4), row)); return [...map.values()]; }
