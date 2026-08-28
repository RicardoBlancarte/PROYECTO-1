// Aggregates the full FMP asset universe (stocks, ETFs, indexes, futures/commodities, forex, crypto)
// into one catalog. Edge-cached for 12h so the heavy source lists are fetched from FMP rarely.
const SOURCES = [
  { path: 'stock-list', type: 'accion' },
  { path: 'etf-list', type: 'etf' },
  { path: 'index-list', type: 'indice' },
  { path: 'commodities-list', type: 'futuro' },
  { path: 'forex-list', type: 'forex' },
  { path: 'cryptocurrency-list', type: 'cripto' }
];

export async function onRequestGet(context) {
  if (!context.env.FMP_API_KEY) {
    return Response.json({ error: 'FMP_API_KEY is not configured.' }, { status: 503 });
  }

  try {
    const lists = await Promise.all(SOURCES.map(source => fetchSource(context.env.FMP_API_KEY, source)));
    const assets = lists.flat();

    return Response.json({ count: assets.length, assets }, {
      headers: { 'Cache-Control': 'public, max-age=43200' }
    });
  } catch (error) {
    return Response.json({ error: 'Unable to load asset catalog.' }, { status: 502 });
  }
}

async function fetchSource(apiKey, source) {
  const endpoint = new URL(`https://financialmodelingprep.com/stable/${source.path}`);
  endpoint.searchParams.set('apikey', apiKey);
  const response = await fetch(endpoint);
  if (!response.ok) return [];
  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .filter(row => row && row.symbol)
    .map(row => ({
      symbol: row.symbol,
      name: row.name || row.symbol,
      exchange: row.exchangeShortName || row.exchange || source.type.toUpperCase(),
      type: source.type
    }));
}
