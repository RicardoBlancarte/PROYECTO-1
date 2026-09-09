// KPI de eficacia predictiva: back-test walk-forward del modelo de patrones binarios (ventanas 3 y 5)
// contra los precios reales cacheados en asset_historical_prices. Sin llamadas a APIs externas.
const CATALOG = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'NFLX', 'AMD', 'INTC', 'JPM', 'V', 'MA', 'JNJ', 'WMT', 'PG', 'DIS', 'ASML', 'TSM', 'KO', 'GC=F', 'SI=F', 'CL=F', 'BZ=F', 'NG=F', 'HG=F', 'ZC=F', 'ZW=F', 'ZS=F', 'KC=F'];

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=1800' } });

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const wantsAll = ['1', 'true'].includes((url.searchParams.get('all') || '').toLowerCase());
  const single = (url.searchParams.get('symbol') || '').toUpperCase();
  if (!context.env.SUPABASE_URL || !context.env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase no configurado.' }, 503);
  const headers = { apikey: context.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${context.env.SUPABASE_SERVICE_ROLE_KEY}` };
  if (wantsAll) {
    const cache = caches.default;
    const cacheKey = new Request('https://asset-winrate-cache.internal/all');
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    const items = (await Promise.all(CATALOG.map(symbol => computeWinRate(context.env, headers, symbol)))).filter(Boolean).sort((a, b) => b.winRate - a.winRate);
    const response = json({ items, computedAt: new Date().toISOString() });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
  if (!single) return json({ error: 'Falta symbol o all=1.' }, 400);
  const result = await computeWinRate(context.env, headers, single);
  if (!result) return json({ error: 'Historial insuficiente para calcular Win Rate.' }, 422);
  return json(result);
}

async function computeWinRate(env, headers, symbol) {
  const endpoint = new URL(`${env.SUPABASE_URL}/rest/v1/asset_historical_prices`);
  endpoint.search = new URLSearchParams({ symbol: `eq.${symbol}`, order: 'date.asc', select: 'close,date', limit: '400' }).toString();
  const response = await fetch(endpoint, { headers });
  if (!response.ok) return null;
  const rows = await response.json();
  if (rows.length < 20) return null;
  const bits = rows.slice(1).map((row, index) => Number(row.close) >= Number(rows[index].close) ? 1 : 0);
  const scores = [3, 5].map(windowSize => backtestWindow(bits, windowSize));
  const valid = scores.filter(item => item.total > 0);
  if (!valid.length) return null;
  const hits = valid.reduce((sum, item) => sum + item.hits, 0);
  const total = valid.reduce((sum, item) => sum + item.total, 0);
  return { symbol, winRate: Number((hits / total * 100).toFixed(1)), sampleSize: total, lastClose: Number(rows.at(-1).close), asOf: rows.at(-1).date };
}

// Walk-forward: la frecuencia de cada patrón solo usa observaciones estrictamente anteriores (sin lookahead).
function backtestWindow(bits, windowSize) {
  const freq = new Map();
  const warmup = windowSize * 4;
  let hits = 0; let total = 0;
  for (let index = windowSize; index < bits.length; index += 1) {
    const pattern = bits.slice(index - windowSize, index).join('');
    const stat = freq.get(pattern);
    if (index >= warmup && stat && stat.matches >= 5) {
      const predictedUp = stat.ups / stat.matches >= 0.5;
      const actualUp = bits[index] === 1;
      if (predictedUp === actualUp) hits += 1;
      total += 1;
    }
    if (!stat) freq.set(pattern, { matches: 1, ups: bits[index] });
    else { stat.matches += 1; stat.ups += bits[index]; }
  }
  return { hits, total };
}
