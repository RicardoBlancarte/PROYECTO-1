import { resolveAsset, searchAssets, displayLabel } from '../../_shared/asset-catalog.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });

// Maps free-text names ("apple", "oro", "petróleo") to official tickers for the search UI.
// Curated list only: no external API calls, so this never touches the market data quota.
export async function onRequestGet(context) {
  const query = new URL(context.request.url).searchParams.get('q') || '';
  const exact = resolveAsset(query);
  if (exact) return json({ symbol: exact.symbol, name: exact.name, assetType: exact.assetType, display: displayLabel(exact) });
  const matches = searchAssets(query).map(entry => ({ symbol: entry.symbol, name: entry.name, assetType: entry.assetType, display: displayLabel(entry) }));
  return json({ matches });
}
