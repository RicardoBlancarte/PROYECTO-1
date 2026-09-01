// Serves historical prices for a symbol with a hard cache in Supabase (asset_history table).
// Historical bars are treated as immutable facts: once a day/week/year is stored it is only
// re-fetched from FMP when new bars are actually needed, keeping API usage to a minimum.
// Daily series are capped at roughly six market months to bound API and database usage.
const RETENTION = { daily: 126, weekly: 500, yearly: 5 };
// How stale the newest cached bar must be before we bother calling FMP again.
const STALE_MS = {
  daily: 1000 * 60 * 60 * 20,        // ~20h: at most one refetch per trading day
  weekly: 1000 * 60 * 60 * 24 * 6,   // ~6 days
  yearly: 1000 * 60 * 60 * 24 * 300  // ~10 months
};
const PRUNE_SAMPLE_RATE = 0.05; // run the retention/staleness sweep on a small fraction of requests

export async function onRequestGet(context) {
  const symbol = context.params.symbol || 'GCUSD';
  const url = new URL(context.request.url);
  const interval = ['daily', 'weekly', 'yearly'].includes(url.searchParams.get('interval')) ? url.searchParams.get('interval') : 'daily';
  const exchange = url.searchParams.get('exchange') || null;
  const assetType = url.searchParams.get('assetType') || null;

  if (!context.env.FMP_API_KEY) {
    return Response.json({ error: 'FMP_API_KEY is not configured.' }, { status: 503 });
  }

  const hasSupabase = Boolean(context.env.SUPABASE_URL && context.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    if (hasSupabase) {
      const cached = await readCachedRows(context.env, symbol, interval);
      if (cached.length && isFresh(cached, interval)) {
        await touchLastQueried(context.env, symbol, interval);
        void pruneMaybe(context.env);
        return jsonResponse(symbol, interval, cached);
      }
    }

    const rows = await fetchFromFmp(context.env.FMP_API_KEY, symbol);
    if (!rows.length) {
      if (hasSupabase) {
        const cached = await readCachedRows(context.env, symbol, interval);
        if (cached.length) return jsonResponse(symbol, interval, cached);
      }
      return Response.json({ error: 'No historical data returned.' }, { status: 404 });
    }

    if (!hasSupabase) return jsonResponse(symbol, interval, rows.slice(-RETENTION[interval]));

    const daily = rows.slice(-RETENTION.daily);
    const weekly = toWeekly(rows).slice(-RETENTION.weekly);
    const yearly = toYearly(rows).slice(-RETENTION.yearly);
    const stamped = [
      ...stampRows(daily, symbol, 'daily', exchange, assetType),
      ...stampRows(weekly, symbol, 'weekly', exchange, assetType),
      ...stampRows(yearly, symbol, 'yearly', exchange, assetType)
    ];
    await upsertRows(context.env, stamped);
    void pruneMaybe(context.env);

    const selected = interval === 'daily' ? daily : interval === 'weekly' ? weekly : yearly;
    return jsonResponse(symbol, interval, selected);
  } catch (error) {
    return Response.json({ error: 'Unable to load market data.' }, { status: 502 });
  }
}

function isFresh(cachedRows, interval) {
  const newest = cachedRows[cachedRows.length - 1];
  return Date.now() - new Date(newest.price_date).getTime() < STALE_MS[interval];
}

function jsonResponse(symbol, interval, rows) {
  return Response.json({
    symbol,
    interval,
    dates: rows.map(row => row.price_date),
    prices: rows.map(row => Number(row.close))
  }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}

async function fetchFromFmp(apiKey, symbol) {
  const endpoint = new URL('https://financialmodelingprep.com/stable/historical-price-eod/full');
  endpoint.searchParams.set('symbol', symbol);
  endpoint.searchParams.set('apikey', apiKey);
  const fiveYearsAgo = new Date();
  fiveYearsAgo.setUTCFullYear(fiveYearsAgo.getUTCFullYear() - 5);
  endpoint.searchParams.set('from', fiveYearsAgo.toISOString().slice(0, 10));

  const response = await fetch(endpoint);
  if (!response.ok) return [];
  const payload = await response.json();
  const historical = Array.isArray(payload) ? payload : payload.historical;
  if (!Array.isArray(historical)) return [];
  return historical.slice().reverse().map(row => ({ price_date: row.date, close: row.close }));
}

function stampRows(rows, symbol, interval, exchange, assetType) {
  const now = new Date().toISOString();
  return rows.map(row => ({
    symbol, interval, price_date: row.price_date, close: row.close,
    exchange, asset_type: assetType, last_queried_at: now
  }));
}

function isoWeekKey(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
  return `${target.getUTCFullYear()}-W${weekNo}`;
}

function toWeekly(rows) {
  const byWeek = new Map();
  rows.forEach(row => byWeek.set(isoWeekKey(row.price_date), row)); // rows are date-ascending, last write wins
  return [...byWeek.values()];
}

function toYearly(rows) {
  const byYear = new Map();
  rows.forEach(row => byYear.set(row.price_date.slice(0, 4), row));
  return [...byYear.values()];
}

function supabaseHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };
}

async function readCachedRows(env, symbol, interval) {
  const endpoint = new URL(`${env.SUPABASE_URL}/rest/v1/asset_history`);
  endpoint.searchParams.set('symbol', `eq.${symbol}`);
  endpoint.searchParams.set('interval', `eq.${interval}`);
  endpoint.searchParams.set('order', 'price_date.asc');
  endpoint.searchParams.set('limit', String(RETENTION[interval]));
  const response = await fetch(endpoint, { headers: supabaseHeaders(env) });
  if (!response.ok) return [];
  return response.json();
}

async function upsertRows(env, rows) {
  if (!rows.length) return;
  const endpoint = new URL(`${env.SUPABASE_URL}/rest/v1/asset_history`);
  await fetch(endpoint, {
    method: 'POST',
    headers: { ...supabaseHeaders(env), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows)
  }).catch(() => {});
}

async function touchLastQueried(env, symbol, interval) {
  const endpoint = new URL(`${env.SUPABASE_URL}/rest/v1/asset_history`);
  endpoint.searchParams.set('symbol', `eq.${symbol}`);
  endpoint.searchParams.set('interval', `eq.${interval}`);
  await fetch(endpoint, {
    method: 'PATCH',
    headers: { ...supabaseHeaders(env), Prefer: 'return=minimal' },
    body: JSON.stringify({ last_queried_at: new Date().toISOString() })
  }).catch(() => {});
}

async function pruneMaybe(env) {
  if (Math.random() > PRUNE_SAMPLE_RATE) return;
  const endpoint = new URL(`${env.SUPABASE_URL}/rest/v1/rpc/prune_asset_history`);
  await fetch(endpoint, { method: 'POST', headers: supabaseHeaders(env), body: '{}' }).catch(() => {});
}

