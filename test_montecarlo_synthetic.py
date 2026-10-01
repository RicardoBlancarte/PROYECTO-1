"""Validacion sintetica de montecarlo_engine.py, ANTES de tocar datos reales (Fase B, sub-fase
3). Local, no se corre en CI, no toca Supabase ni GitHub Actions -- importa las mismas
funciones que usa la cascada, no reimplementa nada en paralelo.

Metodologia final (tras varias rondas de revision):
  1. (a)/(b1)/(b2) a n=5000 (profundidad donde el mecanismo SI tiene potencia, confirmado por
     separacion con 10 semillas en una investigacion previa) -- mide vida_media/n, no
     lambda_pool crudo, porque la vida media cruda crece con n incluso sin cambio de regimen
     (un sesgo de normalizacion que llevo a una conclusion equivocada en una ronda anterior).
     Esto demuestra que calibrar_lambda_pool() SI funciona, para poder reactivarlo despues de
     un backfill historico que profundice asset_historical_prices mas alla de los ~760 dias
     actuales.
  2. lambda_vol recuperado en varias semillas, sin cambio de regimen (debe rondar 0.92).
  3. run_montecarlo_for_symbol() en modo PRODUCCION (LAMBDA_POOL_MODE="fixed_low_power_n760",
     el default del modulo) debe dar lambda_pool=1.0 exacto -- a la profundidad real de datos
     (~760 dias), la calibracion de lambda_pool no separa de forma confiable un pool estable de
     uno con cambio de regimen (confirmado con 10 semillas: los rangos de vida_media/n de (a)
     estable [0.195, 27.62] y (b1) skew-flip [0.145, 27.62] se traslapan casi por completo), asi
     que en produccion queda fijo hasta que un backfill real permita re-validar.
  4. Determinismo, coherencia de cuantiles/VaR/CVaR, y ESS.

Corre: py test_montecarlo_synthetic.py
"""

import numpy as np

import montecarlo_engine as mc


def check(label, condition, detail=""):
    status = "OK" if condition else "FALLA"
    print(f"[{status}] {label}" + (f" -- {detail}" if detail else ""))
    return condition


def build_constant_vol_synthetic(n, sigma0, nu_first, nu_second, skew_first, skew_second, seed):
    """Volatilidad CONSTANTE (sin recursion EWMA): aisla cambios de FORMA (skew/curtosis) de
    cambios de NIVEL de volatilidad, que lambda_vol ya absorbe por su cuenta."""
    rng = np.random.default_rng(seed)
    returns = np.empty(n)
    for t in range(n):
        first_half = t < n // 2
        nu = nu_first if first_half else nu_second
        scale_down, scale_up = skew_first if first_half else skew_second
        u = np.clip(rng.standard_t(nu), -6.0, 6.0)
        innovation = u * (scale_down if u < 0 else scale_up)
        returns[t] = sigma0 * innovation
    closes = np.concatenate([[100.0], 100.0 * np.exp(np.cumsum(returns))])
    volumes = rng.integers(1_000_000, 5_000_000, size=n + 1).astype(float)
    dates = [f"2020-{1 + (i // 28) % 12:02d}-{1 + (i % 28):02d}" for i in range(n + 1)]
    return returns, closes, volumes, dates


def build_pure_ewma_synthetic(n, sigma0, lambda_vol_true, nu_true, seed):
    """Sin cambio de regimen: recursion EWMA real de principio a fin, para probar que
    calibrar_lambda_vol recupera lambda_vol_true sin sesgo relevante."""
    rng = np.random.default_rng(seed)
    sigma2 = sigma0 ** 2
    sigma2_ceiling = 25.0 * sigma0 ** 2
    returns = np.empty(n)
    for t in range(n):
        sigma = np.sqrt(sigma2)
        u = np.clip(rng.standard_t(nu_true), -6.0, 6.0)
        r = sigma * u
        returns[t] = r
        sigma2 = min(lambda_vol_true * sigma2 + (1 - lambda_vol_true) * r ** 2, sigma2_ceiling)
    return returns


def half_life(lam):
    return float("inf") if lam >= 1.0 else float(np.log(0.5) / np.log(lam))


def lambda_pool_ratio(returns, closes, volumes, n):
    """Llama calibrar_lambda_pool() DIRECTO (no run_montecarlo_for_symbol, que en modo
    produccion la salta) -- esto es lo que se reactivaria tras un backfill historico."""
    vol_fit = mc.calibrar_lambda_vol(returns)
    r_norm, v_norm = mc.build_pattern_vectors(closes, volumes)
    dist, valid_ends = mc.mahalanobis_pairwise_matrix(r_norm, v_norm)
    z_aligned = (returns / vol_fit["sigma_path"])[valid_ends]
    pool_fit = mc.calibrar_lambda_pool(z_aligned, dist)
    return half_life(pool_fit["lambda_pool"]) / n


def run():
    results = []

    # --- 1. Mecanismo de lambda_pool: separacion clara a n=5000 (potencia confirmada) ---
    print("--- 1. calibrar_lambda_pool(): vida_media/n a n=5000 (3 semillas por escenario) ---")
    n_power = 5000
    sigma0 = 0.015
    scenario_builders = {
        "(a) estable": lambda seed: build_constant_vol_synthetic(
            n_power, sigma0, 6.0, 6.0, (1.15, 1.15), (1.15, 1.15), seed)[:3],
        "(b1) skew flip": lambda seed: build_constant_vol_synthetic(
            n_power, sigma0, 6.0, 6.0, (1.0, 1.3), (1.3, 1.0), seed)[:3],
        "(b2) nu 30->3": lambda seed: build_constant_vol_synthetic(
            n_power, sigma0, 30.0, 3.0, (1.0, 1.0), (1.0, 1.0), seed)[:3],
    }
    ratios_by_scenario = {}
    for label, builder in scenario_builders.items():
        ratios = []
        for seed in range(5555, 5558):  # 3 semillas, distintas de las usadas en la investigacion previa
            returns, closes, volumes = builder(seed)
            ratios.append(lambda_pool_ratio(returns, closes, volumes, n_power))
        ratios_by_scenario[label] = ratios
        print(f"  {label}: vida_media/n = {[round(r, 3) for r in ratios]}")

    results.append(check(
        "1. (a) estable da vida_media/n sistematicamente mayor que (b1) y (b2) a n=5000",
        min(ratios_by_scenario["(a) estable"]) > max(ratios_by_scenario["(b1) skew flip"])
        and min(ratios_by_scenario["(a) estable"]) > max(ratios_by_scenario["(b2) nu 30->3"]),
        f"min(a)={min(ratios_by_scenario['(a) estable']):.3f}  "
        f"max(b1)={max(ratios_by_scenario['(b1) skew flip']):.3f}  "
        f"max(b2)={max(ratios_by_scenario['(b2) nu 30->3']):.3f}",
    ))

    # --- 2. lambda_vol recuperado en varias semillas ---
    print("\n--- 2. calibrar_lambda_vol(): recuperacion en 5 semillas, sin cambio de regimen ---")
    recovered = []
    for seed in range(5):
        returns = build_pure_ewma_synthetic(760, sigma0, lambda_vol_true=0.92, nu_true=6.0, seed=seed)
        vol_fit = mc.calibrar_lambda_vol(returns)
        recovered.append(vol_fit["lambda_vol"])
    recovered = np.array(recovered)
    print(f"  lambda_vol recuperado: {[round(r, 4) for r in recovered]}  media={recovered.mean():.4f}")
    results.append(check(
        "2. lambda_vol medio cerca del verdadero (0.92), sin cambio de regimen",
        abs(recovered.mean() - 0.92) < 0.05,
        f"media={recovered.mean():.4f}",
    ))

    # --- 3 y 4: run_montecarlo_for_symbol en modo PRODUCCION ---
    print("\n--- 3 y 4. run_montecarlo_for_symbol() en modo produccion (lambda_pool fijo) ---")
    returns_a, closes_a, volumes_a, dates_a = build_constant_vol_synthetic(
        760, sigma0, 6.0, 6.0, (1.15, 1.15), (1.15, 1.15), seed=42)
    result = mc.run_montecarlo_for_symbol("SINTETICO_A", "daily", closes_a, volumes_a, dates_a, n_paths=10000)
    result_repeat = mc.run_montecarlo_for_symbol("SINTETICO_A", "daily", closes_a, volumes_a, dates_a, n_paths=10000)

    results.append(check(
        "3a. lambda_pool=1.0 exacto en modo produccion",
        result["lambda_pool"] == 1.0,
        f"lambda_pool={result['lambda_pool']}  modo={mc.LAMBDA_POOL_MODE}",
    ))
    results.append(check(
        "3b. model_notes.lambda_pool_mode == 'fixed_low_power_n760'",
        result["model_notes"]["lambda_pool_mode"] == "fixed_low_power_n760",
        str(result["model_notes"]["lambda_pool_mode"]),
    ))
    results.append(check(
        "4a. Determinismo: misma semilla + mismos insumos -> resultado identico",
        result["probability_up"] == result_repeat["probability_up"]
        and result["var_95"] == result_repeat["var_95"]
        and result["seed"] == result_repeat["seed"],
        f"seed={result['seed']}",
    ))
    q = result["quantiles"]
    results.append(check(
        "4b. Cuantiles monotonos",
        q["p5"] <= q["p10"] <= q["p25"] <= q["p50"] <= q["p75"] <= q["p90"] <= q["p95"],
        str(q),
    ))
    results.append(check(
        "4c. VaR_99 mas extremo que VaR_95",
        result["var_99"] <= result["var_95"],
        f"var_95={result['var_95']:.5f}  var_99={result['var_99']:.5f}",
    ))
    results.append(check(
        "4d. CVaR_95 mas extremo que VaR_95",
        result["cvar_95"] <= result["var_95"],
        f"var_95={result['var_95']:.5f}  cvar_95={result['cvar_95']:.5f}",
    ))
    results.append(check(
        "4e. ESS menor que el tamanio crudo del pool",
        0 < result["effective_sample_size"] < result["pool_size"],
        f"ESS={result['effective_sample_size']:.2f}  pool_size={result['pool_size']}",
    ))
    print(f"\nResumen: P(sube)={result['probability_up']:.4f}  VaR95={result['var_95']:.5f}  "
          f"CVaR95={result['cvar_95']:.5f}  ESS={result['effective_sample_size']:.2f}  "
          f"N_min={result['n_min_threshold']:.4f}")

    total, passed = len(results), sum(results)
    print(f"\n{passed}/{total} chequeos pasaron.")
    return passed == total


if __name__ == "__main__":
    ok = run()
    raise SystemExit(0 if ok else 1)
