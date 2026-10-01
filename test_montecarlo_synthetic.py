"""Validacion sintetica de montecarlo_engine.py, ANTES de tocar datos reales (Fase B, sub-fase
3). Local, no se corre en CI, no toca Supabase ni GitHub Actions -- importa las mismas
funciones que usa la cascada, no reimplementa nada en paralelo.

Metodologia (tras varias rondas de revision, incluyendo el hallazgo de retroalimentacion real
en produccion para INTC/META que llevo a reemplazar la recursion EWMA por GARCH(1,1)):
  1. (a)/(b1)/(b2) a n=5000 (profundidad donde calibrar_lambda_pool SI tiene potencia) -- mide
     vida_media/n, no lambda_pool crudo. Demuestra que el mecanismo funciona, para poder
     reactivarlo tras un backfill historico (hoy LAMBDA_POOL_MODE lo deja fijo en 1.0).
  2. calibrar_garch(): recuperacion de `persistence` (alpha+beta) y `long_run_var` en varias
     semillas, sobre un GARCH(1,1) sintetico con parametros CONOCIDOS y genuinamente estable
     (alpha+beta<1 estricto -- a diferencia del generador EWMA viejo, este no necesita ningun
     tope artificial de sigma2, es estable por construccion).
  3. Renormalizacion del pool: E[z^2] ponderado debe quedar en 1.0 exacto DESPUES de
     reescalar (antes de reescalar puede ser distinto de 1, eso es justo lo que se corrige).
  4. run_montecarlo_for_symbol() en modo PRODUCCION: lambda_pool=1.0 exacto, campos GARCH
     presentes, determinismo, cuantiles/VaR/CVaR coherentes (ahora en retorno SIMPLE, no log),
     ESS.

Corre: py test_montecarlo_synthetic.py
"""

import numpy as np

import montecarlo_engine as mc


def check(label, condition, detail=""):
    status = "OK" if condition else "FALLA"
    print(f"[{status}] {label}" + (f" -- {detail}" if detail else ""))
    return condition


def build_constant_vol_synthetic(n, sigma0, nu_first, nu_second, skew_first, skew_second, seed):
    """Volatilidad CONSTANTE: aisla cambios de FORMA (skew/curtosis) de cambios de NIVEL de
    volatilidad, que el modelo de volatilidad (GARCH) ya absorbe por su cuenta."""
    rng = np.random.default_rng(seed)
    returns = np.empty(n)
    for t in range(n):
        first_half = t < n // 2
        nu = nu_first if first_half else nu_second
        scale_down, scale_up = skew_first if first_half else skew_second
        # Estandarizada (varianza 1), no la t cruda de NumPy (varianza nu/(nu-2)) -- mismo bug
        # que se encontro en montecarlo_engine.py, ver mc.standardized_t_draw().
        u = np.clip(mc.standardized_t_draw(rng, nu), -6.0, 6.0)
        innovation = u * (scale_down if u < 0 else scale_up)
        returns[t] = sigma0 * innovation
    closes = np.concatenate([[100.0], 100.0 * np.exp(np.cumsum(returns))])
    volumes = rng.integers(1_000_000, 5_000_000, size=n + 1).astype(float)
    dates = [f"2020-{1 + (i // 28) % 12:02d}-{1 + (i % 28):02d}" for i in range(n + 1)]
    return returns, closes, volumes, dates


def half_life(lam):
    return float("inf") if lam >= 1.0 else float(np.log(0.5) / np.log(lam))


def lambda_pool_ratio(returns, closes, volumes, n):
    """Llama calibrar_lambda_pool() DIRECTO (no run_montecarlo_for_symbol, que en modo
    produccion la salta) -- esto es lo que se reactivaria tras un backfill historico. Usa
    calibrar_garch() solo para obtener sigma_path (necesario para estandarizar los shocks),
    no para su propio resultado."""
    vol_fit = mc.calibrar_garch(returns)
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
        for seed in range(5555, 5558):
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

    # --- 2. calibrar_garch(): recuperacion de parametros conocidos, 5 semillas ---
    print("\n--- 2. calibrar_garch(): recuperacion en 5 semillas (GARCH genuino, sin tope artificial) ---")
    omega_true, alpha_true, beta_true, nu_true = 9e-6, 0.08, 0.88, 6.0
    persistence_true = alpha_true + beta_true
    lrv_true = omega_true / (1 - persistence_true)
    persistences, lrvs, nus = [], [], []
    for seed in range(10):
        returns, _, _, _ = mc.generar_sintetico_garch_conocido(
            n=760, omega_true=omega_true, alpha_true=alpha_true, beta_true=beta_true,
            nu_true=nu_true, seed=seed)
        fit = mc.calibrar_garch(returns)
        persistences.append(fit["persistence"])
        lrvs.append(fit["omega"] / (1 - fit["persistence"]))
        nus.append(fit["degrees_of_freedom"])
    persistences, lrvs, nus = np.array(persistences), np.array(lrvs), np.array(nus)
    print(f"  persistence recuperada: media={persistences.mean():.4f} (verdadero={persistence_true})")
    print(f"  long_run_var recuperada: media={lrvs.mean():.2e} (verdadero={lrv_true:.2e}) -- "
          f"ver nota: omega/(1-persistence) es numericamente inestable cuando persistence~1, "
          f"un error chico en persistence se amplifica al dividir; no afecta la simulacion real "
          f"(sigma_forecast usa omega/alpha/beta directo, nunca este cociente)")
    print(f"  nu recuperado: {[round(v, 2) for v in nus]}  media={nus.mean():.2f} (verdadero={nu_true})")
    results.append(check(
        "2a. persistence (alpha+beta) media cerca del verdadero (0.96)",
        abs(persistences.mean() - persistence_true) < 0.03,
        f"media={persistences.mean():.4f}",
    ))
    results.append(check(
        "2b. long_run_var media dentro de 50% del verdadero (ver nota de inestabilidad arriba)",
        abs(lrvs.mean() - lrv_true) / lrv_true < 0.50,
        f"media={lrvs.mean():.2e}  verdadero={lrv_true:.2e}",
    ))
    results.append(check(
        "2c. nu (grados de libertad) media cerca del verdadero (6.0), estimado conjuntamente "
        "con omega/alpha/beta (ya no via formula de curtosis)",
        abs(nus.mean() - nu_true) < 1.5,
        f"media={nus.mean():.2f}",
    ))

    # --- 3 y 4: run_montecarlo_for_symbol en modo PRODUCCION ---
    print("\n--- 3 y 4. run_montecarlo_for_symbol() en modo produccion ---")
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
        "3c. Campos GARCH presentes y dentro de rango valido (0<alpha+beta<1)",
        0 < result["garch_persistence"] < 1
        and result["garch_omega"] > 0 and result["garch_alpha"] >= 0 and result["garch_beta"] >= 0,
        f"omega={result['garch_omega']:.2e} alpha={result['garch_alpha']:.4f} "
        f"beta={result['garch_beta']:.4f} persistence={result['garch_persistence']:.4f}",
    ))
    results.append(check(
        "3d. model_notes.pool_e_z2_before_rescale presente (diagnostico, no se oculta)",
        "pool_e_z2_before_rescale" in result["model_notes"],
        f"valor={result['model_notes']['pool_e_z2_before_rescale']:.4f}",
    ))
    results.append(check(
        "3e. En el sintetico (todo estandarizado correctamente), E[z^2] ANTES de "
        "renormalizar ya sale cerca de 1 -- esto habria detectado el bug de escala-vs-t-"
        "estandarizada si hubiera existido cuando se escribio el generador",
        abs(result["model_notes"]["pool_e_z2_before_rescale"] - 1.0) < 0.3,
        f"valor={result['model_notes']['pool_e_z2_before_rescale']:.4f}",
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
        "4b. Cuantiles monotonos (retorno simple)",
        q["p5"] <= q["p10"] <= q["p25"] <= q["p50"] <= q["p75"] <= q["p90"] <= q["p95"],
        str({k: round(v, 4) for k, v in q.items()}),
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
    results.append(check(
        "4f. log_units presente en model_notes con las 6 claves esperadas",
        set(result["model_notes"]["log_units"].keys()) >= {"quantiles", "var_95", "cvar_95", "var_99", "cvar_99", "semi_deviation"},
        str(list(result["model_notes"]["log_units"].keys())),
    ))
    print(f"\nResumen: P(sube)={result['probability_up']:.4f}  VaR95(simple)={result['var_95']:.4%}  "
          f"CVaR95(simple)={result['cvar_95']:.4%}  ESS={result['effective_sample_size']:.2f}  "
          f"N_min={result['n_min_threshold']:.4f}")

    total, passed = len(results), sum(results)
    print(f"\n{passed}/{total} chequeos pasaron.")
    return passed == total


if __name__ == "__main__":
    ok = run()
    raise SystemExit(0 if ok else 1)
