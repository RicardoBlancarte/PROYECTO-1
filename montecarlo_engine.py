"""MOTOR V2 - FASE B, sub-fase 3 (Punto 1, la parte de Monte Carlo).

Modulo puro: no tiene efectos secundarios al importarse (ninguna llamada a Supabase/red al
nivel de modulo), para que test_montecarlo_synthetic.py pueda importarlo sin disparar nada real.
`run_for_all_assets` es la unica funcion con efectos secundarios (red), y solo se ejecuta si se
llama explicitamente desde actualizar_automatico.py.

Implementa "Filtered Historical Simulation" (FHS) con remuestreo ponderado, no una Student-t
parametrica (esa es simetrica por construccion y no captura asimetria sin un parametro extra):
  - lambda_vol: decaimiento de la recursion EWMA de varianza (escala de semanas/meses),
    calibrado por maxima verosimilitud Student-t (mismo estilo que B1: nu via curtosis).
  - lambda_pool: decaimiento de la EDAD en el peso de remuestreo (escala de anios -- un
    parametro DISTINTO de lambda_vol), calibrado por validacion cruzada dejando-uno-fuera de
    una densidad kernel sobre los shocks estandarizados, con ancho de banda de Silverman 1D.
  - Peso final de cada dia historico = lambda_pool^antiguedad * exp(-D_mahalanobis), donde
    D_mahalanobis reutiliza el kernel de Fase A (Sigma 2D de retorno/volumen normalizados por
    MAD), recalculado fresco (no se lee la tabla cacheada de 260 dias de Fase A).
  - Ningun dia se descarta ni se trunca: los extremos entran al pool con su peso completo.
"""

import hashlib
from math import lgamma, log, pi

import numpy as np

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
STEPS_BY_HORIZON = {"daily": 1, "weekly": 5, "monthly": 21}
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


def excess_kurtosis(values):
    values = np.asarray(values, dtype=float)
    dev = values - values.mean()
    m2 = np.mean(dev ** 2)
    m4 = np.mean(dev ** 4)
    if m2 <= 1e-12:
        return 0.0
    return float(m4 / (m2 ** 2) - 3.0)


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


def nu_from_kurtosis(values, nu_cap=NU_CAP, nu_min=NU_MIN):
    g2 = excess_kurtosis(values)
    if g2 <= 0.05:
        return float(nu_cap)
    nu = 4.0 + 6.0 / g2
    return float(min(max(nu, nu_min), nu_cap))


def student_t_logpdf(x, nu, scale):
    x = np.asarray(x, dtype=float)
    z = x / scale
    return (
        lgamma((nu + 1) / 2) - lgamma(nu / 2)
        - 0.5 * log(nu * pi) - log(scale)
        - (nu + 1) / 2 * np.log1p(z * z / nu)
    )


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
# 2a. lambda_vol: recursion EWMA de varianza, calibrada por MLE Student-t.
# ---------------------------------------------------------------------------

def ewma_sigma_path(returns, lam):
    """sigma_t sin look-ahead: sigma[t] se construye solo con informacion hasta t-1."""
    returns = np.asarray(returns, dtype=float)
    n = len(returns)
    sigma2 = np.empty(n)
    warmup = returns[:max(5, min(20, n))]
    prev = max(float(np.var(warmup)), 1e-12)
    for t in range(n):
        sigma2[t] = prev
        prev = lam * prev + (1 - lam) * returns[t] ** 2
    return np.sqrt(sigma2)


def calibrar_lambda_vol(returns, lam_lo=0.5, lam_hi=0.995):
    returns = np.asarray(returns, dtype=float)
    seed_sigma = ewma_sigma_path(returns, 0.90)
    nu = nu_from_kurtosis(returns / seed_sigma)

    def log_lik(lam):
        sigma = ewma_sigma_path(returns, lam)
        z = returns / sigma
        return float(np.sum(student_t_logpdf(z, nu, 1.0) - np.log(sigma)))

    lam_star, ll_star = golden_section_search(log_lik, lam_lo, lam_hi)
    sigma_final = ewma_sigma_path(returns, lam_star)
    return {
        "lambda_vol": lam_star,
        "degrees_of_freedom": nu,
        "sigma_path": sigma_final,
        "log_likelihood": ll_star,
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


def simular_trayectorias(pool_outcomes, pool_weights, sigma_today, lambda_vol, steps, n_paths,
                          seed, news_uncertainty_variance=0.0):
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
        sigma_t = np.sqrt(lambda_vol * sigma_t ** 2 + (1 - lambda_vol) * r ** 2)
    return cumulative


def summarize_simulation(cumulative_returns):
    probability_up = float(np.mean(cumulative_returns > 0))
    p_levels = [5, 10, 25, 50, 75, 90, 95]
    qs = np.percentile(cumulative_returns, p_levels)
    quantiles = {f"p{level}": float(q) for level, q in zip(p_levels, qs)}
    var_95 = float(np.percentile(cumulative_returns, 5))
    var_99 = float(np.percentile(cumulative_returns, 1))
    tail_95 = cumulative_returns[cumulative_returns <= var_95]
    tail_99 = cumulative_returns[cumulative_returns <= var_99]
    cvar_95 = float(tail_95.mean()) if len(tail_95) else var_95
    cvar_99 = float(tail_99.mean()) if len(tail_99) else var_99
    downside = np.minimum(cumulative_returns, 0.0)
    semi_deviation = float(np.sqrt(np.mean(downside ** 2)))
    return {
        "probability_up": probability_up,
        "quantiles": quantiles,
        "var_95": var_95, "cvar_95": cvar_95,
        "var_99": var_99, "cvar_99": cvar_99,
        "semi_deviation": semi_deviation,
        "realized_skewness_simulated": classical_skewness(cumulative_returns),
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

    vol_fit = calibrar_lambda_vol(returns)
    lambda_vol = vol_fit["lambda_vol"]
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

    ess = effective_sample_size(pool_weights)
    n_min, sigma_scale, range_used = silverman_n_min(r_norm, v_norm)

    sigma_last = float(sigma_path[-1])
    sigma_forecast = float(np.sqrt(lambda_vol * sigma_last ** 2 + (1 - lambda_vol) * returns[-1] ** 2))

    seed = derive_seed(symbol, horizon, str(dates[-1]))
    cumulative = simular_trayectorias(
        pool_outcomes, pool_weights, sigma_forecast, lambda_vol, steps, n_paths, seed,
        news_uncertainty_variance=0.0,
    )
    summary = summarize_simulation(cumulative)

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
    }

    result = {
        "symbol": symbol,
        "horizon": horizon,
        "n_paths": n_paths,
        "seed": int(seed),
        "lambda_vol": lambda_vol,
        "lambda_pool": lambda_pool,
        "degrees_of_freedom": nu,
        "effective_sample_size": ess,
        "n_min_threshold": n_min,
        "sample_skewness_classical": classical_skewness(returns),
        "sample_skewness_robust": bowley_skewness(returns),
        "news_uncertainty_variance": 0.0,
        "pool_size": int(len(source_days)),
        "b1_crosscheck": b1_row,
        "b2_crosscheck": b2_row,
        "model_notes": model_notes,
    }
    result.update(summary)
    return result


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
        u = np.clip(rng.standard_t(nu_true), -6.0, 6.0)
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
