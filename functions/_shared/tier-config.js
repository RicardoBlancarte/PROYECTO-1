// Bloque 2 de la Fase 3 (docs/lanzamiento/fase-3-plan.md, 1.2 y 1.3): una sola fuente para los
// límites por nivel y los parámetros del motor. Not a route: Pages ignores "_" folders.
// Los valores son exactamente los que estaban escritos en el código (index.html y las Functions).
// La calibración de Monte Carlo (mcCalibration) vive aparte, en engine-params.json (punto M).

// Tope visual: ningún nivel muestra más filas que esto, aunque su límite esté "por definir".
export const UI_CAPS = { portfolioAssets: 12, radarSize: 10, hedgeStrategies: 3 };

// 'por-definir' = marcador (Elite, N1); se resuelve al tope visual, nunca a "ilimitado".
// radarSize queda solo en la configuración: el radar sigue en 3 para todos hasta el bloque 8.
export const TIER_LIMITS = {
  normal:  { portfolioAssets: 5,             radarSize: 3,             patternHorizons: ['daily'],                       hedgeStrategies: 0,             historyView: false },
  premium: { portfolioAssets: 12,            radarSize: 10,            patternHorizons: ['daily', 'weekly'],             hedgeStrategies: 3,             historyView: true  },
  elite:   { portfolioAssets: 'por-definir', radarSize: 'por-definir', patternHorizons: ['daily', 'weekly', 'monthly'], hedgeStrategies: 'por-definir', historyView: true  },
};

// Límites efectivos de un nivel: un nivel desconocido usa los de Free; los numéricos se acotan a UI_CAPS.
export function tierLimits(tier) {
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.normal;
  return Object.fromEntries(Object.entries(limits).map(([name, value]) => [
    name,
    name in UI_CAPS ? Math.min(Number.isFinite(value) ? value : UI_CAPS[name], UI_CAPS[name]) : value,
  ]));
}

// Parámetros del motor con su valor por defecto. byTier queda vacío: ningún parámetro "más sensible"
// se activa en un nivel sin que el laboratorio L muestre que mejora el acierto fuera de muestra (N2).
export const ENGINE_PARAMS = {
  default: {
    patternWindows: [3, 5],        // functions/api/patterns.js
    markovOrder: 1,                // functions/api/markov-matrix.js (transiciones de un paso)
    markovStates: 3,               // functions/api/markov-matrix.js (STATES)
    historicalUpWindow: 252,       // index.html (HISTORICAL_UP_WINDOW)
    chartHistorySessions: 504,     // functions/api/market/[symbol].js (RETENTION.daily) e index.html
    newsSensitivity: 0.35,         // index.html (NEWS_SENSITIVITY_FACTOR)
    sensitivityB1: false,          // N2: factor b1 de sensitivity-factor.js, apagado
  },
  byTier: { premium: {}, elite: {} },
};

export function engineParams(tier) {
  return { ...ENGINE_PARAMS.default, ...(ENGINE_PARAMS.byTier[tier] || {}) };
}
