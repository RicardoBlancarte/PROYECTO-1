export async function onRequestGet(context) {
  const symbol = context.params.symbol || 'GCUSD';
  const endpoint = new URL('https://financialmodelingprep.com/stable/historical-price-eod/full');
  endpoint.searchParams.set('symbol', symbol);
  endpoint.searchParams.set('apikey', context.env.FMP_API_KEY);

  if (!context.env.FMP_API_KEY) {
    return Response.json({ error: 'FMP_API_KEY is not configured.' }, { status: 503 });
  }

  try {
    const response = await fetch(endpoint);
    const payload = await response.json();
    if (!response.ok) return Response.json({ error: 'FMP request failed.' }, { status: response.status });

    const historical = Array.isArray(payload) ? payload : payload.historical;
    if (!Array.isArray(historical)) return Response.json({ error: 'No historical data returned.' }, { status: 404 });

    const rows = historical.slice(0, 250).reverse();
    return Response.json({
      symbol,
      dates: rows.map(row => row.date),
      prices: rows.map(row => row.close)
    }, {
      headers: { 'Cache-Control': 'public, max-age=300' }
    });
  } catch (error) {
    return Response.json({ error: 'Unable to load market data.' }, { status: 502 });
  }
}
