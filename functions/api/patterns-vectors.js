// MOTOR V2 — FASE A (puntos 2 y 3 de la instrucción de calibración matemática). Endpoint
// aparte y en modo sombra: no lo llama ninguna pantalla de index.html/admin.html, no toca
// asset_signals ni asset_pattern_snapshots (motor shadow_v2 binario existente), y solo LEE
// asset_historical_prices. Gateado igual que winrate-shadow.js (X-Admin-Secret) porque el
// cálculo es pesado y es una herramienta de validación, no una API pública.
//
// Reemplaza la señal binaria (sube/baja) por un vector continuo (retorno, volumen) por día,
// normalizado por MAD contra el propio historial del activo. Un "patrón" es la trayectoria de
// 3 vectores consecutivos. La distancia entre patrones es Mahalanobis (Sigma = covarianza
// empírica retorno/volumen del activo) y el peso de cada patrón histórico es un kernel
// continuo w_i = e^(-D_i), no un k-vecinos fijo. La "singularidad" (punto 3) se cuantifica
// contra un N_min derivado de la regla de Silverman (d=2, c=0.5).
import { checkAdminAuth } from '../_shared/admin-auth.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

const MIN_VECTORS = 15; // piso de seguridad para que Sigma/MAD no degeneren; no es el N_min de Silverman.
const PERSIST_LIMIT = 260; // solo se audita la cola reciente; el cálculo en memoria usa todo el historial.
const FETCH_LIMIT = 5000; // evita el límite por defecto de PostgREST (1000) truncando el historial real.
const SILVERMAN_D = 2; // dimensiones del vector: retorno, volumen.
const SILVERMAN_C = 0.5;

export async function onRequestGet(context) {
  const authError = checkAdminAuth(context.request, context.env);
  if (authError) return authError;
  const url = new URL(context.request.url);
  const symbol = (url.searchParams.get('symbol') || '').slice(0, 32).toUpperCase();
  const horizon = ['daily', 'weekly', 'monthly'].includes(url.searchParams.get('horizon')) ? url.searchParams.get('horizon') : 'daily';
  if (!symbol || !context.env.SUPABASE_URL || !context.env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Servicio no disponible.' }, 503);
  const headers = { apikey: context.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${context.env.SUPABASE_SERVICE_ROLE_KEY}` };

  const pricesUrl = new URL(`${context.env.SUPABASE_URL}/rest/v1/asset_historical_prices`);
  pricesUrl.search = new URLSearchParams({ symbol: `eq.${symbol}`, order: 'date.asc', select: 'date,close,volume', limit: String(FETCH_LIMIT) }).toString();
  const pricesResponse = await fetch(pricesUrl, { headers });
  if (!pricesResponse.ok) return json({ error: 'No se pudo leer el histórico.' }, 502);
  const rawRows = await pricesResponse.json();
  const rows = horizon === 'weekly' ? resample(rawRows, isoWeekKey) : horizon === 'monthly' ? resample(rawRows, row => row.date.slice(0, 7)) : rawRows;

  const vectors = buildVectors(rows);
  if (vectors.length < MIN_VECTORS) return json({ error: 'Historial insuficiente para calibrar Sigma/MAD.', minRequired: MIN_VECTORS, available: vectors.length }, 422);

  const sigma = covariance2x2(vectors.map(v => v.r), vectors.map(v => v.v));
  const invSigma = invert2x2(sigma);
  const sigmaScale = Math.sqrt((sigma.a + sigma.d) / 2);
  // Corregido 2026-09-28 (validación de Fase A detectó el problema en vivo): "rangeUsed" ya NO
  // es el max-min de una sola dimensión. Ese enfoque colapsaba a ~0 en cuanto el activo tenía
  // UN SOLO día extremo en su historial (cualquier activo líquido, tarde o temprano), porque el
  // rango lo domina el peor/mejor día jamás visto y la fórmula de Silverman lo eleva a la sexta
  // potencia — con eso N_min quedaba tan chico que "historial_insuficiente" nunca se podía
  // disparar para ningún activo real, anulando la protección del punto 3.
  // En su lugar se usa el "radio generalizado" de la misma Sigma 2D que ya se usa para
  // Mahalanobis: el área de la elipse de 1-sigma es proporcional a sqrt(det(Sigma)), y el radio
  // de un círculo con esa misma área es det(Sigma)^(1/4) — un escalar en la misma escala que
  // sigmaScale, pero agregado sobre TODO el historial (promedia, no toma el máximo), así que un
  // solo día extremo ya no puede dominarlo. r y v ya están normalizados por MAD (adimensionales),
  // así que a, b, d (y por tanto det) también lo son; no hay problema de unidades al combinarlos.
  const detSigma = Math.max(sigma.a * sigma.d - sigma.b * sigma.b, 1e-12);
  const rangeUsed = Math.pow(detSigma, 0.25);

  // Patrones de 3 días con desenlace conocido: j-2,j-1,j como patrón, j+1 como desenlace.
  const targetPattern = vectors.slice(-3);
  let weightedSum = 0;
  let wTotal = 0;
  let nPatterns = 0;
  for (let j = 2; j <= vectors.length - 2; j += 1) {
    const candidate = vectors.slice(j - 2, j + 1);
    const distance = patternDistance(candidate, targetPattern, invSigma);
    const weight = Math.exp(-distance);
    const outcomeUp = vectors[j + 1].rawUp ? 1 : 0;
    weightedSum += weight * outcomeUp;
    wTotal += weight;
    nPatterns += 1;
  }
  const unconditionalUpRate = vectors.filter(v => v.rawUp).length / vectors.length;
  const probabilityUp = wTotal > 0 ? weightedSum / wTotal : unconditionalUpRate;

  // Regla de Silverman (d=2): h_opt(N) = (4/(d+2))^(1/(d+4)) * sigma * N^(-1/(d+4)).
  // N_min despejado exigiendo h_opt(N_min) = c * rango. rangeUsed ya nunca es 0 (piso de
  // detSigma arriba), así que esto ya no necesita un caso Infinity aparte.
  const nMin = Math.pow((Math.pow(4 / (SILVERMAN_D + 2), 1 / (SILVERMAN_D + 4)) * sigmaScale) / (SILVERMAN_C * rangeUsed), SILVERMAN_D + 4);

  // W_total "alto" se mide contra N_min: equivale a pedir al menos N_min vecinos de peso
  // pleno para considerar que hay precedente sólido (no hay un umbral numérico propio en la
  // instrucción; se reutiliza N_min para no introducir una constante sin justificar).
  let patternConfidenceLabel;
  if (nPatterns < nMin) patternConfidenceLabel = 'historial_insuficiente';
  else if (wTotal < nMin) patternConfidenceLabel = 'anomalia_genuina';
  else patternConfidenceLabel = 'precedente_solido';

  const modelNotes = {
    engine: 'shadow_v2_vectors',
    sigma: { rr: sigma.a, rv: sigma.b, vv: sigma.d },
    rangeDimension: 'det_sigma_quarter_power', // ver comentario junto a rangeUsed: det(Sigma)^(1/4), no max-min de una sola dimensión.
    unconditionalUpRate: Number(unconditionalUpRate.toFixed(3)),
  };

  await Promise.all([
    persistVectors(context.env, headers, symbol, horizon, vectors),
    persistSnapshot(context.env, headers, symbol, horizon, {
      probabilityUp, nPatterns, nMin, wTotal, sigmaScale, rangeUsed, patternConfidenceLabel, modelNotes,
    }),
  ]);

  return json({
    symbol,
    horizon,
    probabilityUp: Number(probabilityUp.toFixed(3)),
    nPatterns,
    nMin: formatPrecise(nMin),
    wTotal: Number(wTotal.toFixed(3)),
    sigmaScale: Number(sigmaScale.toFixed(4)),
    rangeUsed: formatPrecise(rangeUsed),
    patternConfidenceLabel,
    modelNotes,
    computedAt: new Date().toISOString(),
  });
}

// Retorno logarítmico normalizado por MAD y volumen del mismo día normalizado por MAD, ambos
// contra el historial completo del propio activo. rawUp usa el signo del retorno CRUDO (no el
// normalizado, que puede cambiar de signo si la mediana no es cero) para no romper la
// definición de "sube/baja" que ya usa el resto de la plataforma (asset_signals).
function buildVectors(rows) {
  if (rows.length < 3) return [];
  const rawReturns = [];
  const rawVolumes = [];
  const dates = [];
  for (let i = 1; i < rows.length; i += 1) {
    const prevClose = Number(rows[i - 1].close);
    const close = Number(rows[i].close);
    if (!(prevClose > 0) || !(close > 0)) continue;
    rawReturns.push(Math.log(close / prevClose));
    rawVolumes.push(Number(rows[i].volume || 0));
    dates.push(rows[i].date);
  }
  const { normalized: rNorm } = madNormalize(rawReturns);
  const { normalized: vNorm } = madNormalize(rawVolumes);
  return rawReturns.map((rawReturn, index) => ({
    date: dates[index],
    r: rNorm[index],
    v: vNorm[index],
    rawUp: rawReturn > 0,
  }));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function madNormalize(values) {
  const med = median(values);
  const deviations = values.map(value => Math.abs(value - med));
  const madRaw = median(deviations);
  const mad = madRaw > 1e-9 ? madRaw : 1; // evita división por cero si la serie es casi constante.
  return { normalized: values.map(value => (value - med) / mad), median: med, mad };
}

// Covarianza empírica (muestral, N-1) entre retorno y volumen normalizados, con ridge mínimo
// para que Sigma nunca quede exactamente singular (activo con volumen idéntico todos los días).
function covariance2x2(rSeries, vSeries) {
  const n = rSeries.length;
  const meanR = rSeries.reduce((sum, x) => sum + x, 0) / n;
  const meanV = vSeries.reduce((sum, x) => sum + x, 0) / n;
  let a = 0, b = 0, d = 0;
  for (let i = 0; i < n; i += 1) {
    const dr = rSeries[i] - meanR;
    const dv = vSeries[i] - meanV;
    a += dr * dr; b += dr * dv; d += dv * dv;
  }
  const denom = Math.max(n - 1, 1);
  const ridge = 1e-6;
  return { a: a / denom + ridge, b: b / denom, d: d / denom + ridge };
}

function invert2x2(sigma) {
  let { a, b, d } = sigma;
  let det = a * d - b * b;
  if (Math.abs(det) < 1e-9) { a += 1e-6; d += 1e-6; det = a * d - b * b; }
  return { a: d / det, b: -b / det, d: a / det };
}

function mahalanobisSq(dr, dv, inv) {
  return dr * dr * inv.a + 2 * dr * dv * inv.b + dv * dv * inv.d;
}

// nMin/rangeUsed pueden ser legítimamente muy chicos (ej. 0.0000259) sin ser un bug: un
// .toFixed(3) ingenuo los redondea a "0.000" y hace ver como si el cálculo hubiera colapsado
// a cero cuando en realidad es un valor positivo válido. Se usa notación exponencial solo por
// debajo de 1e-6 (donde JS igual la usaría por defecto al serializar); arriba de eso, 6
// decimales son más que suficientes para no perder la magnitud real del valor.
function formatPrecise(value) {
  if (!Number.isFinite(value)) return null;
  if (value === 0) return 0;
  return Math.abs(value) < 1e-6 ? Number(value.toExponential(4)) : Number(value.toFixed(6));
}

// Distancia total entre dos trayectorias de 3 vectores: suma de la Mahalanobis-cuadrado
// día-a-día (equivalente a tratar Sigma como bloque-diagonal sobre el vector 6D concatenado,
// asumiendo la misma covarianza retorno/volumen cada día) y luego raíz cuadrada.
function patternDistance(candidate, target, invSigma) {
  let sumSq = 0;
  for (let k = 0; k < 3; k += 1) {
    const dr = candidate[k].r - target[k].r;
    const dv = candidate[k].v - target[k].v;
    sumSq += mahalanobisSq(dr, dv, invSigma);
  }
  return Math.sqrt(sumSq);
}

function isoWeekKey(row) { const date = new Date(`${row.date}T00:00:00Z`), target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())), day = target.getUTCDay() || 7; target.setUTCDate(target.getUTCDate() + 4 - day); const start = new Date(Date.UTC(target.getUTCFullYear(), 0, 1)); return `${target.getUTCFullYear()}-W${Math.ceil((((target - start) / 86400000) + 1) / 7)}`; }
function resample(rows, keyFn) { const map = new Map(); rows.forEach(row => map.set(keyFn(row), row)); return [...map.values()]; }

async function persistVectors(env, headers, symbol, horizon, vectors) {
  const tail = vectors.slice(-PERSIST_LIMIT).map(v => ({
    symbol, horizon, date: v.date, return_mad_norm: v.r, volume_mad_norm: v.v,
  }));
  for (let start = 0; start < tail.length; start += 500) {
    const chunk = tail.slice(start, start + 500);
    await fetch(`${env.SUPABASE_URL}/rest/v1/asset_pattern_vectors?on_conflict=symbol,horizon,date`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk),
    }).catch(() => {});
  }
}

async function persistSnapshot(env, headers, symbol, horizon, snapshot) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/asset_pattern_vectors_snapshots?on_conflict=symbol,horizon`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      symbol, horizon,
      probability_up: snapshot.probabilityUp,
      n_patterns: snapshot.nPatterns,
      n_min: Number.isFinite(snapshot.nMin) ? snapshot.nMin : 999999999,
      w_total: snapshot.wTotal,
      sigma_scale: snapshot.sigmaScale,
      range_used: snapshot.rangeUsed,
      pattern_confidence_label: snapshot.patternConfidenceLabel,
      model_notes: snapshot.modelNotes,
      computed_at: new Date().toISOString(),
    }),
  }).catch(() => {});
}
