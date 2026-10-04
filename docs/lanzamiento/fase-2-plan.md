# Fase 2 — Monte Carlo v2 en la gráfica: hallazgos y plan

- **Fecha:** 2026-10-03
- **Rama:** `lanzamiento-f2-montecarlo` (desde `main` en `77f0b69`)
- **Alcance de hoy:** solo investigación y plan. No se editó código de producción.
- **Referencias:** [fase-1-auditoria.md](fase-1-auditoria.md) (#3, #4, #8, #9, #47, #120, #127, #131) y [fase-1-persistencia.md](fase-1-persistencia.md).

---

## 1. Hallazgos

### a) Esquema real de `asset_montecarlo_simulation`

Definido en `schema.sql:468-501`. Clave primaria `(symbol, horizon)`, es decir, **una fila por activo y horizonte** que se sobrescribe cada noche (no guarda histórico).

| Grupo | Columnas |
|---|---|
| Identidad | `symbol`, `horizon` (`check in ('daily','weekly','monthly')`), `n_paths` (10 000), `seed` |
| Volatilidad GARCH | `garch_omega`, `garch_alpha`, `garch_beta`, `garch_persistence`, `garch_half_life_days`, `degrees_of_freedom` |
| Pool de remuestreo | `lambda_pool`, `effective_sample_size`, `n_min_threshold`, `pool_size` |
| **Resultado** | **`probability_up`** (`check between 0 and 1`), **`quantiles`** (jsonb) |
| Riesgo | `var_95`, `cvar_95`, `var_99`, `cvar_99`, `semi_deviation` |
| Asimetría | `sample_skewness_classical`, `sample_skewness_robust`, `realized_skewness_simulated` |
| Otros | `news_uncertainty_variance` (siempre 0), `b1_crosscheck`, `b2_crosscheck`, `model_notes` (jsonb), `computed_at` |

- **Percentiles guardados:** `quantiles = {p5, p10, p25, p50, p75, p90, p95}`, en **retorno simple** (`exp(x) − 1`) sobre el último cierre (`montecarlo_engine.py:447-473`). Las versiones en log están en `model_notes.log_units`.
- **Los 3 horizontes:** `STEPS_BY_HORIZON = {"daily": 1, "weekly": 5, "monthly": 21}` (`montecarlo_engine.py:55`). Cada paso es una fila de `asset_historical_prices`, o sea, **una sesión**.
- **"Probabilidad de cerrar arriba del precio actual": sí existe.** Es `probability_up = mean(retorno_log_acumulado > 0)` (`montecarlo_engine.py:446`). Como `log(P_T/P_0) > 0 ⇔ P_T > P_0`, es **exactamente** la fracción de trayectorias que terminan por encima del último cierre. Con 10 000 trayectorias el error estándar es ≤ 0.5 puntos, así que se debe mostrar **sin decimales** (p. ej. "54 %").
- **Lo que no existe:**
  1. **El paso 2 del horizonte diario ("pasado mañana").** No hay ninguna fila con 2 pasos y **no se puede derivar con exactitud** de la fila `daily`: la volatilidad GARCH del segundo paso depende del shock del primero, y la suma de dos pasos remuestreados no es una convolución simple de los cuantiles guardados. **Requiere guardar un dato nuevo** (ver sección 3).
  2. **La fecha del cierre que se usó (`as_of_date`).** Solo entra en la semilla (`derive_seed`, l. 418 y 565), no se guarda. Sin ella el navegador no puede saber si la simulación corresponde al último cierre que está mostrando.

### b) ¿"Mañana" y "pasado mañana" en días hábiles?

- **Sí, en sesiones, de forma implícita.** El motor no usa calendario: cada paso es "la siguiente fila" de `asset_historical_prices`, y esa tabla solo tiene filas de días con mercado (yfinance no devuelve fines de semana ni feriados para acciones ni futuros).
- **Viernes:** la corrida del viernes a las 22:00 UTC usa el cierre del viernes; el paso 1 es el **lunes** (o el martes si el lunes es feriado).
- **Feriados de EE. UU.:** el workflow (`.github/workflows/daily_update.yml`, `cron: '0 22 * * 1-5'`) también corre en feriados. Ese día yfinance no trae fila nueva, el último cierre no cambia, la semilla es la misma y el resultado se repite idéntico. No hay error, pero tampoco hay nada que avise.
- **Hora:** 22:00 UTC es 18:00 ET en horario de verano y 17:00 ET en invierno. En ambos casos es después del cierre de NYSE (16:00 ET) y del settlement de los futuros de CME.
- **Cripto (BTC-USD, cuando se agregue en la Fase 3):** opera 7 días y yfinance sí trae fines de semana, así que ahí un paso sería un **día natural**. Habrá que etiquetarlo distinto.
- **Consecuencia para la interfaz:** el texto correcto es **"Próxima sesión"** y **"En 2 sesiones"**, no "mañana". La fecha concreta solo se puede mostrar si el navegador la calcula desde `as_of_date`, saltando fines de semana y una tabla de feriados de NYSE (ver 2.4).

### c) Tarjetas ocultas #8 y #9

| Pieza | Ubicación |
|---|---|
| HTML | `index.html:96`: dos `<div class="bubble f1-oculto">` con `MÁS PROBABLE MAÑANA` → `#tomorrow-price` / `#tomorrow-prob`, y `MÁS PROBABLE PASADO MAÑANA` → `#next-price` / `#next-prob`. |
| CSS que las oculta | `index.html:58-67`: bloque "Fase 1 (1.7)", selector `.f1-oculto { display:none !important; }`. Las animaciones de `#tomorrow-price` / `#tomorrow-prob` están en `index.html:31`. |
| JS que las llena | `renderActiveAssetCards()` en `index.html:331`. Lo llaman `renderPortfolioChart()` (l. 338, dos veces), el cambio de horizonte (l. 339) y el cambio de activo (l. 497). |
| Origen de datos hoy | **Ninguno real.** `tomorrow = precio × (1 + σ × step)` y `next = tomorrow × (1 + σ × step × 2.05)`, con `step` y `prob1/prob2` **fijos** en `PREDICTION_HORIZON` (`index.html:325`). σ viene de `effectiveSigma(asset)` (l. 446) × un factor de noticias. Siempre sube, y la "probabilidad" es `prob1 / (1 + 2σ)`. |
| Mismo patrón en la gráfica | `renderPortfolioChart()` (l. 338): `markov`, `next`, `p10` y `p90` salen de la misma fórmula, y P10/P90 son **simétricos alrededor de un centro que siempre sube**. Por eso el abanico actual nunca puede bajar. |
| Mismo patrón en la tabla | `renderProbabilityTable()` (l. 306), panel "Rango estimado para mañana" (#47), visible hoy. |

### d) Tasa histórica de días al alza por activo

- **Definición ya usada en el proyecto:** día al alza = `close_t > close_{t-1}` (estricto), igual que `asset_signals.signal` (`actualizar_automatico.py:92` y `241`).
- **Ventana propuesta:** las **últimas 252 sesiones** (≈ 1 año bursátil), mostrando también `n` para que se vea la muestra. Con 252 días, el error estándar de una proporción cercana a 50 % es ≈ 3 puntos, suficiente como referencia.
- **Desde dónde (solo lectura), recomendado:** en el navegador, desde la serie `received.close` que `loadPortfolioHistoryData()` (l. 336) **ya descarga** de `/api/market/{symbol}` para la gráfica. No hace falta ninguna consulta nueva ni tocar tablas.
- **Alternativa:** en el endpoint público, con `asset_signals?symbol=eq.X&order=date.desc&limit=252`. **Cuidado:** ordenar `desc` y poner `limit` explícito. `patterns.js:19` lee `asset_signals` en orden `asc` y sin límite, así que si un símbolo pasa de 1 000 filas (`max_rows` por defecto de Supabase), recibiría solo las más antiguas. Es el mismo tipo de error que #131.
- **Uso:** es contexto, no predicción. Junto a la probabilidad Monte Carlo: "Históricamente subió el 52 % de las sesiones (últimas 252)". También sirve como prueba de cordura: si `probability_up` diaria se aleja mucho de esa tasa en muchos activos a la vez, hay algo que revisar.

### e) #127 — `persist_result` y `computed_at`

- **Ubicación:** `montecarlo_engine.py:673-683`.
- **Causa:** el payload se arma con una lista fija de llaves que **no incluye `computed_at`**. El `upsert(..., on_conflict="symbol,horizon")` de PostgREST genera un `INSERT … ON CONFLICT DO UPDATE SET` **solo con las columnas enviadas**. El `default timezone('utc', now())` de `schema.sql:497` solo se aplica en el `INSERT` de la primera vez; en cada actualización la columna conserva su valor original.
- **Corrección (sin cambio de esquema):** agregar `"computed_at": datetime.now(timezone.utc).isoformat()` al payload.

### f) `/api/montecarlo` hoy y endpoint público propuesto

**Estado actual** (`functions/api/montecarlo.js`):
- Protegido con `checkAdminAuth` (`functions/_shared/admin-auth.js`): 503 si falta el secreto, 401 sin header `X-Admin-Secret`. Verificado el 2026-10-02 (fase-1-persistencia.md:505).
- Devuelve `select=*` (los ~30 campos, incluidos `b1_crosscheck` y `b2_crosscheck`) para un solo horizonte, con `Cache-Control: no-store`.
- Fugas de nombres en errores dentro del mismo grupo de funciones: `admin-auth.js` responde "ADMIN_API_SECRET no configurada" y `market/[symbol].js` responde "Supabase historical store is not configured" o "No historical close rows…". El nuevo endpoint no debe seguir ese patrón.
- La tabla tiene RLS activado y **ninguna política**: solo la lee el `service_role`. Se mantiene así; **no se propone abrir RLS al rol `anon`**.

**Propuesta: `functions/api/escenarios.js` → `GET /api/escenarios?symbol=AAPL`**

- **Archivo nuevo y separado.** `/api/montecarlo` (admin) no se toca.
- **Una sola consulta** para los 3 horizontes, con un `select` explícito y nada de `*`:
  `horizon,probability_up,quantiles,computed_at,fan:model_notes->fan,as_of:model_notes->>as_of_date`
- **Validación:** `symbol` con `/^[A-Z0-9^=.\-]{1,15}$/` tras `toUpperCase()`. Cualquier otro método o parámetro se ignora.
- **Respuesta (nombres públicos, no de columnas):**

```json
{
  "symbol": "AAPL",
  "asOf": "2026-10-02",
  "updatedAt": "2026-10-02T22:14:05Z",
  "horizons": {
    "daily":   { "points": [ { "sessions": 1, "probUp": 0.54, "q": { "p5": -0.031, "p25": -0.009, "p50": 0.001, "p75": 0.011, "p95": 0.029 } },
                             { "sessions": 2, "probUp": 0.53, "q": { "...": 0 } } ] },
    "weekly":  { "points": [ { "sessions": 5,  "...": 0 }, { "sessions": 10, "...": 0 } ] },
    "monthly": { "points": [ { "sessions": 21, "...": 0 }, { "sessions": 42, "...": 0 } ] }
  }
}
```

  Solo se exponen p5, p25, p50, p75 y p95 (los que dibuja la interfaz). VaR, CVaR, GARCH, semillas, crosschecks y notas del modelo no salen.
- **Errores genéricos, sin nombres de variables ni de tablas:**
  - 400 `{"error":"Solicitud no válida."}`
  - 404 `{"error":"No disponible para este activo."}`
  - 503 / 502 `{"error":"Servicio no disponible por el momento."}`
- **Cache-Control:**
  - 200: `public, max-age=900, stale-while-revalidate=3600` (los datos cambian una vez al día; mismo `max-age` que `patterns.js`).
  - 404: `public, max-age=300`.
  - 5xx: `no-store`.
- Sin CORS adicional (mismo origen). `_routes.json` ya incluye `/api/*`.

### g) Activos sin filas de Monte Carlo

- **Fuente de la lista:** `montecarlo_engine.run_for_all_assets(supabase, assets)` recorre **solo** la lista `assets` de `actualizar_automatico.py:27-35`: 20 acciones y 10 futuros.
- **Activos del selector sin Monte Carlo** (`fmpSymbols`, `index.html:524`):
  - `btc` → `BTC-USD`
  - `sp500` y `country` → `^GSPC`
  - `bovespa` → `EWZ`
  - `nikkei` → `EWJ`

  En el explorador (`ASSET_CATALOG`) faltan además `ETH-USD` y `^DJI`. Es la misma causa que #120: **no tienen filas en `asset_historical_prices`** y agregarlos requiere tu aprobación (diferido a la Fase 3).
- **Otros casos en que no habrá datos:**
  - un símbolo con menos de 91 cierres (`MIN_RETURNS`, l. 56; se omite en l. 693);
  - un fallo del paso de Monte Carlo para ese símbolo u horizonte (se registra y se sigue, l. 707-710);
  - una simulación desactualizada (`asOf` distinto del último cierre que muestra la gráfica, p. ej. si la cascada falla como en #128).
- **Cómo se mostraría:**
  - **Tarjetas #8/#9:** se ven con el precio en "—" y el subtítulo "No disponible para este activo" (o "Simulación desactualizada" si el problema es la fecha). No se vuelve a la fórmula con σ.
  - **Gráfica:** solo el historial, sin abanico, con una nota bajo la leyenda: "Rango estimado no disponible para este activo." Para BTC, ^GSPC, EWZ y EWJ la gráfica ya sale vacía hoy por #120, así que el mensaje existente se mantiene.
  - **Tabla #47:** si se incluye en esta fase (decisión D3), las mismas tres filas con "—".

---

## 2. Diseño propuesto

### 2.1 Motor (`montecarlo_engine.py`), sin cambio de esquema

1. **#127:** incluir `computed_at` en el payload de `persist_result`.
2. **Segundo punto del abanico:** cada horizonte simula **2 × steps** pasos con la **misma semilla**:
   - diario: 1 → 2 sesiones;
   - semanal: 5 → 10;
   - mensual: 21 → 42.

   `simular_trayectorias` devuelve el acumulado en cada punto de control. Las columnas actuales (`probability_up`, `quantiles`, VaR, etc.) se calculan en `steps`, como hoy, y quedan **idénticas bit a bit**: los sorteos del generador para los primeros `steps` pasos no cambian y `news_uncertainty_variance = 0` no consume sorteos extra. Esto se comprueba en la prueba sintética.
3. **Nuevas llaves dentro de `model_notes`** (jsonb existente, sin `ALTER TABLE`):
   - `model_notes.fan = [{"sessions": s, "probability_up": …, "quantiles": {p5…p95}}]` para `s ∈ {steps, 2·steps}`, en retorno simple;
   - `model_notes.as_of_date = str(dates[-1])`.
4. **Lectura completa del historial:** `fetch_price_history` lee con `order=date.asc&limit=5000`. Si un símbolo supera el `max_rows` de Supabase (1 000 por defecto), recibiría solo las filas **más antiguas** y simularía sobre un cierre viejo, sin ningún error (el mismo tipo de error que #131). Hoy no ocurre (~504-760 filas), pero se propone leer `desc` con `limit` e invertir el orden en Python. `as_of_date` haría visible el problema en cualquier caso.

### 2.2 Endpoint público

`functions/api/escenarios.js`, como se describe en 1.f.

### 2.3 Tarjetas #8/#9 (`index.html`)

- Se quita `f1-oculto` **solo** de esas dos burbujas. Los demás elementos ocultos en la Fase 1 siguen igual.
- **Contenido** (horizonte diario, o el que esté elegido en Día/Semana/Mes):
  - Título: "PRÓXIMA SESIÓN · lun 5 oct" / "EN 2 SESIONES · mar 6 oct". Para Semana y Mes: "EN 5 SESIONES" / "EN 10 SESIONES", etc.
  - Precio grande: **mediana**, `cierre × (1 + p50)`.
  - Línea 1: "Rango probable (50 %): $X – $Y", con p25 y p75.
  - Línea 2: "Probabilidad de cerrar arriba de hoy: 54 %" (`probUp`, sin decimales).
  - Línea 3 (contexto, d): "Subió el 52 % de las últimas 252 sesiones".
- **Textos** coherentes con #8 y #9 de la Fase 1: nada de "más probable". La mediana es "escenario central", no una predicción.
- **Fuente de datos:** `/api/escenarios`, con caché en `localStorage` mediante el mismo `readCache`/`writeCache` (15 min) que usan patrones y correlación, y la misma protección `if (currentAssetKey !== key) return;` contra respuestas que lleguen tarde.

### 2.4 Fechas de sesión (b)

- Función pequeña `nextSessions(asOf, n)`: salta sábados, domingos y una constante `NYSE_HOLIDAYS` para 2026-2027.
  - **2026:** 01-01, 01-19, 02-16, 04-03, 05-25, 06-19, 07-03, 09-07, 11-26, 12-25.
  - **2027:** 01-01, 01-18, 02-15, 03-26, 05-31, 06-18, 07-05, 09-06, 11-25, 12-24.
- Para futuros de CME el calendario es casi el mismo. Las diferencias son de horario, no de fecha de cierre.
- Hay que renovar la lista antes de 2028. Queda anotado junto a la constante.

### 2.5 Abanico en la gráfica (`renderPortfolioChart`)

- **Se reemplaza la fórmula con σ.** Para el horizonte elegido, los 2 puntos futuros (que ya existen en la gráfica: Día 1/2, Semana 1/2, Mes 1/2) salen de `points[0]` y `points[1]`:
  - **Escenario central** = p50;
  - **Banda interna** p25-p75, relleno más intenso;
  - **Banda externa** p5-p95, relleno tenue, con `fill` entre datasets de Chart.js (ya cargado);
  - Se conservan "Escenario bajo/alto", ahora como p5/p95, para no romper la leyenda (`renderPortfolioChartLegend`).
- **El centro puede quedar por debajo de "Hoy"** y las bandas son asimétricas (FHS conserva el sesgo del pool).
- **Sin datos**, o con `asOf` distinto del último cierre de la serie: no hay abanico y aparece la nota de 1.g.
- **Efectos colaterales que hay que resolver en el mismo commit:**
  - `newsDebateScore` y `RISK_MULTIPLIER` ya no mueven el abanico (Monte Carlo usa `news_uncertainty_variance = 0`).
  - El botón "Recalcular" (l. 689) muestra el aviso "Abanico Markov recalculado." Se propone cambiarlo a "Noticia registrada; el rango estimado se recalcula cada noche." Requiere tu aprobación de texto.
  - El camino "Correlación (sombra)" sigue detrás de `SHOW_SHADOW_ENGINE` y no se toca.

---

## 3. Cambios de esquema

**Opción A (recomendada): ninguno.** Todo lo nuevo vive en `model_notes` (jsonb existente) y en el valor de `computed_at`, que ya existe. No se toca `asset_historical_prices`.

**Opción B — PENDIENTE DE MI APROBACIÓN (solo si prefieres columnas propias en lugar de `model_notes`):**

```sql
-- PENDIENTE DE APROBACIÓN. No aplicar sin confirmación del usuario.
alter table public.asset_montecarlo_simulation
  add column if not exists as_of_date date,
  add column if not exists fan jsonb;
```

Son columnas nulas y aditivas, sin tocar RLS ni la clave primaria. La ventaja es la claridad: `model_notes` hoy es diagnóstico interno. La desventaja es que exige una migración en producción antes de desplegar el motor.

---

## 4. Archivos a tocar

| Archivo | Cambio |
|---|---|
| `montecarlo_engine.py` | `computed_at` (#127); simular 2 × steps; `model_notes.fan` y `as_of_date`; lectura `desc` del historial |
| `test_montecarlo_synthetic.py` | Prueba de que las columnas principales no cambian bit a bit; prueba de que la p50 queda < 0 con deriva negativa; prueba de que el ancho crece con σ |
| `functions/api/escenarios.js` | **Nuevo**, endpoint público |
| `index.html` | Tarjetas #8/#9 (HTML l. 96, quitar `f1-oculto` en 2 burbujas); `renderActiveAssetCards` (l. 331); `renderPortfolioChart` (l. 338); leyenda (l. 340); `nextSessions` y `NYSE_HOLIDAYS`; aviso de "Recalcular" (l. 689) |
| `schema.sql` | Solo comentario de documentación sobre las llaves nuevas de `model_notes` (o el `ALTER` de la opción B, si se aprueba) |
| `docs/lanzamiento/fase-2-plan.md` | Este documento; al final, la sección de resultados |

No se tocan `functions/api/montecarlo.js`, `actualizar_automatico.py`, el workflow, `asset_historical_prices` ni las políticas RLS.

---

## 5. Orden de commits

Cada diff de producción se te muestra antes de aplicarlo. `git add` siempre por ruta.

1. `fix(montecarlo): #127 computed_at en el upsert de persist_result`
2. `feat(montecarlo): punto de 2×steps y as_of_date en model_notes (+ pruebas sintéticas)`. Incluye la lectura `desc` del historial.
3. `feat(api): /api/escenarios público de solo lectura con Cache-Control`
4. `feat(ui): tarjetas #8/#9 con Monte Carlo v2 (mediana, rango 50 %, prob. de cerrar arriba)`
5. `feat(ui): abanico Monte Carlo v2 en la gráfica y estado "no disponible"`
6. *(Solo si apruebas D3)* `feat(ui): tabla #47 de escenarios con cuantiles Monte Carlo`
7. `docs(lanzamiento): resultados de la Fase 2`

**Orden de despliegue:** los commits 1 y 2 se validan y el motor se vuelve a correr **antes** de publicar 4 y 5. Mientras `fan` no exista, la interfaz debe mostrar la tarjeta y el punto 2 como "no disponible", y eso también se prueba.

---

## 6. Cómo probar

> **Recordatorio:** el Preview de Cloudflare Pages y `workflow_dispatch` en la rama **escriben en la base de producción**.

1. **Local, sin red:**
   - `py test_montecarlo_synthetic.py`: las pruebas nuevas confirman que las columnas no cambian, que la mediana puede ser negativa y que el abanico se ensancha con la volatilidad.
   - `node --check functions/api/escenarios.js`.
2. **Motor en la rama, con tu aprobación previa:**
   - `workflow_dispatch` sobre `lanzamiento-f2-montecarlo` con `only_montecarlo = true`.
   - Ese camino sale antes de descargar precios (`actualizar_automatico.py:37-41`): **solo escribe `asset_montecarlo_simulation`** (90 upserts) y no toca `asset_historical_prices`, señales, Win Rate ni push.
   - Efecto en producción: `computed_at` se actualiza, aparecen `model_notes.fan` y `as_of_date`, y las columnas principales quedan iguales (mismo cierre, misma semilla).
   - Verificación por SQL (tú la corres en Supabase):

     ```sql
     select symbol, horizon, computed_at, model_notes->>'as_of_date' as as_of,
            quantiles->>'p50' as p50, probability_up,
            (quantiles->>'p95')::numeric - (quantiles->>'p5')::numeric as ancho_90
     from public.asset_montecarlo_simulation
     where horizon = 'daily'
     order by ancho_90 desc;
     ```

3. **Preview del sitio** (la URL de la rama en Cloudflare Pages):
   - `/api/escenarios?symbol=AAPL` → 200, solo los campos públicos, con `Cache-Control` correcto.
   - `?symbol=BTC-USD` → 404 genérico; `?symbol=<script>` → 400; ningún error menciona tablas ni variables.
   - En la terminal: AAPL, KO, TSLA, NG=F, GC=F (tarjetas y abanico); BTC, S&P 500, Bovespa y Nikkei ("no disponible"); cambio rápido de activo (sin datos cruzados); horizontes Día/Semana/Mes; escritorio y celular; consola sin errores.
   - **En el Preview no:** registrarte con correos reales, enviar sugerencias, activar push ni fijar metas. Todo eso escribe en `privacy_consents`, `user_suggestions`, `push_subscriptions` y `page_views` de producción. Entrar como invitado basta.

---

## 7. Criterio de salida

La Fase 2 se cierra cuando se cumple todo esto:

1. **El abanico puede bajar.** En producción, al menos un activo tiene `p50 < 0` en el horizonte diario y la gráfica lo dibuja por debajo de "Hoy". La prueba sintética con deriva negativa lo confirma de forma determinista.
2. **Se ensancha en activos volátiles.** El ancho `p95 − p5` diario de TSLA y NG=F es claramente mayor que el de KO y PG, en una proporción parecida a la de sus volatilidades. Se ve en la consulta SQL y en la gráfica.
3. **Tarjetas #8/#9:** muestran la mediana, el rango del 50 % y la probabilidad de Monte Carlo. No queda ningún valor de `PREDICTION_HORIZON.prob1/prob2` ni `σ × step` en la pantalla.
4. **"No disponible"** se muestra correctamente para BTC, ^GSPC, EWZ y EWJ, y cuando `asOf` no coincide con el último cierre.
5. **#127:** `computed_at` refleja la última corrida.
6. **`/api/escenarios`:** público, de solo lectura, con `Cache-Control`, sin `select=*` y sin nombres internos en los errores. `/api/montecarlo` sigue respondiendo 401 sin secreto.
7. Consola limpia en escritorio y celular.

---

## 8. Decisiones que necesito de ti

- **D1.** ¿Opción A (sin cambio de esquema, todo en `model_notes`) u opción B (`ALTER TABLE`, PENDIENTE DE APROBACIÓN)? Recomiendo A.
- **D2.** ¿Autorizas el `workflow_dispatch` con `only_montecarlo = true` sobre la rama? Escribe en `asset_montecarlo_simulation` de producción.
- **D3.** ¿La tabla "Rango estimado para mañana" (#47, `renderProbabilityTable`) también pasa a Monte Carlo en esta fase? Hoy usa la misma fórmula falsa y está visible. Recomiendo que sí (commit 6).
- **D4.** Las columnas de la tabla de activos (#3 "Proyección óptima" y #4) decían "vuelve en Fase 2 con Monte Carlo". Para traerlas haría falta un endpoint por lotes (30 símbolos). Propongo **diferirlas a la Fase 3** y mantener esta fase centrada en la gráfica y las tarjetas.
- **D5.** ¿Apruebas los textos nuevos: "Próxima sesión", "Rango probable (50 %)", "Probabilidad de cerrar arriba de hoy", "Subió el X % de las últimas 252 sesiones" y el aviso nuevo de "Recalcular"?
