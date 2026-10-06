"""MOTOR V2 - FASE B, sub-fase 3 (Punto 1, la parte de Monte Carlo).

Modulo puro: no tiene efectos secundarios al importarse (ninguna llamada a Supabase/red al
nivel de modulo), para que test_montecarlo_synthetic.py pueda importarlo sin disparar nada real.
`run_for_all_assets` es la unica funcion con efectos secundarios (red), y solo se ejecuta si se
llama explicitamente desde actualizar_automatico.py.

Implementa "Filtered Historical Simulation" (FHS) con remuestreo ponderado, no una Student-t
parametrica (esa es simetrica por construccion y no captura asimetria sin un parametro extra):
  - GARCH(1,1) con Student-t (omega, alpha, beta), calibrado por maxima verosimilitud con
    restricciones de estacionariedad (alpha+beta<1) -- reemplaza una recursion EWMA anterior
    que era tipo IGARCH (coeficientes sumando exactamente 1, solo marginalmente estable) y que
    en produccion mostro retroalimentacion real: sigma explotaba 12x-42x en trayectorias
    mensuales para activos cuyo pool de shocks estandarizados tenia E[z^2] > 1 (confirmado con
    datos reales de INTC/META). Un GARCH genuino con alpha+beta<1 estricto es estable por
    construccion, sin importar el E[z^2] empirico del pool.
  - El pool de shocks se renormaliza para que su E[z^2] ponderado sea exactamente 1 antes de
    usarse en la simulacion (independiente del fix de GARCH; ambos atacan la misma causa raiz
    desde angulos distintos). El E[z^2] original (antes de renormalizar) queda en model_notes
    como diagnostico.
  - lambda_pool: decaimiento de la EDAD en el peso de remuestreo (escala de anios -- un
    parametro DISTINTO de la volatilidad GARCH), calibrado por validacion cruzada
    dejando-uno-fuera de una densidad kernel sobre los shocks estandarizados, con ancho de
    banda de Silverman 1D.
  - Peso final de cada dia historico = lambda_pool^antiguedad * exp(-D_mahalanobis), donde
    D_mahalanobis reutiliza el kernel de Fase A (Sigma 2D de retorno/volumen normalizados por
    MAD), recalculado fresco (no se lee la tabla cacheada de 260 dias de Fase A).
  - Ningun dia se descarta ni se trunca: los extremos entran al pool con su peso completo.
  - Salidas (VaR, CVaR, semi-desviacion, cuantiles) en retorno SIMPLE (exp(x)-1); las versiones
    en log quedan en model_notes.log_units para quien las necesite.
"""

import hashlib
from datetime import datetime, timezone
from math import lgamma, log, pi

import numpy as np
from scipy.optimize import minimize

WINDOW = 3  # mismo tamanio de patron que Fase A.
SILVERMAN_D = 2
SILVERMAN_C = 0.5
NU_CAP = 30.0
NU_MIN = 2.5

# Decision de validacion (10 semillas x n=760, el historial real actual): los rangos de
# vida_media/n de (a) estable y (b1)/(b2) con cambio de regimen se traslapan bastante a esta
# profundidad de datos -- el mecanismo de calibrar_lambda_pool SI funciona (confirmado con
# n=2000/5000, donde la separacion es clara), pero a n=760 no hay suficiente potencia para
# confiar en el resultado. Por eso, EN PRODUCCION, lambda_pool queda fijo en 1.0 (sin
# decaimiento -- el pool pesa solo por similitud de Mahalanobis) hasta que un backfill
# historico real aumente la profundidad de asset_historical_prices y alguien re-corra esta
# misma validacion para confirmar que la separacion ya es clara a la profundidad real.
# Para reactivar la calibracion: cambiar a "calibrated" (requiere volver a validar primero).
LAMBDA_POOL_MODE = "fixed_low_power_n760"
# Pasos = sesiones (filas de asset_historical_prices). "two_day" (Fase 2 de lanzamiento) es
# "dentro de 2 sesiones": horizonte propio con su semilla, no derivable de la fila daily
# (el sigma GARCH del paso 2 depende del shock del paso 1).
STEPS_BY_HORIZON = {"daily": 1, "two_day": 2, "weekly": 5, "monthly": 21}
MIN_RETURNS = 90  # piso de seguridad: ventana + MLE + ESS estables necesitan margen.


# ---------------------------------------------------------------------------
# Utilidades robustas (mismo estilo que Fase A / B1: MAD, mediana, curtosis).
# ---------------------------------------------------------------------------

def log_returns(closes):
    closes = np.asarray(closes, dtype=float)
    return np.log(closes[1:] / closes[:-1])


def mad_normalize(values):
    values = np.asarray(values, dtype=float)
    med = np.median(values)
    mad_raw = np.median(np.abs(values - med))
    mad = mad_raw if mad_raw > 1e-9 else 1.0
    return (values - med) / mad


def classical_skewness(values):
    values = np.asarray(values, dtype=float)
    dev = values - values.mean()
    m2 = np.mean(dev ** 2)
    m3 = np.mean(dev ** 3)
    if m2 <= 1e-12:
        return 0.0
    return float(m3 / (m2 ** 1.5))


def bowley_skewness(values):
    q1, q2, q3 = np.percentile(values, [25, 50, 75])
    denom = q3 - q1
    if denom <= 1e-12:
        return 0.0
    return float((q3 + q1 - 2 * q2) / denom)


def weighted_skewness(values, weights):
    """Asimetria clasica (momentos), pero ponderada -- para medir la asimetria del POOL de
    remuestreo tal como realmente se usa (pesado por similitud de Mahalanobis), no la del
    historial completo sin ponderar."""
    values = np.asarray(values, dtype=float)
    weights = np.asarray(weights, dtype=float)
    w_sum = weights.sum()
    mean = np.sum(weights * values) / w_sum
    dev = values - mean
    m2 = np.sum(weights * dev ** 2) / w_sum
    m3 = np.sum(weights * dev ** 3) / w_sum
    if m2 <= 1e-12:
        return 0.0
    return float(m3 / (m2 ** 1.5))


def weighted_quantile(values, weights, q):
    """Cuantil ponderado (interpolacion sobre el punto medio del peso acumulado) -- version
    ponderada de np.percentile, para poder calcular una asimetria de Bowley ponderada."""
    values = np.asarray(values, dtype=float)
    weights = np.asarray(weights, dtype=float)
    order = np.argsort(values)
    values_sorted = values[order]
    weights_sorted = weights[order]
    cum = np.cumsum(weights_sorted) - 0.5 * weights_sorted
    cum /= weights_sorted.sum()
    return float(np.interp(q, cum, values_sorted))


def weighted_bowley_skewness(values, weights):
    """Asimetria de Bowley (por cuantiles), pero ponderada -- a diferencia de
    weighted_skewness (momentos), no depende de valores extremos individuales, asi que sirve
    para distinguir ruido de Monte Carlo (dominado por colas pesadas) de un sesgo real en los
    pesos del pool."""
    q1 = weighted_quantile(values, weights, 0.25)
    q2 = weighted_quantile(values, weights, 0.50)
    q3 = weighted_quantile(values, weights, 0.75)
    denom = q3 - q1
    if denom <= 1e-12:
        return 0.0
    return float((q3 + q1 - 2 * q2) / denom)


def standardized_student_t_logpdf(x, nu):
    """Densidad de la Student-t ESTANDARIZADA (Bollerslev 1987): varianza exactamente 1 para
    cualquier nu>2. Una t con parametro de ESCALA=1 (en vez de esto) tiene varianza nu/(nu-2),
    no 1 -- confundir ambas fue la causa de que sigma del GARCH saliera sistematicamente chico
    por un factor sqrt(nu/(nu-2)), detectado comparando E[z^2] del pool contra nu/(nu-2) con
    datos reales (INTC/META/AAPL/NFLX). GARCH-t exige que sigma_t sea la desviacion estandar
    condicional real, no un parametro de escala distinto de ella."""
    x = np.asarray(x, dtype=float)
    return (
        lgamma((nu + 1) / 2) - lgamma(nu / 2)
        - 0.5 * log(pi * (nu - 2))
        - (nu + 1) / 2 * np.log1p(x * x / (nu - 2))
    )


def standardized_t_draw(rng, nu, size=None):
    """Innovacion Student-t con varianza EXACTAMENTE 1 (no nu/(nu-2), que es lo que da
    rng.standard_t crudo). Usar esta funcion, nunca rng.standard_t directo, en cualquier
    generador sintetico de este modulo -- confundir ambas fue el origen del bug de sigma."""
    return rng.standard_t(nu, size=size) / np.sqrt(nu / (nu - 2))


def golden_section_search(f, lo, hi, tol=1e-4, max_iter=60):
    """Maximiza f en [lo, hi] asumiendo f unimodal. Devuelve (x*, f(x*))."""
    invphi = (np.sqrt(5) - 1) / 2
    a, b = lo, hi
    c = b - invphi * (b - a)
    d = a + invphi * (b - a)
    fc, fd = f(c), f(d)
    for _ in range(max_iter):
        if abs(b - a) < tol:
            break
        if fc > fd:
            b, d, fd = d, c, fc
            c = b - invphi * (b - a)
            fc = f(c)
        else:
            a, c, fc = c, d, fd
            d = a + invphi * (b - a)
            fd = f(d)
    x_star = (a + b) / 2
    return float(x_star), float(f(x_star))


def silverman_bandwidth_1d(values):
    """Regla de Silverman 1D clasica (no el ancho de banda 2D de Fase A, que esta en otras
    unidades): h = 0.9 * min(sd, IQR/1.34) * n^(-1/5)."""
    values = np.asarray(values, dtype=float)
    n = len(values)
    sd = np.std(values, ddof=1) if n > 1 else 1.0
    q1, q3 = np.percentile(values, [25, 75])
    iqr = q3 - q1
    scale = min(sd, iqr / 1.34) if iqr > 1e-9 else sd
    scale = scale if scale > 1e-9 else 1.0
    return float(0.9 * scale * n ** (-1.0 / 5.0))


# ---------------------------------------------------------------------------
# 2a. GARCH(1,1) con Student-t, calibrado por MLE con restricciones de estacionariedad.
# Reemplaza la recursion EWMA (tipo IGARCH, solo marginalmente estable) que mostro
# retroalimentacion real en produccion (sigma explotando 12x-42x en trayectorias mensuales).
#
# Reparametrizacion para que las restricciones queden como cajas simples en vez de una
# restriccion no lineal explicita (alpha+beta<1 se cumple por construccion, no hace falta
# imponerla aparte):
#   persistencia = alpha + beta,  en (eps, GARCH_PERSISTENCE_HI)
#   mezcla       = alpha / persistencia,  en (eps, 1-eps)
#   varianza_largo_plazo > 0 (optimizada en escala log)
#   alpha = mezcla * persistencia ; beta = (1-mezcla) * persistencia
#   omega = varianza_largo_plazo * (1 - persistencia)
# ---------------------------------------------------------------------------

GARCH_PERSISTENCE_LO = 1e-3
GARCH_PERSISTENCE_HI = 0.999  # estrictamente <1: GARCH con esto es estable por construccion.
GARCH_MIX_LO = 1e-3
GARCH_MIX_HI = 1 - 1e-3


def _garch_params_from_reparam(persistence, mix, long_run_var):
    alpha = mix * persistence
    beta = (1 - mix) * persistence
    omega = long_run_var * (1 - persistence)
    return omega, alpha, beta


def garch_sigma_path(returns, omega, alpha, beta):
    """sigma_t sin look-ahead: sigma_t^2 = omega + alpha*r_{t-1}^2 + beta*sigma_{t-1}^2."""
    returns = np.asarray(returns, dtype=float)
    n = len(returns)
    sigma2 = np.empty(n)
    long_run_var = omega / max(1.0 - alpha - beta, 1e-6)
    prev_sigma2 = max(long_run_var, 1e-12)
    for t in range(n):
        sigma2[t] = prev_sigma2
        prev_sigma2 = omega + alpha * returns[t] ** 2 + beta * prev_sigma2
    return np.sqrt(np.maximum(sigma2, 1e-12))


def calibrar_garch(returns):
    """MLE conjunta de los 4 parametros (persistencia, mezcla, varianza_largo_plazo, nu). nu YA
    NO se deriva de una formula de curtosis aparte: con la curtosis muestral real observada en
    activos reales (22-83), `nu=4+6/g2` da casi siempre nu~=4 (la formula pierde resolucion mas
    alla de g2~20, y ademas mezcla la curtosis inducida por el propio clustering de volatilidad
    GARCH con la de la innovacion, que son cosas distintas) -- se estima junto con el resto,
    que es el enfoque estandar para GARCH-t (igual que lo hacen paquetes como rugarch/arch)."""
    returns = np.asarray(returns, dtype=float)
    sample_var = max(float(np.var(returns)), 1e-10)

    def neg_log_lik(params):
        persistence, mix, log_lrv, nu = params
        long_run_var = np.exp(log_lrv)
        omega, alpha, beta = _garch_params_from_reparam(persistence, mix, long_run_var)
        sigma = garch_sigma_path(returns, omega, alpha, beta)
        z = returns / sigma
        return -float(np.sum(standardized_student_t_logpdf(z, nu) - np.log(sigma)))

    x0 = [0.95, 0.1, np.log(sample_var), 8.0]
    bounds = [
        (GARCH_PERSISTENCE_LO, GARCH_PERSISTENCE_HI),
        (GARCH_MIX_LO, GARCH_MIX_HI),
        (np.log(sample_var) - 10, np.log(sample_var) + 10),
        (NU_MIN, NU_CAP),
    ]
    fit = minimize(neg_log_lik, x0, method="L-BFGS-B", bounds=bounds)
    persistence, mix, log_lrv, nu = fit.x
    nu = float(nu)
    long_run_var = float(np.exp(log_lrv))
    omega, alpha, beta = _garch_params_from_reparam(persistence, mix, long_run_var)
    sigma_path = garch_sigma_path(returns, omega, alpha, beta)
    at_boundary = bool(persistence >= GARCH_PERSISTENCE_HI - 1e-3)
    half_life_days = float(np.log(0.5) / np.log(persistence)) if persistence < 1 else float("inf")
    return {
        "omega": float(omega),
        "alpha": float(alpha),
        "beta": float(beta),
        "persistence": float(persistence),
        "half_life_days": half_life_days,
        "degrees_of_freedom": nu,
        "sigma_path": sigma_path,
        "at_boundary": at_boundary,
        "log_likelihood": float(-fit.fun),
    }


# ---------------------------------------------------------------------------
# Kernel de Mahalanobis de Fase A, recalculado fresco contra el historial completo.
# ---------------------------------------------------------------------------

def build_pattern_vectors(closes, volumes):
    returns = log_returns(closes)
    r_norm = mad_normalize(returns)
    v_norm = mad_normalize(np.asarray(volumes[1:], dtype=float))
    return r_norm, v_norm


def covariance_2x2(r, v):
    n = len(r)
    dr, dv = r - r.mean(), v - v.mean()
    denom = max(n - 1, 1)
    ridge = 1e-6
    a = float(np.sum(dr * dr) / denom + ridge)
    b = float(np.sum(dr * dv) / denom)
    d = float(np.sum(dv * dv) / denom + ridge)
    return a, b, d


def invert_2x2(a, b, d):
    det = a * d - b * b
    if abs(det) < 1e-9:
        a += 1e-6
        d += 1e-6
        det = a * d - b * b
    return d / det, -b / det, a / det


def silverman_n_min(r_norm, v_norm):
    """N_min de Fase A (corregido: rango = det(Sigma)^(1/4), no max-min de una sola dimension)."""
    a, b, d = covariance_2x2(r_norm, v_norm)
    sigma_scale = np.sqrt((a + d) / 2)
    det_sigma = max(a * d - b * b, 1e-12)
    range_used = det_sigma ** 0.25
    factor = (4.0 / (SILVERMAN_D + 2)) ** (1.0 / (SILVERMAN_D + 4))
    n_min = ((factor * sigma_scale) / (SILVERMAN_C * range_used)) ** (SILVERMAN_D + 4)
    return float(n_min), float(sigma_scale), float(range_used)


def mahalanobis_pairwise_matrix(r_norm, v_norm, window=WINDOW):
    """Distancia de Mahalanobis entre CADA par de patrones de `window` dias (no solo contra
    "hoy"): necesaria para la validacion cruzada dejando-uno-fuera de lambda_pool. Devuelve la
    matriz (m x m) y los indices de dia (en r_norm/v_norm) en los que termina cada patron."""
    n = len(r_norm)
    a, b, d = covariance_2x2(r_norm, v_norm)
    inv_a, inv_b, inv_d = invert_2x2(a, b, d)

    valid_ends = np.arange(window - 1, n)
    m = len(valid_ends)
    patterns_r = np.stack([r_norm[e - window + 1:e + 1] for e in valid_ends])
    patterns_v = np.stack([v_norm[e - window + 1:e + 1] for e in valid_ends])

    dist = np.zeros((m, m))
    for i in range(m):
        dr = patterns_r - patterns_r[i]
        dv = patterns_v - patterns_v[i]
        sq = dr * dr * inv_a + 2 * dr * dv * inv_b + dv * dv * inv_d
        dist[i] = np.sqrt(np.sum(sq, axis=1))
    return dist, valid_ends


def mahalanobis_distances_to_today(r_norm, v_norm, window=WINDOW):
    """Version liviana O(n) (no O(n^2)): solo la distancia de cada patron contra el de HOY,
    no la matriz completa par-a-par. Se usa cuando LAMBDA_POOL_MODE="fixed_*" -- en ese modo no
    hace falta la validacion cruzada de calibrar_lambda_pool (que es la que necesita la matriz
    completa), asi que no vale la pena pagar el costo O(n^2)."""
    n = len(r_norm)
    a, b, d = covariance_2x2(r_norm, v_norm)
    inv_a, inv_b, inv_d = invert_2x2(a, b, d)

    valid_ends = np.arange(window - 1, n)
    patterns_r = np.stack([r_norm[e - window + 1:e + 1] for e in valid_ends])
    patterns_v = np.stack([v_norm[e - window + 1:e + 1] for e in valid_ends])

    dr = patterns_r - patterns_r[-1]
    dv = patterns_v - patterns_v[-1]
    sq = dr * dr * inv_a + 2 * dr * dv * inv_b + dv * dv * inv_d
    dist_to_today = np.sqrt(np.sum(sq, axis=1))
    return dist_to_today, valid_ends


# ---------------------------------------------------------------------------
# 2b. lambda_pool: decaimiento del peso en el pool, MLE por validacion cruzada
# dejando-uno-fuera sobre una densidad kernel en el espacio de los shocks estandarizados.
#
# Nota sobre `at_boundary=True` (lambda_pool >= lam_hi - 1e-3, o sea ~1.0): NO es un error ni
# una falla de convergencia. Significa que la validacion cruzada no encontro evidencia de
# cambio de regimen y prefiere el pool SIN decaimiento (toda la historia pesa segun su
# similitud de Mahalanobis, no segun su antiguedad) -- confirmado explicitamente con el
# sintetico (a) estable, que converge a la frontera de busqueda de forma consistente al
# aumentar n (ver validacion de la sub-fase B3, seccion de vida media normalizada).
# ---------------------------------------------------------------------------

def calibrar_lambda_pool(z_aligned, dist_matrix, lam_lo=1e-3, lam_hi=1.0):
    z = np.asarray(z_aligned, dtype=float)
    n = len(z)
    h = silverman_bandwidth_1d(z)
    idx = np.arange(n)
    age = np.abs(np.subtract.outer(idx, idx))
    diffs = np.subtract.outer(z, z) / h
    kernel = np.exp(-0.5 * diffs ** 2)

    def log_lik(lam):
        weights = (lam ** age) * np.exp(-dist_matrix)
        np.fill_diagonal(weights, 0.0)
        numer = np.sum(weights * kernel, axis=1)
        denom = np.sum(weights, axis=1)
        density = np.where(denom > 1e-300, numer / np.where(denom > 0, denom, 1.0), 1e-300)
        density = np.where(density > 1e-300, density, 1e-300)
        return float(np.sum(np.log(density)))

    lam_star, ll_star = golden_section_search(log_lik, lam_lo, lam_hi)
    at_boundary = bool(lam_star >= lam_hi - 1e-3 or lam_star <= lam_lo + 1e-3)
    return {
        "lambda_pool": lam_star,
        "log_likelihood": ll_star,
        "bandwidth": h,
        "at_boundary": at_boundary,
    }


def effective_sample_size(weights):
    weights = np.asarray(weights, dtype=float)
    total = weights.sum()
    total_sq = np.sum(weights ** 2)
    if total_sq <= 0:
        return 0.0
    return float((total ** 2) / total_sq)


# ---------------------------------------------------------------------------
# Simulacion (NumPy vectorizado, PRNG con semilla).
# ---------------------------------------------------------------------------

def derive_seed(symbol, horizon, as_of_date):
    digest = hashlib.sha256(f"{symbol}|{horizon}|{as_of_date}".encode()).hexdigest()
    return int(digest[:16], 16) % (2 ** 63 - 1)


def simular_trayectorias(pool_outcomes, pool_weights, sigma_today, omega, alpha, beta, steps,
                          n_paths, seed, news_uncertainty_variance=0.0):
    rng = np.random.default_rng(seed)
    probs = pool_weights / pool_weights.sum()
    cumulative = np.zeros(n_paths)
    sigma_t = np.full(n_paths, sigma_today, dtype=float)
    for _ in range(steps):
        idx = rng.choice(len(pool_outcomes), size=n_paths, p=probs)
        z = pool_outcomes[idx]
        r = z * sigma_t
        if news_uncertainty_variance > 0:
            r = r + rng.normal(0.0, np.sqrt(news_uncertainty_variance), size=n_paths)
        cumulative += r
        # GARCH genuino (alpha+beta<1 estricto, impuesto en calibrar_garch): estable por
        # construccion, a diferencia de la recursion EWMA anterior (alpha+beta=1 exacto).
        sigma_t = np.sqrt(np.maximum(omega + alpha * r ** 2 + beta * sigma_t ** 2, 1e-12))
    return cumulative


def summarize_simulation(cumulative_log_returns):
    """cumulative_log_returns es la suma de retornos LOG simulados (aditiva). Las salidas de
    cara al usuario van en retorno SIMPLE (exp(x)-1, lo que de verdad significa "cuanto cambia
    el precio"); las versiones en log quedan aparte en 'log_units' para quien las necesite."""
    probability_up = float(np.mean(cumulative_log_returns > 0))
    p_levels = [5, 10, 25, 50, 75, 90, 95]
    qs_log = np.percentile(cumulative_log_returns, p_levels)
    quantiles_log = {f"p{level}": float(q) for level, q in zip(p_levels, qs_log)}
    var_95_log = float(np.percentile(cumulative_log_returns, 5))
    var_99_log = float(np.percentile(cumulative_log_returns, 1))
    tail_95 = cumulative_log_returns[cumulative_log_returns <= var_95_log]
    tail_99 = cumulative_log_returns[cumulative_log_returns <= var_99_log]
    cvar_95_log = float(tail_95.mean()) if len(tail_95) else var_95_log
    cvar_99_log = float(tail_99.mean()) if len(tail_99) else var_99_log
    downside_log = np.minimum(cumulative_log_returns, 0.0)
    semi_deviation_log = float(np.sqrt(np.mean(downside_log ** 2)))

    to_simple = lambda x: float(np.expm1(x))  # noqa: E731
    log_units = {
        "quantiles": quantiles_log,
        "var_95": var_95_log, "cvar_95": cvar_95_log,
        "var_99": var_99_log, "cvar_99": cvar_99_log,
        "semi_deviation": semi_deviation_log,
    }
    # realized_skewness_simulated va en LOG (igual que sample_skewness_classical/robust de
    # entrada, que tambien son sobre retornos log) -- la contraparte en retorno simple se
    # calcula aparte y se guarda en model_notes.realized_skewness_simulated_simple (NO dentro
    # de log_units, que seria un nombre enganoso para un valor que no esta en log).
    realized_skewness_simulated_simple = classical_skewness(np.expm1(cumulative_log_returns))
    return {
        "probability_up": probability_up,
        "quantiles": {k: to_simple(v) for k, v in quantiles_log.items()},
        "var_95": to_simple(var_95_log), "cvar_95": to_simple(cvar_95_log),
        "var_99": to_simple(var_99_log), "cvar_99": to_simple(cvar_99_log),
        "semi_deviation": to_simple(semi_deviation_log),
        "realized_skewness_simulated": classical_skewness(cumulative_log_returns),
        "realized_skewness_simulated_simple": realized_skewness_simulated_simple,
        "log_units": log_units,
    }


# ---------------------------------------------------------------------------
# Orquestacion por simbolo.
# ---------------------------------------------------------------------------

def run_montecarlo_for_symbol(symbol, horizon, closes, volumes, dates,
                               b1_row=None, b2_row=None, n_paths=10000, window=WINDOW):
    if horizon not in STEPS_BY_HORIZON:
        raise ValueError(f"Horizonte invalido: {horizon}")
    steps = STEPS_BY_HORIZON[horizon]

    returns = log_returns(closes)
    if len(returns) < MIN_RETURNS:
        raise ValueError(f"Historial insuficiente para Monte Carlo ({len(returns)} retornos).")

    r_norm, v_norm = build_pattern_vectors(closes, volumes)

    vol_fit = calibrar_garch(returns)
    garch_omega = vol_fit["omega"]
    garch_alpha = vol_fit["alpha"]
    garch_beta = vol_fit["beta"]
    garch_persistence = vol_fit["persistence"]
    garch_half_life_days = vol_fit["half_life_days"]
    garch_at_boundary = vol_fit["at_boundary"]
    nu = vol_fit["degrees_of_freedom"]
    sigma_path = vol_fit["sigma_path"]
    z_full = returns / sigma_path

    # LAMBDA_POOL_MODE="fixed_*": decision de validacion (ver comentario junto a la constante,
    # al inicio del archivo) -- a la profundidad de historial real actual (~760 dias), la
    # validacion cruzada de calibrar_lambda_pool no separa de forma confiable un pool estable
    # de uno con cambio de regimen (confirmado con 10 semillas). Se usa la distancia a HOY
    # solamente (O(n), no O(n^2)) y lambda_pool=1 (pool pesado solo por Mahalanobis).
    pool_mode_fixed = LAMBDA_POOL_MODE != "calibrated"
    if pool_mode_fixed:
        dist_to_today, valid_ends = mahalanobis_distances_to_today(r_norm, v_norm, window=window)
        lambda_pool = 1.0
        at_boundary = True  # por diseno: modo fijo, no un resultado de la busqueda.
        today_row = len(valid_ends) - 1
        today_idx = valid_ends[today_row]
        source_rows = np.arange(0, today_row)
        source_days = valid_ends[source_rows]
        dist_today_to_sources = dist_to_today[source_rows]
    else:
        dist_matrix, valid_ends = mahalanobis_pairwise_matrix(r_norm, v_norm, window=window)
        z_aligned = z_full[valid_ends]
        pool_fit = calibrar_lambda_pool(z_aligned, dist_matrix)
        lambda_pool = pool_fit["lambda_pool"]
        at_boundary = pool_fit["at_boundary"]
        today_row = len(valid_ends) - 1
        today_idx = valid_ends[today_row]
        source_rows = np.arange(0, today_row)
        source_days = valid_ends[source_rows]
        dist_today_to_sources = dist_matrix[today_row, source_rows]

    outcome_days = source_days + 1  # shock del dia SIGUIENTE al patron (igual que Fase A: j -> j+1)
    pool_outcomes = z_full[outcome_days]
    age = today_idx - source_days
    pool_weights = (lambda_pool ** age) * np.exp(-dist_today_to_sources)

    # Renormalizacion del pool (causa raiz de la retroalimentacion observada en produccion
    # para INTC/META): se exige E[z^2] ponderado = 1 exacto antes de simular. weighted_ez2
    # (el valor ANTES de reescalar) se guarda como diagnostico, no se oculta el sintoma.
    weighted_ez2 = float(np.sum(pool_weights * pool_outcomes ** 2) / pool_weights.sum())
    pool_outcomes = pool_outcomes / np.sqrt(weighted_ez2)

    # Asimetria del pool tal como REALMENTE se usa (ponderado por e^-D, no el historial crudo
    # sin ponderar) -- invariante a la renormalizacion de arriba (la asimetria no cambia al
    # reescalar por una constante positiva), asi que da igual calcularla antes o despues.
    pool_skewness_weighted = weighted_skewness(pool_outcomes, pool_weights)
    # Version robusta (Bowley, por cuantiles): no depende de valores extremos individuales como
    # la de momentos de arriba, asi que sirve para distinguir ruido de Monte Carlo de un sesgo
    # real en los pesos cuando nu es chico (colas muy pesadas).
    pool_skewness_bowley_weighted = weighted_bowley_skewness(pool_outcomes, pool_weights)

    ess = effective_sample_size(pool_weights)
    n_min, sigma_scale, range_used = silverman_n_min(r_norm, v_norm)

    sigma_last = float(sigma_path[-1])
    sigma_forecast = float(np.sqrt(max(
        garch_omega + garch_alpha * returns[-1] ** 2 + garch_beta * sigma_last ** 2, 1e-12,
    )))

    seed = derive_seed(symbol, horizon, str(dates[-1]))
    cumulative = simular_trayectorias(
        pool_outcomes, pool_weights, sigma_forecast, garch_omega, garch_alpha, garch_beta,
        steps, n_paths, seed, news_uncertainty_variance=0.0,
    )
    summary = summarize_simulation(cumulative)
    log_units = summary.pop("log_units")
    realized_skewness_simulated_simple = summary.pop("realized_skewness_simulated_simple")

    model_notes = {
        "engine": "shadow_v2_montecarlo",
        "low_effective_sample": bool(ess < n_min),
        "lambda_pool_mode": LAMBDA_POOL_MODE,
        "lambda_pool_at_boundary": at_boundary,
        "lambda_pool_at_boundary_meaning": (
            "true no es un error: significa que no se detecto cambio de regimen (o que el "
            "modo esta fijo deliberadamente) y el pool queda sin decaimiento por antiguedad "
            "(lambda_pool=1, solo pesa la similitud de Mahalanobis)."
        ),
        "window": window,
        "sigma_scale": sigma_scale,
        "range_used": range_used,
        "garch_persistence": garch_persistence,
        "garch_half_life_days": garch_half_life_days,
        "garch_persistence_at_boundary": garch_at_boundary,
        "garch_persistence_at_boundary_meaning": (
            "true no es un error: significa que los datos no muestran reversion a la media "
            "detectable y el ajuste converge hacia el caso limite (EWMA/IGARCH)."
        ),
        "pool_e_z2_before_rescale": weighted_ez2,
        "pool_skewness_weighted": pool_skewness_weighted,
        "pool_skewness_bowley_weighted": pool_skewness_bowley_weighted,
        "realized_skewness_simulated_simple": realized_skewness_simulated_simple,
        "log_units": log_units,
    }

    result = {
        "symbol": symbol,
        "horizon": horizon,
        "n_paths": n_paths,
        "seed": int(seed),
        "garch_omega": garch_omega,
        "garch_alpha": garch_alpha,
        "garch_beta": garch_beta,
        "garch_persistence": garch_persistence,
        "garch_half_life_days": garch_half_life_days,
        "lambda_pool": lambda_pool,
        "degrees_of_freedom": nu,
        "effective_sample_size": ess,
        "n_min_threshold": n_min,
        "sample_skewness_classical": classical_skewness(returns),
        "sample_skewness_robust": bowley_skewness(returns),
        "news_uncertainty_variance": 0.0,
        "pool_size": int(len(source_days)),
        # Fecha del cierre sobre el que se simulo: la interfaz la compara con el ultimo cierre
        # que muestra y, si difieren, presenta "No disponible" en vez de cifras mezcladas.
        "base_close_date": str(dates[-1]),
        "b1_crosscheck": b1_row,
        "b2_crosscheck": b2_row,
        "model_notes": model_notes,
    }
    result.update(summary)
    return result


# ---------------------------------------------------------------------------
# Orquestacion con efectos secundarios (red). Es la UNICA parte de este modulo que toca
# Supabase -- nada aqui se ejecuta al importar el modulo, solo si se llama explicitamente.
# ---------------------------------------------------------------------------

def fetch_price_history(supabase, symbol, limit=5000):
    # Orden DESC + inversion local: si el symbol supera el max_rows de PostgREST (1000 por
    # defecto en Supabase), un orden ASC devolveria solo las filas MAS ANTIGUAS y se simularia
    # sobre un cierre viejo sin ningun error (mismo tipo de fallo que #131). Asi, en el peor
    # caso se truncan las mas antiguas y el ultimo cierre siempre es el real.
    rows = (
        supabase.table("asset_historical_prices")
        .select("date,close,volume")
        .eq("symbol", symbol)
        .order("date", desc=True)
        .limit(limit)
        .execute()
        .data
    ) or []
    rows.reverse()
    closes = [float(r["close"]) for r in rows]
    volumes = [float(r["volume"] or 0) for r in rows]
    dates = [r["date"] for r in rows]
    return closes, volumes, dates


def fetch_b1_crosscheck(supabase, symbol, horizon):
    rows = (
        supabase.table("asset_sensitivity_factor")
        .select("*")
        .eq("symbol", symbol)
        .eq("horizon", horizon)
        .limit(1)
        .execute()
        .data
    ) or []
    return rows[0] if rows else None


def fetch_b2_crosscheck(supabase, symbol):
    rows = (
        supabase.table("asset_markov_matrix")
        .select("*")
        .eq("symbol", symbol)
        .limit(1)
        .execute()
        .data
    ) or []
    return rows[0] if rows else None


def persist_result(supabase, result):
    payload = {key: result[key] for key in (
        "symbol", "horizon", "n_paths", "seed", "garch_omega", "garch_alpha", "garch_beta",
        "garch_persistence", "garch_half_life_days", "lambda_pool",
        "degrees_of_freedom", "effective_sample_size", "n_min_threshold", "pool_size",
        "probability_up", "quantiles", "var_95", "cvar_95", "var_99", "cvar_99",
        "semi_deviation", "sample_skewness_classical", "sample_skewness_robust",
        "realized_skewness_simulated", "news_uncertainty_variance", "base_close_date",
        "b1_crosscheck", "b2_crosscheck", "model_notes",
    )}
    # #127: el upsert (ON CONFLICT DO UPDATE) solo actualiza las columnas enviadas; el default
    # de computed_at solo aplica en el primer INSERT, asi que se envia explicito en cada corrida.
    payload["computed_at"] = datetime.now(timezone.utc).isoformat()
    supabase.table("asset_montecarlo_simulation").upsert(payload, on_conflict="symbol,horizon").execute()


def run_for_all_assets(supabase, assets, n_paths=10000):
    """Unica funcion de este modulo con efectos secundarios (red). Recorre el catalogo
    completo x 4 horizontes (STEPS_BY_HORIZON). Aislamiento de fallos: un error en un simbolo
    u horizonte se registra y se sigue con el resto -- nunca tumba la cascada completa."""
    for symbol, _asset_type in assets:
        try:
            closes, volumes, dates = fetch_price_history(supabase, symbol)
            if len(closes) < MIN_RETURNS + 1:
                print(f"Monte Carlo: historial insuficiente para {symbol} ({len(closes)} filas), se omite.")
                continue
            b2_row = fetch_b2_crosscheck(supabase, symbol)
            for horizon in STEPS_BY_HORIZON:
                try:
                    b1_row = fetch_b1_crosscheck(supabase, symbol, horizon)
                    result = run_montecarlo_for_symbol(
                        symbol, horizon, closes, volumes, dates,
                        b1_row=b1_row, b2_row=b2_row, n_paths=n_paths,
                    )
                    persist_result(supabase, result)
                    print(f"Monte Carlo ({symbol}, {horizon}): P(sube)={result['probability_up']:.3f} "
                          f"VaR95={result['var_95']:.4f} lambda_pool_mode={result['model_notes']['lambda_pool_mode']}")
                except Exception as e:
                    print(f"Error en Monte Carlo ({symbol}, {horizon}): {e}")
        except Exception as e:
            print(f"Error en Monte Carlo para {symbol}: {e}")


# ---------------------------------------------------------------------------
# Generador sintetico con propiedades conocidas, para test_montecarlo_synthetic.py.
# ---------------------------------------------------------------------------

def generar_sintetico_conocido(n=760, lambda_vol_true=0.92, nu_true=6.0, skew_flip_at_half=False,
                                seed=12345, sigma0=0.015):
    """Genera retornos log sinteticos con volatilidad agrupada (recursion EWMA real con
    `lambda_vol_true`) e innovaciones Student-t de dos piezas (escala distinta por lado, para
    asimetria conocida). Si `skew_flip_at_half`, la asimetria se invierte de signo exactamente
    a la mitad de la serie (para probar que lambda_pool < 1 se recupera en ese caso)."""
    rng = np.random.default_rng(seed)
    sigma2 = sigma0 ** 2
    sigma2_ceiling = 25.0 * sigma0 ** 2  # ver nota abajo
    returns = np.empty(n)
    for t in range(n):
        sigma = np.sqrt(sigma2)
        # Clip: una Student-t(nu=6) ocasionalmente da valores enormes (colas pesadas
        # genuinas), pero un solo valor extremo, elevado al cuadrado dentro de la propia
        # recursion de sigma2 (alpha=1-lambda=0.08), puede multiplicar sigma2 casi 10x en un
        # solo paso -- y si eso se repite, la retroalimentacion desborda el float64 en una
        # serie de 760 pasos. El tope de +-6 desvios y el techo en sigma2 son solo para
        # estabilidad numerica de ESTE generador sintetico de prueba (un proceso
        # recursivo simulado puede ser inestable de formas que el mercado real nunca es,
        # porque el mercado real no se retroalimenta de si mismo); no afectan la propiedad
        # cualitativa que se quiere probar (colas mas pesadas que una normal).
        # Estandarizada (varianza 1), no la t cruda de NumPy (varianza nu/(nu-2)) -- ver
        # standardized_t_draw().
        u = np.clip(standardized_t_draw(rng, nu_true), -6.0, 6.0)
        negative_side = t >= n // 2 if skew_flip_at_half else True
        scale_down, scale_up = (1.3, 1.0) if negative_side else (1.0, 1.3)
        innovation = u * (scale_down if u < 0 else scale_up)
        r = sigma * innovation
        returns[t] = r
        sigma2 = min(lambda_vol_true * sigma2 + (1 - lambda_vol_true) * r ** 2, sigma2_ceiling)
    closes = 100.0 * np.exp(np.cumsum(returns))
    closes = np.concatenate([[100.0], closes])
    volumes = rng.integers(1_000_000, 5_000_000, size=n + 1).astype(float)
    dates = [f"2020-01-{1 + (i % 28):02d}" for i in range(n + 1)]  # solo para tener algo iterable
    return closes, volumes, dates


def generar_sintetico_garch_conocido(n=760, omega_true=9e-6, alpha_true=0.08, beta_true=0.88,
                                      nu_true=6.0, seed=12345):
    """Retornos log sinteticos de un GARCH(1,1) genuino con parametros CONOCIDOS, para probar
    que calibrar_garch() los recupera. A diferencia de generar_sintetico_conocido() (que
    necesito un tope de sigma2 para no desbordar, porque su recursion EWMA es tipo IGARCH),
    este generador es estable POR CONSTRUCCION (alpha_true+beta_true=0.96<1 estricto) -- no
    necesita ningun tope artificial, justamente la propiedad que motivo este cambio."""
    rng = np.random.default_rng(seed)
    long_run_var = omega_true / (1.0 - alpha_true - beta_true)
    sigma2 = long_run_var
    returns = np.empty(n)
    for t in range(n):
        sigma = np.sqrt(sigma2)
        u = np.clip(standardized_t_draw(rng, nu_true), -8.0, 8.0)  # clip generoso, solo por si acaso numerico
        r = sigma * u
        returns[t] = r
        sigma2 = omega_true + alpha_true * r ** 2 + beta_true * sigma2
    closes = np.concatenate([[100.0], 100.0 * np.exp(np.cumsum(returns))])
    volumes = rng.integers(1_000_000, 5_000_000, size=n + 1).astype(float)
    dates = [f"2020-01-{1 + (i % 28):02d}" for i in range(n + 1)]
    return returns, closes, volumes, dates
