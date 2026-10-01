// MOTOR V2 — FASE B, sub-fase 1 (Punto 1 de la instrucción de calibración matemática). Endpoint
// aparte, admin-gated (X-Admin-Secret), no enlazado desde ninguna UI — mismo patrón que
// functions/api/patterns-vectors.js. Solo LEE asset_historical_prices.
//
// El modelo legacy (index.html) no tiene Markov ni Monte Carlo reales: son etiquetas de UI
// sobre `precio*(1+sigma*step)`, con `step` fijo por horizonte (PREDICTION_HORIZON: .21/.55/
// 1.15) y jamás calibrado. Este endpoint calibra la versión bayesiana de ese `step` — el
// "Factor de Sensibilidad" — por símbolo Y horizonte (más granular que hoy, que es un solo
// valor global por horizonte), con verosimilitud Student-t (robusta a atípicos), grados de
// libertad fijados por la curtosis muestral de los residuos, y MAD como escala en vez de
// desviación estándar clásica.
import { checkAdminAuth } from '../_shared/admin-auth.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

// step legacy de index.html:314 (PREDICTION_HORIZON), usado ÚNICAMENTE como media de la previa
// bayesiana (punto de partida razonable, no un valor a igualar). Si ese constante cambia en el
// frontend, esta copia no se sincroniza sola — aceptable porque solo es una previa, no una
// dependencia dura.
const LEGACY_STEP = { daily: 0.21, weekly: 0.55, monthly: 1.15 };
const ROLLING_WINDOW = { daily: 20, weekly: 12, monthly: 12 }; // ventana previa (sin look-ahead) para sigma_{t-1}.
const MIN_OBSERVATIONS = 40; // piso para que la curtosis muestral (y por tanto nu) no sea puro ruido.
const K_PRIOR = 20; // pseudo-conteo de la previa bayesiana: cuántas observaciones "vale" mu0.
// Piso defensivo, no un límite que realmente se alcance: 4 + 6/g2 siempre da >4 para g2>0
// (así lo exige la propia fórmula de curtosis de la Student-t), así que este NU_MIN queda
// como red de seguridad ante algún caso numérico raro, no como un valor que se vaya a usar.
const NU_MIN = 2.5;
const NU_CAP = 30; // Student-t con nu alto ≈ Normal -> el ajuste converge a mínimos cuadrados.
const MAX_ITERS = 25;
const CONVERGENCE_TOL = 1e-6;
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
  const rawRows = await pricesResponse.json();
  const rows = horizon === 'weekly' ? resample(rawRows, isoWeekKey) : horizon === 'monthly' ? resample(rawRows, row => row.date.slice(0, 7)) : rawRows;

  const returns = buildReturns(rows);
  const window = ROLLING_WINDOW[horizon];
  const pairs = buildPairs(returns, window);
  if (pairs.length < MIN_OBSERVATIONS) return json({ error: 'Historial insuficiente para calibrar (curtosis muestral poco confiable).', minRequired: MIN_OBSERVATIONS, available: pairs.length }, 422);

  const priorMean = LEGACY_STEP[horizon];
  const xs = pairs.map(p => p.x);
  const ys = pairs.map(p => p.y);
  const lambda0 = K_PRIOR / mean(xs.map(x => x * x));

  // Grados de libertad: derivados UNA VEZ de la curtosis de los residuos iniciales (usando la
  // previa como arranque), no recalculados cada iteración — evita que nu persiga su propio
  // ajuste en cada paso.
  const initialResiduals = pairs.map(p => p.y - priorMean * p.x);
  const sampleKurtosis = excessKurtosis(initialResiduals);
  const nu = sampleKurtosis <= 0.05 ? NU_CAP : clamp(4 + 6 / sampleKurtosis, NU_MIN, NU_CAP);

  let S = priorMean;
  let tau = Math.max(madOf(initialResiduals), 1e-6);
  let iterations = 0;
  for (let iter = 1; iter <= MAX_ITERS; iter += 1) {
    const residuals = pairs.map(p => p.y - S * p.x);
    const weights = residuals.map(e => (nu + 1) / (nu + (e / tau) * (e / tau)));
    let weightedXY = 0;
    let weightedXX = 0;
    for (let i = 0; i < pairs.length; i += 1) {
      weightedXY += weights[i] * xs[i] * ys[i];
      weightedXX += weights[i] * xs[i] * xs[i];
    }
    const tauSq = tau * tau;
    const sNew = (lambda0 * priorMean + weightedXY / tauSq) / (lambda0 + weightedXX / tauSq);
    const newResiduals = pairs.map(p => p.y - sNew * p.x);
    const tauNew = Math.max(madOf(newResiduals), 1e-6);
    iterations = iter;
    const converged = Math.abs(sNew - S) < CONVERGENCE_TOL;
    S = sNew;
    tau = tauNew;
    if (converged) break;
  }

  const modelNotes = {
    engine: 'shadow_v2_sensitivity',
    legacyStepConstant: priorMean,
    kPrior: K_PRIOR,
    windowSize: window,
    lambda0: Number(lambda0.toFixed(6)),
  };

  await persistSnapshot(context.env, headers, symbol, horizon, {
    sensitivityFactor: S, priorMean, tauScale: tau, degreesOfFreedom: nu,
    sampleKurtosis, nObservations: pairs.length, iterations, modelNotes,
  });

  return json({
    symbol,
    horizon,
    sensitivityFactor: Number(S.toFixed(6)),
    priorMean,
    tauScale: Number(tau.toFixed(6)),
    degreesOfFreedom: Number(nu.toFixed(3)),
    sampleKurtosis: Number(sampleKurtosis.toFixed(3)),
    nObservations: pairs.length,
    iterations,
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

// x_i = sigma_{t-1} (MAD de los retornos EN LA VENTANA ANTERIOR a t, nunca incluye el propio
// retorno de t: sin look-ahead). y_i = |retorno realizado en t|.
function buildPairs(returns, window) {
  const pairs = [];
  for (let i = window; i < returns.length; i += 1) {
    const priorWindow = returns.slice(i - window, i);
    const sigmaPrev = madOf(priorWindow);
    if (sigmaPrev <= 0) continue;
    pairs.push({ x: sigmaPrev, y: Math.abs(returns[i]) });
  }
  return pairs;
}

function mean(values) { return values.reduce((sum, v) => sum + v, 0) / values.length; }

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function madOf(values) {
  const med = median(values);
  return median(values.map(value => Math.abs(value - med)));
}

// Curtosis muestral en exceso (estimador simple, sin corrección de sesgo de muestra chica,
// consistente con el resto del motor v2): m4/m2^2 - 3.
function excessKurtosis(values) {
  const m = mean(values);
  const deviations = values.map(v => v - m);
  const m2 = mean(deviations.map(d => d * d));
  const m4 = mean(deviations.map(d => d * d * d * d));
  if (m2 <= 1e-12) return 0;
  return m4 / (m2 * m2) - 3;
}

function clamp(value, lo, hi) { return Math.min(Math.max(value, lo), hi); }

function isoWeekKey(row) { const date = new Date(`${row.date}T00:00:00Z`), target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())), day = target.getUTCDay() || 7; target.setUTCDate(target.getUTCDate() + 4 - day); const start = new Date(Date.UTC(target.getUTCFullYear(), 0, 1)); return `${target.getUTCFullYear()}-W${Math.ceil((((target - start) / 86400000) + 1) / 7)}`; }
function resample(rows, keyFn) { const map = new Map(); rows.forEach(row => map.set(keyFn(row), row)); return [...map.values()]; }

async function persistSnapshot(env, headers, symbol, horizon, snapshot) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/asset_sensitivity_factor?on_conflict=symbol,horizon`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      symbol, horizon,
      sensitivity_factor: snapshot.sensitivityFactor,
      prior_mean: snapshot.priorMean,
      tau_scale: snapshot.tauScale,
      degrees_of_freedom: snapshot.degreesOfFreedom,
      sample_kurtosis: snapshot.sampleKurtosis,
      n_observations: snapshot.nObservations,
      iterations: snapshot.iterations,
      model_notes: snapshot.modelNotes,
      computed_at: new Date().toISOString(),
    }),
  }).catch(() => {});
}
