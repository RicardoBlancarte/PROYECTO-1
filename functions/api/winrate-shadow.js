// Win Rate del motor de senales/patrones nuevo (punto 9.8), en paralelo al de winrate.js
// (que se deja intacto). Mismo backtest walk-forward y mismo catalogo, pero sustituye la
// formula sigma-based por el motor de patrones binarios (misma logica de estimate() en
// functions/api/patterns.js) para poder comparar ambos motores antes de decidir promover.
const CATALOG = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'NFLX', 'AMD', 'INTC', 'JPM', 'V', 'MA', 'JNJ', 'WMT', 'PG', 'DIS', 'ASML', 'TSM', 'KO', 'GC=F', 'SI=F', 'CL=F', 'BZ=F', 'NG=F', 'HG=F', 'ZC=F', 'ZW=F', 'ZS=F', 'KC=F'];
const WINDOW = 5;
const MIN_HISTORY = WINDOW + 11;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=1800' } });

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const wantsAll = ['1', 'true'].includes((url.searchParams.get('all') || '').toLowerCase());
  const single = (url.searchParams.get('symbol') || '').toUpperCase();
  if (!context.env.SUPABASE_URL || !context.env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase no configurado.' }, 503);
  const headers = { apikey: context.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${context.env.SUPABASE_SERVICE_ROLE_KEY}` };
  if (wantsAll) {
    const cache = caches.default;
    const cacheKey = new Request('https://asset-winrate-shadow-cache.internal/all');
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    const items = (await Promise.all(CATALOG.map(symbol => computeShadowWinRate(context.env, headers, symbol)))).filter(Boolean).sort((a, b) => b.winRate - a.winRate);
    const totalSamples = items.reduce((sum, item) => sum + item.sampleSize, 0);
    const globalWinRate = totalSamples ? Number((items.reduce((sum, item) => sum + item.winRate * item.sampleSize, 0) / totalSamples).toFixed(1)) : 0;
    const response = json({ engine: 'shadow_v2', items, globalWinRate, totalSamples, computedAt: new Date().toISOString() });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
  if (!single) return json({ error: 'Falta symbol o all=1.' }, 400);
  const result = await computeShadowWinRate(context.env, headers, single);
  if (!result) return json({ error: 'Historial insuficiente para calcular Win Rate.' }, 422);
  return json({ engine: 'shadow_v2', ...result });
}

// Recorre el historial igual que winrate.js, pero en vez de comparar contra la banda
// Markov/Monte Carlo sigma-based, predice la direccion (alza/baja) con la misma logica de
// patrones binarios que functions/api/patterns.js y mide la tasa de aciertos direccionales.
async function computeShadowWinRate(env, headers, symbol) {
  const endpoint = new URL(`${env.SUPABASE_URL}/rest/v1/asset_historical_prices`);
  endpoint.search = new URLSearchParams({ symbol: `eq.${symbol}`, order: 'date.asc', select: 'close,date', limit: '400' }).toString();
  const response = await fetch(endpoint, { headers });
  if (!response.ok) return null;
  const rows = await response.json();
  if (rows.length < MIN_HISTORY + 1) return null;
  const closes = rows.map(row => Number(row.close));
  const dates = rows.map(row => row.date);
  const bits = closes.slice(1).map((close, index) => close > closes[index] ? '1' : '0');

  let hits = 0; let samples = 0;
  for (let t = MIN_HISTORY; t < bits.length; t += 1) {
    const known = bits.slice(0, t);
    const pattern = known.slice(-WINDOW).join('');
    let matches = 0; let nextUps = 0;
    for (let index = WINDOW; index < known.length; index += 1) {
      if (known.slice(index - WINDOW, index).join('') !== pattern) continue;
      matches += 1;
      if (known[index] === '1') nextUps += 1;
    }
    const probabilityUp = matches ? nextUps / matches : known.filter(bit => bit === '1').length / known.length;
    const predictedUp = probabilityUp >= 0.5;
    const actualUp = bits[t] === '1';
    if (predictedUp === actualUp) hits += 1;
    samples += 1;
  }
  if (!samples) return null;
  const winRate = Number((hits / samples * 100).toFixed(1));
  return { symbol, winRate, sampleSize: samples, lastClose: closes.at(-1), asOf: dates.at(-1) };
}
