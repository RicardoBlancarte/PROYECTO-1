const RETENTION = { daily: 126, weekly: 500, monthly: 60, yearly: 5 };
const STALE_MS = { daily: 1000 * 60 * 60 * 20, weekly: 1000 * 60 * 60 * 24 * 6, monthly: 1000 * 60 * 60 * 24 * 27, yearly: 1000 * 60 * 60 * 24 * 300 };
const PRUNE_SAMPLE_RATE = 0.05;

export async function onRequestGet(context) {
  const symbol = context.params.symbol || 'GCUSD';
  const url = new URL(context.request.url);
  const interval = ['daily', 'weekly', 'monthly', 'yearly'].includes(url.searchParams.get('interval')) ? url.searchParams.get('interval') : 'daily';
  const exchange = url.searchParams.get('exchange') || null;
  const assetType = url.searchParams.get('assetType') || null;
  if (!context.env.FMP_API_KEY) return Response.json({ error: 'FMP_API_KEY is not configured.' }, { status: 503 });
  const hasSupabase = Boolean(context.env.SUPABASE_URL && context.env.SUPABASE_SERVICE_ROLE_KEY);
  try {
    if (hasSupabase) {
      const cached = await readCachedRows(context.env, symbol, interval);
      if (cached.length && isFresh(cached, interval)) { await touchLastQueried(context.env, symbol, interval); void pruneMaybe(context.env); return jsonResponse(symbol, interval, cached); }
    }
    const rows = await fetchFromFmp(context.env.FMP_API_KEY, symbol);
    if (!rows.length) {
      if (hasSupabase) { const cached = await readCachedRows(context.env, symbol, interval); if (cached.length) return jsonResponse(symbol, interval, cached); }
      return Response.json({ error: 'No historical data returned.' }, { status: 404 });
    }
    if (!hasSupabase) return jsonResponse(symbol, interval, rows.slice(-RETENTION[interval]));
    const daily = rows.slice(-RETENTION.daily), weekly = toWeekly(rows).slice(-RETENTION.weekly), monthly = toMonthly(rows).slice(-RETENTION.monthly), yearly = toYearly(rows).slice(-RETENTION.yearly);
    await upsertRows(context.env, [...stampRows(daily, symbol, 'daily', exchange, assetType), ...stampRows(weekly, symbol, 'weekly', exchange, assetType), ...stampRows(monthly, symbol, 'monthly', exchange, assetType), ...stampRows(yearly, symbol, 'yearly', exchange, assetType)]);
    void pruneMaybe(context.env);
    return jsonResponse(symbol, interval, interval === 'daily' ? daily : interval === 'weekly' ? weekly : interval === 'monthly' ? monthly : yearly);
  } catch (error) { return Response.json({ error: 'Unable to load market data.' }, { status: 502 }); }
}

function isFresh(rows, interval) { return Date.now() - new Date(rows.at(-1).price_date).getTime() < STALE_MS[interval]; }
function jsonResponse(symbol, interval, rows) { return Response.json({ symbol, interval, dates: rows.map(row => row.price_date), prices: rows.map(row => Number(row.close)) }, { headers: { 'Cache-Control': 'public, max-age=300' } }); }
async function fetchFromFmp(apiKey, symbol) { const endpoint = new URL('https://financialmodelingprep.com/stable/historical-price-eod/full'); endpoint.search = new URLSearchParams({ symbol, apikey: apiKey, from: new Date(Date.UTC(new Date().getUTCFullYear() - 5, new Date().getUTCMonth(), new Date().getUTCDate())).toISOString().slice(0, 10) }).toString(); const response = await fetch(endpoint); if (!response.ok) return []; const payload = await response.json(), historical = Array.isArray(payload) ? payload : payload.historical; return Array.isArray(historical) ? historical.slice().reverse().map(row => ({ price_date: row.date, close: row.close })) : []; }
function stampRows(rows, symbol, interval, exchange, assetType) { const now = new Date().toISOString(); return rows.map(row => ({ symbol, interval, price_date: row.price_date, close: row.close, exchange, asset_type: assetType, last_queried_at: now })); }
function isoWeekKey(dateString) { const date = new Date(`${dateString}T00:00:00Z`), target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())), day = target.getUTCDay() || 7; target.setUTCDate(target.getUTCDate() + 4 - day); const start = new Date(Date.UTC(target.getUTCFullYear(), 0, 1)); return `${target.getUTCFullYear()}-W${Math.ceil((((target - start) / 86400000) + 1) / 7)}`; }
function toWeekly(rows) { const map = new Map(); rows.forEach(row => map.set(isoWeekKey(row.price_date), row)); return [...map.values()]; }
function toMonthly(rows) { const map = new Map(); rows.forEach(row => map.set(row.price_date.slice(0, 7), row)); return [...map.values()]; }
function toYearly(rows) { const map = new Map(); rows.forEach(row => map.set(row.price_date.slice(0, 4), row)); return [...map.values()]; }
function headers(env) { return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }; }
async function readCachedRows(env, symbol, interval) { const endpoint = new URL(`${env.SUPABASE_URL}/rest/v1/asset_history`); endpoint.search = new URLSearchParams({ symbol: `eq.${symbol}`, interval: `eq.${interval}`, order: 'price_date.asc', limit: String(RETENTION[interval]) }).toString(); const response = await fetch(endpoint, { headers: headers(env) }); return response.ok ? response.json() : []; }
async function upsertRows(env, rows) { if (!rows.length) return; await fetch(`${env.SUPABASE_URL}/rest/v1/asset_history`, { method: 'POST', headers: { ...headers(env), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) }).catch(() => {}); }
async function touchLastQueried(env, symbol, interval) { const endpoint = new URL(`${env.SUPABASE_URL}/rest/v1/asset_history`); endpoint.search = new URLSearchParams({ symbol: `eq.${symbol}`, interval: `eq.${interval}` }).toString(); await fetch(endpoint, { method: 'PATCH', headers: { ...headers(env), Prefer: 'return=minimal' }, body: JSON.stringify({ last_queried_at: new Date().toISOString() }) }).catch(() => {}); }
async function pruneMaybe(env) { if (Math.random() > PRUNE_SAMPLE_RATE) return; await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/prune_asset_history`, { method: 'POST', headers: headers(env), body: '{}' }).catch(() => {}); }
