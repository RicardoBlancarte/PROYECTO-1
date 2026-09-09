// KPI de eficacia predictiva: back-test walk-forward del motor estocástico real (Markov + Monte Carlo,
// mismas fórmulas que el frontend) contra los precios reales cacheados en asset_historical_prices.
// Requiere solo 5 sesiones previas para estimar sigma, por lo que opera desde bloques de ~8-10 sesiones.
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
    const totalSamples = items.reduce((sum, item) => sum + item.sampleSize, 0);
    const globalWinRate = totalSamples ? Number((items.reduce((sum, item) => sum + item.winRate * item.sampleSize, 0) / totalSamples).toFixed(1)) : 0;
    const response = json({ items, globalWinRate, totalSamples, computedAt: new Date().toISOString() });
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
  const MIN_WINDOW = 5; // sesiones previas mínimas para estimar sigma realizada
  if (rows.length < MIN_WINDOW + 2) return null;
  const closes = rows.map(row => Number(row.close));
  const dates = rows.map(row => row.date);
  const history = [];
  for (let t = MIN_WINDOW; t < closes.length - 1; t += 1) {
    const known = closes.slice(0, t + 1);
    const returns = known.slice(1).map((close, index) => Math.log(close / known[index]));
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(returns.length - 1, 1);
    const sigma = Math.sqrt(Math.max(variance, 0)) || 0.01;
    const spot = closes[t];
    // Misma fórmula que el frontend (Markov 1D + banda Monte Carlo P10/P90).
    const markov = spot * (1 + sigma * .21);
    const p10 = markov * Math.exp(-1.2816 * sigma * .21);
    const p90 = markov * Math.exp(1.2816 * sigma * .21);
    const actual = closes[t + 1];
    const inBand = actual >= p10 && actual <= p90 ? 1 : 0;
    const proximity = Math.max(0, 1 - Math.abs(actual - markov) / (spot * Math.max(sigma, .01)));
    const score = inBand * 70 + proximity * 30;
    history.push({ date: dates[t + 1], inBand, proximity: Number(proximity.toFixed(3)), score: Number(score.toFixed(1)) });
  }
  if (!history.length) return null;
  const winRate = Number((history.reduce((sum, day) => sum + day.score, 0) / history.length).toFixed(1));
  const bandCoverage = Number((history.reduce((sum, day) => sum + day.inBand, 0) / history.length * 100).toFixed(1));
  const proximityAvg = Number((history.reduce((sum, day) => sum + day.proximity, 0) / history.length * 100).toFixed(1));
  return { symbol, winRate, bandCoverage, proximity: proximityAvg, sampleSize: history.length, lastClose: closes.at(-1), asOf: dates.at(-1), history: history.slice(-30) };
}
