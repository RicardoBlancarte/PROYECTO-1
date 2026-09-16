const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=900' } });

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const symbol = (url.searchParams.get('symbol') || '').slice(0, 32).toUpperCase();
  const tier = ['normal', 'premium', 'elite'].includes(url.searchParams.get('tier')) ? url.searchParams.get('tier') : 'normal';
  const horizon = ['daily', 'weekly', 'monthly'].includes(url.searchParams.get('horizon')) ? url.searchParams.get('horizon') : 'daily';
  if (!symbol || !context.env.SUPABASE_URL || !context.env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Pattern cache is unavailable.' }, 503);
  const headers = { apikey: context.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${context.env.SUPABASE_SERVICE_ROLE_KEY}` };

  // Fuente primaria para el horizonte diario (punto 9.2): asset_signals ya consolidada por
  // el backfill histórico + la cascada diaria de actualizar_automatico.py. Solo se cae al
  // respaldo (derivar de asset_historical_prices) si un símbolo aún no tiene suficiente
  // profundidad ahí (p. ej. recién agregado al catálogo, antes de su primer backfill).
  let bits = null;
  let signalSource = 'asset_historical_prices';
  if (horizon === 'daily') {
    const signalsUrl = new URL(`${context.env.SUPABASE_URL}/rest/v1/asset_signals`);
    signalsUrl.search = new URLSearchParams({ symbol: `eq.${symbol}`, order: 'date.asc', select: 'signal' }).toString();
    const signalsResponse = await fetch(signalsUrl, { headers });
    const signalRows = signalsResponse.ok ? await signalsResponse.json() : [];
    if (signalRows.length >= 8) {
      bits = signalRows.map(row => String(row.signal));
      signalSource = 'asset_signals';
    }
  }

  if (!bits) {
    // Respaldo: weekly/monthly siempre llegan aquí (asset_signals es solo diaria), y daily
    // también si asset_signals todavía no tiene suficiente historial para este símbolo.
    const pricesUrl = new URL(`${context.env.SUPABASE_URL}/rest/v1/asset_historical_prices`);
    pricesUrl.search = new URLSearchParams({ symbol: `eq.${symbol}`, order: 'date.asc', select: 'close,date' }).toString();
    const pricesResponse = await fetch(pricesUrl, { headers });
    const dailyRows = pricesResponse.ok ? await pricesResponse.json() : [];
    if (dailyRows.length < 8) return json({ error: 'Not enough cached history.' }, 422);
    const rows = horizon === 'weekly' ? toWeekly(dailyRows) : horizon === 'monthly' ? toMonthly(dailyRows) : dailyRows;
    if (rows.length < 8) return json({ error: 'Not enough cached history for this horizon.' }, 422);
    bits = rows.slice(1).map((row, index) => Number(row.close) > Number(rows[index].close) ? '1' : '0');
  }

  const newsUrl = new URL(`${context.env.SUPABASE_URL}/rest/v1/asset_news_scores`);
  newsUrl.search = new URLSearchParams({ symbol: `eq.${symbol}`, order: 'published_at.desc', limit: '20', select: 'impact_score' }).toString();
  const newsResponse = await fetch(newsUrl, { headers });
  const scores = newsResponse.ok ? await newsResponse.json() : [];
  const newsAdjustment = scores.length ? scores.reduce((sum, row) => sum + Number(row.impact_score), 0) / scores.length : 0;
  const result = [3, 5].map(windowSize => estimate(bits, windowSize, newsAdjustment));
  await Promise.all([
    ...result.map(snapshot => upsertSnapshot(context.env, headers, symbol, horizon, snapshot, newsAdjustment)),
    logPredictionAudit(context.env, headers, symbol, tier, horizon, result, newsAdjustment)
  ]);
  const allowed = tier === 'normal' ? ['daily'] : tier === 'premium' ? ['daily', 'weekly'] : ['daily', 'weekly', 'monthly'];
  return json({ symbol, horizon, allowedHorizons: allowed, newsAdjustment: Number(newsAdjustment.toFixed(2)), patterns: result, signalSource, computedAt: new Date().toISOString() });
}

// Punto 9.3: patron binario (1 alza / 0 baja) sobre la ventana dada, con deteccion de
// "singularidad" (sin precedente historico exacto, cae a la tasa base incondicional) y los
// 2 caminos de 2 pasos mas probables historicamente despues de ese patron.
function estimate(bits, windowSize, newsAdjustment) {
  const pattern = bits.slice(-windowSize).join('');
  let matches = 0; let nextUps = 0;
  const twoStepCounts = new Map(); let twoStepSamples = 0;
  for (let index = windowSize; index < bits.length; index += 1) {
    if (bits.slice(index - windowSize, index).join('') !== pattern) continue;
    matches += 1;
    if (bits[index] === '1') nextUps += 1;
    if (index + 1 < bits.length) {
      const outcome = bits[index] + bits[index + 1];
      twoStepCounts.set(outcome, (twoStepCounts.get(outcome) || 0) + 1);
      twoStepSamples += 1;
    }
  }
  const isSingularity = matches === 0;
  const empirical = isSingularity ? unconditionalUpRate(bits) : nextUps / matches;
  const adjusted = Math.max(.05, Math.min(.95, empirical + newsAdjustment / 100));
  const topPaths = [...twoStepCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([outcome, count]) => ({ outcome, probability: Number((count / twoStepSamples).toFixed(3)) }));
  return { windowSize, pattern, sampleSize: matches, isSingularity, empiricalProbability: Number(empirical.toFixed(3)), probabilityUp: Number(adjusted.toFixed(3)), topPaths };
}

function unconditionalUpRate(bits) { return bits.length ? bits.filter(bit => bit === '1').length / bits.length : .5; }

function isoWeekKey(dateString) { const date = new Date(`${dateString}T00:00:00Z`), target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())), day = target.getUTCDay() || 7; target.setUTCDate(target.getUTCDate() + 4 - day); const start = new Date(Date.UTC(target.getUTCFullYear(), 0, 1)); return `${target.getUTCFullYear()}-W${Math.ceil((((target - start) / 86400000) + 1) / 7)}`; }
function toWeekly(rows) { const map = new Map(); rows.forEach(row => map.set(isoWeekKey(row.date), row)); return [...map.values()]; }
function toMonthly(rows) { const map = new Map(); rows.forEach(row => map.set(row.date.slice(0, 7), row)); return [...map.values()]; }

async function upsertSnapshot(env, headers, symbol, horizon, snapshot, newsAdjustment) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/asset_pattern_snapshots?on_conflict=symbol,horizon,window_size,pattern`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ symbol, horizon, window_size: snapshot.windowSize, pattern: snapshot.pattern, next_up_probability: snapshot.probabilityUp, sample_size: snapshot.sampleSize, news_adjustment: Number(newsAdjustment.toFixed(2)), is_singularity: snapshot.isSingularity, computed_at: new Date().toISOString() })
  }).catch(() => {});
}

// Registro auditable del motor sombra en producción (asset_prediction_audit ya existía en el
// esquema pero no se usaba en ningún lado); best-effort, nunca bloquea la respuesta al usuario.
async function logPredictionAudit(env, headers, symbol, tier, horizon, result, newsAdjustment) {
  const horizonDays = horizon === 'weekly' ? 7 : horizon === 'monthly' ? 30 : 1;
  const window5 = result.find(item => item.windowSize === 5) || result[0];
  await fetch(`${env.SUPABASE_URL}/rest/v1/asset_prediction_audit`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      symbol, tier, horizon_days: horizonDays,
      pattern_3: result.find(item => item.windowSize === 3)?.pattern || null,
      pattern_5: result.find(item => item.windowSize === 5)?.pattern || null,
      probability_up: window5?.probabilityUp ?? 0.5,
      news_adjustment: Number(newsAdjustment.toFixed(2)),
      model_notes: { engine: 'shadow_v2', windows: result.map(item => ({ windowSize: item.windowSize, isSingularity: item.isSingularity, topPaths: item.topPaths })) }
    })
  }).catch(() => {});
}
