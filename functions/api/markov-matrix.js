// MOTOR V2 — FASE B, sub-fase 2 (Punto 1, la parte de Markov). Endpoint aparte, admin-gated,
// no enlazado desde ninguna UI — mismo patrón que patterns-vectors.js/sensitivity-factor.js.
// Solo LEE asset_historical_prices.
//
// Matriz de transición de 3 estados (bajista/neutral/alcista), estimada en pasos DIARIOS con
// el historial completo disponible (nunca re-muestreada a semanal/mensual: una matriz de
// transición necesita mucha más muestra por celda que una regresión escalar, y B1 ya mostró que
// mensual no tiene suficiente profundidad histórica todavía — re-muestrear aquí sería peor, no
// mejor). Los horizontes semanal/mensual se obtienen elevando esta misma matriz a una potencia
// (P^5, P^21; convención de días hábiles), nunca reajustando con menos datos. Los estados se
// definen por terciles de la distribución de retornos del propio activo (no un corte fijo).
//
// Corregido tras revisión numérica (validación en modo sombra, antes de desplegar): la primera
// versión inclinaba la matriz de transición con la asimetría muestral. Verificado con un
// sintético reproducible que eso era un error de categoría — la asimetría mide la forma/magnitud
// de las colas de la distribución de retornos, no la frecuencia con la que se transita entre
// terciles, y el tilt alejaba artificialmente la distribución estacionaria de (1/3,1/3,1/3), que
// es la frecuencia marginal real de cada tercil por construcción (confirmado: con skew=-0.56 el
// tilt movía la estacionaria ~0.41 en L1, un efecto compuesto enorme para una asimetría modesta).
// La matriz del modelo es ahora la cruda, sin inclinar. `sampleSkewness` se sigue calculando y
// devolviendo como campo informativo — la sub-fase B3 (Monte Carlo) la va a usar para la
// magnitud de los movimientos dentro de cada estado (colas), junto con la semi-desviación del
// VaR, que es el lugar correcto para esa información.
import { checkAdminAuth } from '../_shared/admin-auth.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

const STATES = ['bajista', 'neutral', 'alcista'];
const STEPS_BY_HORIZON = { daily: 1, weekly: 5, monthly: 21 }; // convención estándar de días hábiles.
const MIN_OBSERVATIONS = 60; // piso holgado para terciles + conteos de transición con 3 estados.
const FETCH_LIMIT = 5000;

export async function onRequestGet(context) {
  const authError = checkAdminAuth(context.request, context.env);
  if (authError) return authError;
  const url = new URL(context.request.url);
  const symbol = (url.searchParams.get('symbol') || '').slice(0, 32).toUpperCase();
  const horizon = ['daily', 'weekly', 'monthly'].includes(url.searchParams.get('horizon')) ? url.searchParams.get('horizon') : 'daily';
  if (!symbol || !context.env.SUPABASE_URL || !context.env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Servicio no disponible.' }, 503);
  const headers = { apikey: context.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${context.env.SUPABASE_SERVICE_ROLE_KEY}` };

  const pricesUrl = new URL(`${context.env.SUPABASE_URL}/rest/v1/asset_historical_prices`);
  pricesUrl.search = new URLSearchParams({ symbol: `eq.${symbol}`, order: 'date.asc', select: 'date,close', limit: String(FETCH_LIMIT) }).toString();
  const pricesResponse = await fetch(pricesUrl, { headers });
  if (!pricesResponse.ok) return json({ error: 'No se pudo leer el histórico.' }, 502);
  const rows = await pricesResponse.json();

  const returns = buildReturns(rows);
  if (returns.length < MIN_OBSERVATIONS) return json({ error: 'Historial insuficiente para calibrar la matriz de Markov.', minRequired: MIN_OBSERVATIONS, available: returns.length }, 422);

  // Terciles del propio activo (no un corte fijo): invariantes a MAD-normalizar, así que se
  // calculan directo sobre el retorno log crudo.
  const sorted = [...returns].sort((a, b) => a - b);
  const lowThreshold = percentile(sorted, 1 / 3);
  const highThreshold = percentile(sorted, 2 / 3);
  const stateSeries = returns.map(r => classify(r, lowThreshold, highThreshold));

  const transitionMatrix = buildTransitionMatrix(stateSeries);
  // Informativo para Fase B3 (Monte Carlo); ya NO ajusta esta matriz (ver comentario de arriba).
  const sampleSkewness = skewnessOf(returns);

  const currentStateIndex = stateSeries[stateSeries.length - 1];
  const steps = STEPS_BY_HORIZON[horizon];
  const poweredMatrix = matPow(transitionMatrix, steps);
  const projectedRow = poweredMatrix[currentStateIndex];

  const modelNotes = {
    engine: 'shadow_v2_markov',
    stateOrder: STATES,
    stepsConvention: 'dias_habiles',
    sampleSkewnessNote: 'informativo, reservado para Fase B3 (Monte Carlo): no ajusta esta matriz.',
  };

  await persistSnapshot(context.env, headers, symbol, {
    lowThreshold, highThreshold, sampleSkewness,
    transitionMatrix,
    currentState: STATES[currentStateIndex], nObservations: returns.length, modelNotes,
  });

  return json({
    symbol,
    horizon,
    steps,
    lowThreshold: Number(lowThreshold.toFixed(6)),
    highThreshold: Number(highThreshold.toFixed(6)),
    sampleSkewness: Number(sampleSkewness.toFixed(4)),
    transitionMatrix: roundMatrix(transitionMatrix),
    currentState: STATES[currentStateIndex],
    projectedDistribution: { bajista: Number(projectedRow[0].toFixed(4)), neutral: Number(projectedRow[1].toFixed(4)), alcista: Number(projectedRow[2].toFixed(4)) },
    nObservations: returns.length,
    modelNotes,
    computedAt: new Date().toISOString(),
  });
}

function buildReturns(rows) {
  const returns = [];
  for (let i = 1; i < rows.length; i += 1) {
    const prevClose = Number(rows[i - 1].close);
    const close = Number(rows[i].close);
    if (!(prevClose > 0) || !(close > 0)) continue;
    returns.push(Math.log(close / prevClose));
  }
  return returns;
}

function percentile(sortedValues, p) {
  const idx = p * (sortedValues.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  const frac = idx - lo;
  return sortedValues[lo] * (1 - frac) + sortedValues[hi] * frac;
}

function classify(returnValue, lowThreshold, highThreshold) {
  if (returnValue < lowThreshold) return 0; // bajista
  if (returnValue > highThreshold) return 2; // alcista
  return 1; // neutral
}

function buildTransitionMatrix(stateSeries) {
  const counts = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < stateSeries.length - 1; i += 1) counts[stateSeries[i]][stateSeries[i + 1]] += 1;
  return counts.map(row => normalizeRow(row));
}

function normalizeRow(row) {
  const sum = row[0] + row[1] + row[2];
  return sum > 0 ? row.map(v => v / sum) : [1 / 3, 1 / 3, 1 / 3];
}

function mean(values) { return values.reduce((sum, v) => sum + v, 0) / values.length; }

// Asimetría muestral (estimador simple, mismo estilo que la curtosis de B1): m3/m2^1.5.
// Informativo para Fase B3 (Monte Carlo) — ver comentario al inicio del archivo.
function skewnessOf(values) {
  const m = mean(values);
  const deviations = values.map(v => v - m);
  const m2 = mean(deviations.map(d => d * d));
  const m3 = mean(deviations.map(d => d * d * d));
  if (m2 <= 1e-12) return 0;
  return m3 / Math.pow(m2, 1.5);
}

function multiply3x3(a, b) {
  const result = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) sum += a[i][k] * b[k][j];
      result[i][j] = sum;
    }
  }
  return result;
}

function matPow(matrix, steps) {
  let result = matrix;
  for (let i = 1; i < steps; i += 1) result = multiply3x3(result, matrix);
  return result;
}

function roundMatrix(matrix) { return matrix.map(row => row.map(v => Number(v.toFixed(4)))); }

async function persistSnapshot(env, headers, symbol, snapshot) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/asset_markov_matrix?on_conflict=symbol`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      symbol,
      low_threshold: snapshot.lowThreshold,
      high_threshold: snapshot.highThreshold,
      sample_skewness: snapshot.sampleSkewness,
      transition_matrix: snapshot.transitionMatrix,
      current_state: snapshot.currentState,
      n_observations: snapshot.nObservations,
      model_notes: snapshot.modelNotes,
      computed_at: new Date().toISOString(),
    }),
  }).catch(() => {});
}
