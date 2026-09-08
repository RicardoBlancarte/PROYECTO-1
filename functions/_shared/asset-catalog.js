// Curated ticker catalog for the search/alias layer. Not a route: Pages ignores "_" folders.
// Tickers follow the same convention as the asset_historical_prices pipeline (Yahoo-style).
export const ASSET_CATALOG = [
  { symbol: 'AAPL', name: 'Apple Inc.', assetType: 'accion', aliases: ['apple', 'manzana'] },
  { symbol: 'MSFT', name: 'Microsoft Corporation', assetType: 'accion', aliases: ['microsoft'] },
  { symbol: 'TSLA', name: 'Tesla, Inc.', assetType: 'accion', aliases: ['tesla'] },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', assetType: 'accion', aliases: ['google', 'alphabet'] },
  { symbol: 'AMZN', name: 'Amazon.com, Inc.', assetType: 'accion', aliases: ['amazon'] },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', assetType: 'accion', aliases: ['nvidia'] },
  { symbol: 'GC=F', name: 'Gold', assetType: 'futuro', aliases: ['oro', 'gold'] },
  { symbol: 'SI=F', name: 'Silver', assetType: 'futuro', aliases: ['plata', 'silver'] },
  { symbol: 'CL=F', name: 'Crude Oil WTI', assetType: 'futuro', aliases: ['petroleo', 'petróleo', 'crude oil', 'wti'] },
  { symbol: 'BZ=F', name: 'Crude Oil Brent', assetType: 'futuro', aliases: ['petroleo brent', 'brent'] },
  { symbol: 'HG=F', name: 'Copper', assetType: 'futuro', aliases: ['cobre', 'copper'] },
  { symbol: 'NG=F', name: 'Natural Gas', assetType: 'futuro', aliases: ['gas natural', 'natural gas'] },
  { symbol: 'BTC-USD', name: 'Bitcoin', assetType: 'cripto', aliases: ['bitcoin', 'btc'] },
  { symbol: 'ETH-USD', name: 'Ethereum', assetType: 'cripto', aliases: ['ethereum', 'eth'] },
  { symbol: '^GSPC', name: 'S&P 500', assetType: 'indice', aliases: ['sp500', 's&p 500', 's&p'] },
  { symbol: '^DJI', name: 'Dow Jones Industrial Average', assetType: 'indice', aliases: ['dow jones'] },
  { symbol: 'EWZ', name: 'iShares MSCI Brazil ETF (Bovespa proxy)', assetType: 'etf', aliases: ['bovespa', 'brasil'] },
  { symbol: 'EWJ', name: 'iShares MSCI Japan ETF (Nikkei proxy)', assetType: 'etf', aliases: ['nikkei', 'japon', 'japón'] },
  { symbol: 'META', name: 'Meta Platforms, Inc.', assetType: 'accion', aliases: ['meta', 'facebook'] },
  { symbol: 'NFLX', name: 'Netflix, Inc.', assetType: 'accion', aliases: ['netflix'] },
  { symbol: 'AMD', name: 'Advanced Micro Devices, Inc.', assetType: 'accion', aliases: ['amd'] },
  { symbol: 'INTC', name: 'Intel Corporation', assetType: 'accion', aliases: ['intel'] },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', assetType: 'accion', aliases: ['jpmorgan', 'jp morgan'] },
  { symbol: 'V', name: 'Visa Inc.', assetType: 'accion', aliases: ['visa'] },
  { symbol: 'MA', name: 'Mastercard Incorporated', assetType: 'accion', aliases: ['mastercard'] },
  { symbol: 'JNJ', name: 'Johnson & Johnson', assetType: 'accion', aliases: ['johnson & johnson', 'johnson y johnson'] },
  { symbol: 'WMT', name: 'Walmart Inc.', assetType: 'accion', aliases: ['walmart'] },
  { symbol: 'PG', name: 'The Procter & Gamble Company', assetType: 'accion', aliases: ['procter & gamble', 'procter and gamble'] },
  { symbol: 'DIS', name: 'The Walt Disney Company', assetType: 'accion', aliases: ['disney'] },
  { symbol: 'ASML', name: 'ASML Holding N.V.', assetType: 'accion', aliases: ['asml'] },
  { symbol: 'TSM', name: 'Taiwan Semiconductor Manufacturing Company', assetType: 'accion', aliases: ['tsmc', 'taiwan semiconductor'] },
  { symbol: 'KO', name: 'The Coca-Cola Company', assetType: 'accion', aliases: ['coca cola', 'coca-cola'] },
  { symbol: 'ZC=F', name: 'Corn', assetType: 'futuro', aliases: ['maiz', 'maíz', 'corn'] },
  { symbol: 'ZW=F', name: 'Wheat', assetType: 'futuro', aliases: ['trigo', 'wheat'] },
  { symbol: 'ZS=F', name: 'Soybean', assetType: 'futuro', aliases: ['soya', 'soybean'] },
  { symbol: 'KC=F', name: 'Coffee', assetType: 'futuro', aliases: ['cafe', 'café', 'coffee'] }
];

export function displayLabel(entry) { return `${entry.symbol} (${entry.name})`; }

// Resolves free text ("apple", "oro", "aapl") to a catalog entry. Exact symbol match wins,
// then alias/name substring match. Returns null when nothing in the curated list matches.
export function resolveAsset(query) {
  const term = String(query || '').trim().toLowerCase();
  if (!term) return null;
  const bySymbol = ASSET_CATALOG.find(entry => entry.symbol.toLowerCase() === term);
  if (bySymbol) return bySymbol;
  return ASSET_CATALOG.find(entry => entry.name.toLowerCase().includes(term) || entry.aliases.some(alias => alias.includes(term) || term.includes(alias))) || null;
}

export function searchAssets(query, limit = 10) {
  const term = String(query || '').trim().toLowerCase();
  if (!term) return [];
  return ASSET_CATALOG
    .filter(entry => entry.symbol.toLowerCase().includes(term) || entry.name.toLowerCase().includes(term) || entry.aliases.some(alias => alias.includes(term)))
    .slice(0, limit);
}
