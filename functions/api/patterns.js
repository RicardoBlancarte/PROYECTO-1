const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=900' } });

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const symbol = (url.searchParams.get('symbol') || '').slice(0, 32).toUpperCase();
  const tier = ['normal', 'premium', 'elite'].includes(url.searchParams.get('tier')) ? url.searchParams.get('tier') : 'normal';
  const horizon = ['daily', 'weekly', 'monthly'].includes(url.searchParams.get('horizon')) ? url.searchParams.get('horizon') : 'daily';
  if (!symbol || !context.env.SUPABASE_URL || !context.env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Pattern cache is unavailable.' }, 503);
  const headers = { apikey: context.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${context.env.SUPABASE_SERVICE_ROLE_KEY}` };
  const pricesUrl = new URL(`${context.env.SUPABASE_URL}/rest/v1/asset_history`);
  pricesUrl.search = new URLSearchParams({ symbol: `eq.${symbol}`, interval: `eq.${horizon === 'monthly' ? 'yearly' : horizon}`, order: 'price_date.asc', select: 'close,price_date' }).toString();
  const pricesResponse = await fetch(pricesUrl, { headers });
  const rows = pricesResponse.ok ? await pricesResponse.json() : [];
  if (rows.length < 8) return json({ error: 'Not enough cached history.' }, 422);
  const bits = rows.slice(1).map((row, index) => Number(row.close) >= Number(rows[index].close) ? '1' : '0');
  const newsUrl = new URL(`${context.env.SUPABASE_URL}/rest/v1/asset_news_scores`);
  newsUrl.search = new URLSearchParams({ symbol: `eq.${symbol}`, order: 'published_at.desc', limit: '20', select: 'impact_score' }).toString();
  const newsResponse = await fetch(newsUrl, { headers });
  const scores = newsResponse.ok ? await newsResponse.json() : [];
  const newsAdjustment = scores.length ? scores.reduce((sum, row) => sum + Number(row.impact_score), 0) / scores.length : 0;
  const result = [3, 5].map(windowSize => estimate(bits, windowSize, newsAdjustment));
  await Promise.all(result.map(snapshot => upsertSnapshot(context.env, headers, symbol, horizon, snapshot, newsAdjustment)));
  const allowed = tier === 'normal' ? ['daily'] : tier === 'premium' ? ['daily', 'weekly'] : ['daily', 'weekly', 'monthly'];
  return json({ symbol, horizon, allowedHorizons: allowed, newsAdjustment: Number(newsAdjustment.toFixed(2)), patterns: result, computedAt: new Date().toISOString() });
}

function estimate(bits, windowSize, newsAdjustment) {
  const pattern = bits.slice(-windowSize).join('');
  let matches = 0; let nextUps = 0;
  for (let index = windowSize; index < bits.length; index += 1) {
    if (bits.slice(index - windowSize, index).join('') !== pattern) continue;
    matches += 1;
    if (bits[index] === '1') nextUps += 1;
  }
  const empirical = matches ? nextUps / matches : .5;
  const adjusted = Math.max(.05, Math.min(.95, empirical + newsAdjustment / 100));
  return { windowSize, pattern, sampleSize: matches, empiricalProbability: Number(empirical.toFixed(3)), probabilityUp: Number(adjusted.toFixed(3)) };
}

async function upsertSnapshot(env, headers, symbol, horizon, snapshot, newsAdjustment) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/asset_pattern_snapshots?on_conflict=symbol,horizon,window_size,pattern`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ symbol, horizon, window_size: snapshot.windowSize, pattern: snapshot.pattern, next_up_probability: snapshot.probabilityUp, sample_size: snapshot.sampleSize, news_adjustment: Number(newsAdjustment.toFixed(2)), computed_at: new Date().toISOString() })
  }).catch(() => {});
}
