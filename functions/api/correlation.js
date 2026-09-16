// Correlacion cruzada (punto 9.4): dado un simbolo, calcula correlacion de Pearson sobre
// retornos diarios contra el resto de simbolos con historial en asset_historical_prices
// (nunca se golpea al proveedor externo). Solo se sugiere un camino alterno cuando la
// correlacion cae en [0.8, 1.0] Y el volumen de ambos activos se mueve en la misma
// direccion reciente (regla de confirmacion definida aqui, no especificada en el detalle
// exacto por el usuario): promedio de volumen de los ultimos 10 cierres vs los 10 previos.
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=1800' } });
const LOOKBACK_DAYS = 130;
const VOLUME_WINDOW = 10;
const MIN_CORRELATION = 0.8;

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const symbol = (url.searchParams.get('symbol') || '').slice(0, 32).toUpperCase();
  if (!symbol || !context.env.SUPABASE_URL || !context.env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Correlation service unavailable.' }, 503);
  const headers = { apikey: context.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${context.env.SUPABASE_SERVICE_ROLE_KEY}` };

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - LOOKBACK_DAYS);
  const bulkUrl = new URL(`${context.env.SUPABASE_URL}/rest/v1/asset_historical_prices`);
  bulkUrl.search = new URLSearchParams({ date: `gte.${cutoff.toISOString().slice(0, 10)}`, select: 'symbol,date,close,volume', order: 'symbol.asc,date.asc' }).toString();
  const response = await fetch(bulkUrl, { headers });
  if (!response.ok) return json({ error: 'No se pudo leer el histórico.' }, 502);
  const rows = await response.json();

  const bySymbol = new Map();
  rows.forEach(row => { if (!bySymbol.has(row.symbol)) bySymbol.set(row.symbol, []); bySymbol.get(row.symbol).push(row); });
  const target = bySymbol.get(symbol);
  if (!target || target.length < 20) return json({ symbol, suggestions: [] });

  const targetVolumeTrend = volumeTrend(target);
  const suggestions = [];
  for (const [otherSymbol, otherRows] of bySymbol) {
    if (otherSymbol === symbol || otherRows.length < 20) continue;
    const { alignedA, alignedB } = alignByDate(target, otherRows);
    if (alignedA.length < 20) continue;
    const correlation = pearson(toReturns(alignedA), toReturns(alignedB));
    if (correlation < MIN_CORRELATION) continue;
    const otherVolumeTrend = volumeTrend(alignedB);
    const confirmedByVolume = Math.sign(targetVolumeTrend) === Math.sign(otherVolumeTrend);
    suggestions.push({ symbol: otherSymbol, correlation: Number(correlation.toFixed(3)), confirmedByVolume, lastClose: Number(otherRows.at(-1).close) });
  }
  suggestions.sort((a, b) => b.correlation - a.correlation);
  return json({ symbol, suggestions: suggestions.slice(0, 5), computedAt: new Date().toISOString() });
}

function toReturns(rows) { return rows.slice(1).map((row, index) => Math.log(Number(row.close) / Number(rows[index].close))); }

function volumeTrend(rows) {
  const recent = rows.slice(-VOLUME_WINDOW);
  const prior = rows.slice(-VOLUME_WINDOW * 2, -VOLUME_WINDOW);
  if (!recent.length || !prior.length) return 0;
  const avg = list => list.reduce((sum, row) => sum + Number(row.volume || 0), 0) / list.length;
  return avg(recent) - avg(prior);
}

function alignByDate(a, b) {
  const bMap = new Map(b.map(row => [row.date, row]));
  const alignedA = []; const alignedB = [];
  a.forEach(row => { const match = bMap.get(row.date); if (match) { alignedA.push(row); alignedB.push(match); } });
  return { alignedA, alignedB };
}

function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const xs = x.slice(-n), ys = y.slice(-n);
  const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX, dy = ys[i] - meanY;
    num += dx * dy; denX += dx * dx; denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den ? num / den : 0;
}
