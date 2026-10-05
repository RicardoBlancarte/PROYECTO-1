# Fase 2 — Monte Carlo v2 en la gráfica: hallazgos y plan

- **Fecha:** 2026-10-03 (revisión 3, con las decisiones de las rondas 2 y 3 del usuario)
- **Rama:** `lanzamiento-f2-montecarlo` (desde `main` en `77f0b69`)
- **Alcance de hoy:** solo investigación y plan. No se editó código de producción ni se ejecutó SQL.
- **Referencias:** [fase-1-auditoria.md](fase-1-auditoria.md) (#3, #4, #8, #9, #47, #120, #127, #128, #131) y [fase-1-persistencia.md](fase-1-persistencia.md).

---

## 0. Decisiones del usuario (2026-10-03) y respuestas

### Ronda 3 (vigente; prevalece sobre la ronda 2 donde difieran)

| # | Decisión |
|---|---|
| D1 | **SQL aprobado.** Lo ejecuta el usuario el **lunes 5-oct, DESPUÉS de verificar la corrida desde `main`** y antes de la corrida de la rama. `schema.sql` (CHECK de la l. 470 y columna `base_close_date`) se actualiza **en el mismo commit que el motor**. La migración queda en [fase-2-migracion.sql](fase-2-migracion.sql), con las dos consultas de verificación posterior (sección 3). |
| D2 | Sin cambios: la corrida de la rama solo se hace cuando el usuario avise. |
| D4 | Las columnas #3/#4 **se quedan como están** (ya ocultas desde la Fase 1). |
| "Recalcular" | **Fase 3, para ELIMINAR** (valores fijos, "Fuertemente alcista"), no corregir. No se toca en la Fase 2. |
| Textos | Tarjeta #9: **"Dentro de 2 sesiones (mar 6-oct)"**, con fecha calculada. Subtítulo de #47: **"Escenarios simulados a partir del historial del activo. No son una predicción."** |
| D6 | Aprobado: puntos 1-2 / 1-2-5 / 1-2-5-21, con el **eje horizontal proporcional a las sesiones**, nunca equidistante (2.6). |
| Ejecución | Se programa en la rama siguiendo la sección 5. Antes de cada commit se muestra el diff de los archivos de producción y se espera aprobación. `git add` por ruta. Sin push, sin SQL y sin workflow hasta que el usuario avise. |

### Ronda 2

| # | Decisión | Estado |
|---|---|---|
| D1 | No usar `model_notes`. "Pasado mañana" como **cuarto horizonte de 2 sesiones** en filas normales, más una columna nueva `base_close_date date`, nula y aditiva. | **Bloqueo encontrado:** el cuarto horizonte **sí requiere cambio de esquema**, porque hay un `CHECK`. Ver 0.1. SQL en la sección 3, **PENDIENTE DE APROBACIÓN, sin ejecutar**. |
| D2 | Aprobado correr el motor desde la rama, **solo después de que confirmes la corrida del lunes 5-oct desde `main`**. | Procedimiento de confirmación en la sección 6.2. |
| D3 | Aprobado: la tabla #47 pasa a Monte Carlo en esta fase. | Diseño en 2.6. |
| D4 | Si #3 y #4 muestran cifras de la fórmula falsa, se ocultan con `f1-oculto`. | Sí son de la fórmula falsa, pero **ya están ocultas** desde la Fase 1 con una regla CSS equivalente. Ver 0.3. |
| D5 | Textos nuevos. | Adoptados en 2.4. El aviso de "Recalcular" se cita textual en 0.4. |
| Otros | Si `base_close_date` no coincide con el último cierre mostrado → "No disponible". La tasa histórica muestra cuántas sesiones usó si son menos de 252. Anotar la caducidad de la tabla NYSE (Fase 5) y `patterns.js` (Fase 3). | Incorporado en 2.3, 2.4 y la sección 9. |

### 0.1 ¿Hay restricciones que limiten los horizontes a 1, 5 y 21?

**Sí. El cuarto horizonte no se puede guardar sin cambiar el esquema.**

| Dónde | Qué limita | Efecto de un horizonte `two_day` |
|---|---|---|
| **`schema.sql:470`**: `horizon text not null check (horizon in ('daily', 'weekly', 'monthly'))` | **CHECK de la tabla.** Postgres le pone nombre automático; lo esperado es `asset_montecarlo_simulation_horizon_check`, pero hay que confirmarlo con la consulta de la sección 3. | **El upsert falla** (`23514 check_violation`). El motor lo atrapa por símbolo y horizonte (`montecarlo_engine.py:707-708`), así que la cascada no se cae, pero **ninguna fila `two_day` se guarda**. |
| `montecarlo_engine.py:55`: `STEPS_BY_HORIZON = {"daily": 1, "weekly": 5, "monthly": 21}` | El motor solo calcula esas llaves (valida en l. 489 y recorre en l. 697). | Agregar `"two_day": 2` basta para que se calcule. |
| `montecarlo_engine.py:688` (docstring "x 3 horizontes") | Solo documentación. | Hay que actualizar el texto. |
| `montecarlo_engine.py:699`: `fetch_b1_crosscheck(..., horizon)` | Lee `asset_sensitivity_factor`, cuyo CHECK (`schema.sql:398`) solo admite los 3 horizontes. | Para `two_day` no hay fila: `b1_crosscheck` queda `null` (la columna es nula). No falla. |
| `functions/api/montecarlo.js:16` (admin) | Lista blanca de 3 horizontes; cualquier otro valor **cae en silencio a `daily`**. | El panel admin no podría leer `two_day`. Propuesta: agregarlo a la lista (una línea; diff a mostrar). |
| `functions/api/markov-matrix.js:29`, `patterns.js:7`, `patterns-vectors.js:28`, `sensitivity-factor.js:20-38` y los CHECK de `asset_pattern_snapshots`, `asset_pattern_vectors*`, `asset_sensitivity_factor` y `user_state.prediction_horizon` | Son de **otras** tablas y motores. | No se tocan. No dependen de esta tabla. |
| `test_montecarlo_synthetic.py` | Solo prueba `daily` (l. 146-147). | Se agrega un caso `two_day`. |

**¿Qué asume 90 filas (30 activos × 3 horizontes)?**

- **Código:** nada cuenta ni valida 90 filas. Ni el motor, ni la cascada, ni el workflow, ni `health.js`, ni el panel admin.
- **Log:** el motor escribe una línea por símbolo y horizonte (`Monte Carlo (SYM, horizon): P(sube)=…`, l. 705). Hoy son 90 líneas cuando todo va bien; con `two_day` serán **120**. No hay ningún resumen ni conteo automático.
- **Controles y documentos:** la revisión 1 de este plan decía "90 upserts" en la prueba de `workflow_dispatch`. Ya está corregido a 120. Ningún otro documento de `docs/lanzamiento/` lo asume.
- **Para no confundirse:** `MIN_RETURNS = 90` (`montecarlo_engine.py:56`) **no tiene relación** con esto. Es el mínimo de retornos de historial por activo para simular (se omite si hay ≤ 90 cierres, l. 693).

### 0.2 Alternativa sin cambio de esquema

No existe una que cumpla D1. Las filas `weekly` y `monthly` usan otra semilla y otro número de pasos, y no sirven como "pasado mañana". Las únicas alternativas sin `ALTER` eran guardar el punto de 2 sesiones en `model_notes` (descartado en D1) o reutilizar un valor existente del CHECK con otro significado (no recomendado).

### 0.3 D4: qué muestran hoy las columnas #3 y #4

`renderTopPicks()` (`index.html:324`) ordena los activos por `effectiveSigma × 0.21` y arma:

| Columna | Contenido | ¿Fórmula falsa? |
|---|---|---|
| #4 "Movimiento estimado (1 día)" (2ª) | `Alcista (x.x%)` con `x = σ × 0.21`. Siempre ≥ 0, así que **siempre dice "Alcista"**. | **Sí** |
| #3 "Proyección óptima" (3ª) | `precio × (1 + σ × 0.21)`. Siempre por encima del precio actual. | **Sí** |

- **Ya están ocultas desde la Fase 1** con `.top-picks-table th:nth-child(2|3), td:nth-child(2|3)` en el mismo bloque CSS de `f1-oculto` (`index.html:62-63`). No se ven, y `display:none` también las saca del árbol de accesibilidad.
- **El botón "Compartir" no filtra esas cifras:** `enviarAlertaWhatsApp` recibe `tendencia` y `precio`, pero el mensaje solo usa el nombre del activo (`index.html:323`).
- **Propuesta:** dejarlas como están (cero cambios). Si prefieres la clase literal `f1-oculto`, son dos ediciones pequeñas: el `<thead>` en el HTML y la plantilla de `renderTopPicks`. El resultado visible es el mismo. **Pendiente de tu confirmación.**

### 0.4 Aviso del botón "Recalcular" (textual)

`index.html:689`:

```js
$('recalculate').onclick = () => {
  if (!$('news-input').value.trim()) return showToast('Escribe un evento geopolítico primero.', true);
  $('nlp-score').textContent = '+0.65';
  $('bias').textContent = 'Fuertemente alcista';
  $('brief').textContent = 'El nuevo evento modifica positivamente la prima de riesgo. Proyección recalculada.';
  $('last-update').textContent = 'Ahora';
  renderPortfolioChart();
  showToast('Abanico Markov recalculado.');
};
```

- **Hoy nadie lo ve.** El botón está en la sección "Market brief" (`<section class="panel hidden">`, l. 116), dentro del `<aside class="stack f1-oculto">` (l. 114-117) que la Fase 1 ocultó completo (#109). Además, todos sus valores son fijos: `+0.65`, "Fuertemente alcista".
- **Propuesta:** no tocarlo en la Fase 2 y registrarlo para la Fase 3, cuando vuelva "Estado de mercado". Llama a `renderPortfolioChart()`, que seguirá funcionando con el abanico nuevo.
- **Si prefieres corregir ya el aviso**, texto propuesto: "Evento registrado. El rango estimado se recalcula cada noche con el último cierre." **Pendiente de tu aprobación.**

---

## 1. Hallazgos (revisión 1, vigentes)

### a) Esquema real de `asset_montecarlo_simulation`

`schema.sql:468-501`. Clave primaria `(symbol, horizon)`: **una fila por activo y horizonte**, sobrescrita cada noche.

- **Percentiles:** `quantiles = {p5, p10, p25, p50, p75, p90, p95}`, en **retorno simple** sobre el último cierre (`montecarlo_engine.py:447-473`).
- **Horizontes:** `daily = 1`, `weekly = 5`, `monthly = 21` sesiones (una sesión = una fila de `asset_historical_prices`).
- **"Probabilidad de cerrar arriba del precio actual": existe.** Es `probability_up = mean(retorno_log_acumulado > 0)` (l. 446), exactamente la fracción de trayectorias que terminan arriba del último cierre. Con 10 000 trayectorias el error es ≤ 0.5 puntos: se muestra **sin decimales**.
- **No existen** el punto de 2 sesiones ni la fecha del cierre base. Solo entra en la semilla (`derive_seed`, l. 418 y 565). Se resuelve con D1.

### b) Días hábiles

- **Son sesiones, de forma implícita.** El motor no usa calendario; cada paso es la siguiente fila de precios, y esa tabla solo tiene días con mercado.
- **Viernes:** el paso 1 es el lunes (o el martes si el lunes es feriado).
- **Feriados:** el cron (`0 22 * * 1-5`) corre igual, pero no llega fila nueva y el resultado se repite idéntico. Con `base_close_date` la página muestra "Datos al cierre del …", así que no engaña.
- **Cripto (Fase 3):** opera 7 días, así que un paso sería un día natural y habrá que etiquetarlo distinto.

### c) Tarjetas #8 y #9

| Pieza | Ubicación |
|---|---|
| HTML | `index.html:96`: dos `<div class="bubble f1-oculto">` con `#tomorrow-price`/`#tomorrow-prob` y `#next-price`/`#next-prob` |
| CSS | `.f1-oculto` en el bloque "Fase 1 (1.7)", `index.html:58-67`; animaciones en l. 31 |
| JS | `renderActiveAssetCards()`, `index.html:331` |
| Datos hoy | **Ninguno real:** `precio × (1 + σ × step)`, con `step`, `prob1` y `prob2` fijos en `PREDICTION_HORIZON` (l. 325). La gráfica (l. 338) y la tabla #47 (l. 306) usan la misma fórmula. |

### d) Tasa histórica de días al alza

- **Definición:** día al alza = `close_t > close_{t-1}`, igual que `asset_signals.signal` (`actualizar_automatico.py:92` y `241`).
- **Ventana:** las últimas 252 sesiones.
- **Fuente:** en el navegador, con la serie que `loadPortfolioHistoryData()` (l. 336) **ya descarga** de `/api/market/{symbol}`. Sin consultas nuevas.
- **Pocas sesiones:** si hay menos de 252, se usan las disponibles y el texto lo dice (2.4).

### e) #127

En `montecarlo_engine.py:673-683` el payload no incluye `computed_at`, y el upsert de PostgREST solo actualiza las columnas enviadas. El valor por defecto (`schema.sql:497`) solo se aplica en el primer `INSERT`. Corrección: enviar `computed_at` en UTC. **No cambia el esquema.**

### f) Endpoint público

- **`/api/montecarlo` hoy:** responde 401 sin `X-Admin-Secret` y devuelve `select=*`. No se toca, salvo la lista blanca de 0.1.
- **Propuesta:** `GET /api/escenarios?symbol=X`, detallado en 2.2.

### g) Activos sin Monte Carlo

- El motor solo recorre los 30 símbolos de `actualizar_automatico.py:27-35`.
- Del selector no tienen simulación `BTC-USD`, `^GSPC` (claves `sp500` y `country`), `EWZ` y `EWJ`; en el explorador faltan además `ETH-USD` y `^DJI`. Misma causa que #120.
- Tampoco habrá datos si un activo tiene ≤ 90 cierres, si el paso falla para ese símbolo, o si `base_close_date` no coincide con el último cierre mostrado.
- En todos esos casos se muestra **"No disponible"** (2.3).

---

## 2. Diseño (revisión 2)

### 2.1 Motor (`montecarlo_engine.py`)

1. **#127:** `computed_at` en el payload de `persist_result`.
2. **Cuarto horizonte:** `STEPS_BY_HORIZON = {"daily": 1, "two_day": 2, "weekly": 5, "monthly": 21}`. Tiene semilla propia (`derive_seed` incluye el horizonte) y sale por el mismo camino de cálculo que los demás. Las filas `daily`, `weekly` y `monthly` **no cambian**: misma semilla y mismos pasos.
3. **`base_close_date`:** `str(dates[-1])` en el resultado y en el payload.
4. **Historial completo:** `fetch_price_history` lee en orden `asc` con `limit=5000`. Si un símbolo supera el `max_rows` de Supabase (1 000 por defecto), recibiría solo las filas **más antiguas**, sin error. Hoy no pasa (~504-760 filas). Se cambia a `desc` con `limit` y se invierte en Python. Si fallara, `base_close_date` lo delataría y la página mostraría "No disponible".
5. **Textos:** el docstring "x 3 horizontes" pasa a "x 4 horizontes".
6. **Panel admin:** `functions/api/montecarlo.js:16` acepta `two_day` en la lista blanca.

**Costo** (corregido en la ronda 4): `run_montecarlo_for_symbol` vuelve a calibrar GARCH y a calcular Mahalanobis en **cada** horizonte. Agregar `two_day` suma ≈ 1/3 del trabajo fijo por activo, más 2 pasos de simulación (antes decía "+7 %", que solo contaba la simulación). Esperado: el tramo de Monte Carlo dura ≈ 1.2× a 1.4× (6.2.B.4).

### 2.2 Endpoint público `functions/api/escenarios.js`

- **Ruta:** `GET /api/escenarios?symbol=AAPL`. Archivo **nuevo y separado** del admin. Usa `service_role` del lado del servidor y **no se abre RLS a `anon`**.
- **Consulta única:** `symbol=eq.X&select=horizon,probability_up,quantiles,base_close_date,computed_at` → hasta 4 filas.
- **Validación:** `symbol` con `/^[A-Z0-9^=.\-]{1,15}$/` tras `toUpperCase()`.
- **Respuesta** (implementada en el commit 3, `7cc1845`): los cuantiles **p5, p10, p25, p50, p75, p90 y p95** (el abanico usa p5-p95; ronda 5). Nada de VaR, GARCH, semillas ni crosschecks.

```json
{
  "symbol": "AAPL",
  "updatedAt": "2026-10-02T22:14:05+00:00",
  "horizons": {
    "daily":   { "sessions": 1,  "baseCloseDate": "2026-10-02", "probUp": 0.54,
                 "q": { "p5": -0.031, "p10": -0.021, "p25": -0.009, "p50": 0.001, "p75": 0.011, "p90": 0.022, "p95": 0.029 } },
    "two_day": { "sessions": 2,  "baseCloseDate": "2026-10-02", "probUp": 0.53, "q": { "...": 0 } },
    "weekly":  { "sessions": 5,  "baseCloseDate": "2026-10-02", "...": 0 },
    "monthly": { "sessions": 21, "baseCloseDate": "2026-10-02", "...": 0 }
  }
}
```

- **`baseCloseDate` va SIEMPRE por horizonte** (aprobado en la ronda 5), no una sola vez arriba. La página compara cada horizonte con el último cierre que muestra (2.3). `updatedAt` es el `computed_at` más reciente entre los horizontes publicados.
- **Filas omitidas** (ese horizonte se muestra "No disponible"):
  - las que no traen `base_close_date` (escritas por el motor viejo);
  - las de un horizonte desconocido;
  - las que tienen `probability_up` fuera de [0, 1] o algún cuantil faltante o no numérico.

  Si no queda ninguna, responde 404.
- **Errores genéricos**, sin nombres de tablas ni de variables:
  - 400 "Solicitud no válida."
  - 404 "No disponible para este activo."
  - 5xx "Servicio no disponible por el momento."
- **Cache-Control:**
  - 200: `public, max-age=900, stale-while-revalidate=3600`;
  - 404: `public, max-age=300`;
  - 5xx: `no-store`.

### 2.3 Regla de "No disponible"

Para cada horizonte se muestra "No disponible" si se cumple cualquiera de estas condiciones:

- no hay fila;
- el endpoint falla;
- `base_close_date` ≠ última fecha de la serie que dibuja la gráfica (`received.dates.at(-1)`).

En esos casos no se vuelve a la fórmula con σ. Esta regla cubre tres situaciones:

- los activos sin simulación (1.g);
- una cascada que falló (#128);
- **el periodo entre la corrida de la rama y el merge.** La cascada de `main` (motor viejo) actualiza `daily`, `weekly` y `monthly` sin enviar `base_close_date`. El upsert solo cambia las columnas enviadas, así que `base_close_date` conserva la fecha de la corrida de la rama y deja de coincidir. Las filas `two_day` no se actualizan. Resultado: la página muestra "No disponible" en lugar de cifras mezcladas, que es el comportamiento seguro.

### 2.4 Tarjetas #8/#9 (textos de D5)

- Se quita `f1-oculto` **solo** de esas dos burbujas.
- **Las tarjetas siempre muestran 1 y 2 sesiones**, sin importar el selector Día/Semana/Mes, que solo afecta a la gráfica.

| Elemento | Tarjeta #8 (`daily`) | Tarjeta #9 (`two_day`) |
|---|---|---|
| Título | **"Próxima sesión (lun 5-oct)"** | **"Dentro de 2 sesiones (mar 6-oct)"** (aprobado; fecha calculada con `nextSessions`) |
| Cifra grande | Mediana: `cierre × (1 + p50)` | Ídem |
| Línea 1 | **"La mitad de los escenarios simulados cae entre $X y $Y"** (p25-p75) | Ídem |
| Línea 2 | **"Escenarios que cierran arriba del último cierre: 54 %"** (`probUp`, sin decimales) | Ídem |

**Debajo de las tarjetas, una sola vez:**

- **"Cerró al alza en X de las últimas 252 sesiones (Y %)"**. Si hay menos de 252, el número real: "Cerró al alza en 61 de las últimas 118 sesiones (52 %)".
- **"Datos al cierre del vie 2-oct"**, a partir de `base_close_date`.

**Formato de fecha:** día abreviado + `d-mmm` en español (`lun 5-oct`), con `toLocaleDateString('es-MX', …)` y la fecha tratada como UTC para que la zona horaria no la mueva un día.

**Sin datos:** cifra "—" y subtítulo "No disponible para este activo". La línea "Datos al cierre…" se oculta.

### 2.5 Fechas de sesión

- Función `nextSessions(baseCloseDate, n)`: salta sábados, domingos y la constante `NYSE_HOLIDAYS`.
  - **2026:** 01-01, 01-19, 02-16, 04-03, 05-25, 06-19, 07-03, 09-07, 11-26, 12-25.
  - **2027:** 01-01, 01-18, 02-15, 03-26, 05-31, 06-18, 07-05, 09-06, 11-25, 12-24.
- Para futuros de CME las fechas de cierre coinciden en la práctica.
- **La tabla caduca el 31-dic-2027** y se anota para la Fase 5 (sección 9).

### 2.6 Abanico en la gráfica

Con el cuarto horizonte, los puntos futuros salen de **filas reales**. Ya no existen "Semana 2" ni "Mes 2" (10 y 42 sesiones), porque no hay filas para ellos.

| Selector | Puntos futuros (sesiones) | Filas |
|---|---|---|
| Día | 1, 2 | `daily`, `two_day` |
| Semana | 1, 2, 5 | `daily`, `two_day`, `weekly` |
| Mes | 1, 2, 5, 21 | `daily`, `two_day`, `weekly`, `monthly` |

- **Eje horizontal proporcional a las sesiones (aprobado en D6):** nunca equidistante. La distancia entre "Hoy" y el punto de 21 sesiones es 21 veces la de "Hoy" a 1 sesión. Se usa un eje `linear` de Chart.js con datos `{x, y}`: el historial va en `x = −(n−1) … 0` (una unidad por sesión) y el futuro en `x = 1, 2, 5, 21`. Las marcas del eje muestran la fecha (`lun 5-oct` …, con `nextSessions`) en los puntos futuros y la fecha del historial en los pasados.
- **Escenario central** = p50.
- **Sin líneas p10/p90 en la gráfica** (ronda 7): quedan las bandas p5-p95 y p25-p75 y la mediana. p10/p90 siguen en la tabla #47. El punto del último cierre se llama **"Último cierre"** (no "Hoy") y el pulso lo localiza por `dataset.role = 'last-close'`, no por el texto visible.
- **Banda interna** p25-p75, sombreada con `fill` entre datasets (Chart.js ya está cargado).
- **Banda externa p5-p95** (ronda 5), con relleno tenue: es el abanico completo. Las líneas p10/p90 quedan dentro de ella.
- **El centro puede quedar debajo de "Hoy"** y las bandas son asimétricas.
- **Puntos de semillas distintas:** cada punto viene de una simulación independiente, así que puede haber diferencias de ruido de ±0.5 puntos entre horizontes. Es despreciable frente al ancho del abanico.
- **Sin datos** (2.3) en un horizonte: se omite ese punto. Si no hay ninguno, no se dibuja abanico y aparece la nota "Rango estimado no disponible para este activo."
- **`newsDebateScore` y `RISK_MULTIPLIER` ya no mueven el abanico.** Monte Carlo usa `news_uncertainty_variance = 0`.
- **D6 aprobado** (ronda 3).

### 2.7 Tabla #47 (`renderProbabilityTable`, D3)

- **Filas** (horizonte `daily`):
  - "Escenario central" = p50;
  - "Escenario bajo (10 %)" = p10;
  - "Escenario alto (90 %)" = p90.

  Los rótulos actuales coinciden exactamente con los percentiles guardados.
- **Se mantiene oculto** lo que ya ocultó la Fase 1: columna de señal (#98), columna de confianza (#48) y fila de la mediana (#98).
- **Columna "Efecto de noticias":** sigue con `countryBriefs`, no se toca.
- **Subtítulo actual:** "Escenarios bajo, central y alto calculados con la volatilidad del activo." Deja de ser cierto. Nuevo (aprobado): **"Escenarios simulados a partir del historial del activo. No son una predicción."**
- **Sin datos:** las tres filas con "—" y "No disponible para este activo".

---

## 3. Cambios de esquema — APROBADOS (D1, ronda 3); los ejecuta el usuario

- **Archivo:** [fase-2-migracion.sql](fase-2-migracion.sql) (paso 0: nombre del CHECK; paso 1: migración; paso 2: verificación).
- **Cuándo:** el lunes 5-oct, **después** de verificar la corrida de `main` (6.2.A) y **antes** de la corrida de la rama (6.2.B). El agente no ejecuta SQL.
- **`schema.sql`:** se actualiza en el **mismo commit que el motor** (commit 2), con la columna `base_close_date` y el CHECK de la l. 470 con `two_day`.
- **Verificación posterior** (paso 2 del archivo):
  - **2a.** Definición del CHECK. Esperado: `CHECK ((horizon = ANY (ARRAY['daily'::text, 'two_day'::text, 'weekly'::text, 'monthly'::text])))`.
  - **2b.** `information_schema.columns` para `base_close_date`. Esperado: `data_type = date`, `is_nullable = YES` y `column_default` nulo.

El SQL de abajo es el mismo que el del archivo.

**Paso previo (solo lectura):** confirmar el nombre real del CHECK.

```sql
select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'public.asset_montecarlo_simulation'::regclass
  and contype = 'c';
-- Esperado: dos filas. La de horizon debería llamarse
-- asset_montecarlo_simulation_horizon_check; la otra es la de probability_up.
```

**Migración** (usar el nombre confirmado arriba):

```sql
-- Aprobado (D1, ronda 3). Lo ejecuta el usuario el 5-oct tras verificar la corrida de main.
begin;

alter table public.asset_montecarlo_simulation
  add column if not exists base_close_date date;

alter table public.asset_montecarlo_simulation
  drop constraint asset_montecarlo_simulation_horizon_check;

alter table public.asset_montecarlo_simulation
  add constraint asset_montecarlo_simulation_horizon_check
  check (horizon in ('daily', 'two_day', 'weekly', 'monthly'));

commit;
```

- **Aditiva y compatible con el motor actual de `main`:** no envía `base_close_date` (queda `null`) y solo usa los 3 horizontes, que siguen siendo válidos. Puede aplicarse antes o después de la corrida del lunes.
- **No toca** RLS, la clave primaria, otras tablas ni `asset_historical_prices`.
- **Validación inmediata:** el `add constraint` revisa las filas existentes. Todas tienen `daily`, `weekly` o `monthly`, así que no puede fallar por datos.
- **REGLA (ronda 4): la migración se aplica SIEMPRE antes de cualquier corrida de este motor o de cualquier merge a `main`.** Desde el commit 2, `persist_result` envía `base_close_date` y puede escribir `horizon = 'two_day'`. Sin la migración, el upsert falla para **todos** los símbolos: por columna inexistente (`PGRST204`) o por el CHECK (`23514`). El error queda atrapado y registrado en el log, pero no entra ningún dato nuevo, y tras un merge la cascada nocturna de `main` dejaría de actualizar Monte Carlo.
- **REGLA (ronda 4): si el Paso 0 devuelve un nombre de CHECK distinto de `asset_montecarlo_simulation_horizon_check`**, se corrigen **primero** `schema.sql` y `fase-2-migracion.sql` (commit aparte, con el diff revisado) y solo después se ejecuta la migración. No se ejecuta nada con el nombre equivocado.
- **Caché de PostgREST:** Supabase recarga el esquema solo tras un DDL. Si `/api/escenarios` respondiera con columna desconocida, ejecutar `notify pgrst, 'reload schema';`.
- **`schema.sql`** se actualiza en el mismo commit 2: la columna y el CHECK en la definición de la tabla, más el bloque de migración comentado.

---

## 4. Archivos a tocar

| Archivo | Cambio |
|---|---|
| `montecarlo_engine.py` | `computed_at` (#127); horizonte `two_day`; `base_close_date`; lectura `desc` del historial; docstring |
| `test_montecarlo_synthetic.py` | Caso `two_day` (determinismo con la misma semilla; ancho ≈ √2 × el diario); caso con deriva negativa que da p50 < 0; ancho mayor con σ mayor |
| `functions/api/montecarlo.js` | Lista blanca + `two_day` (una línea) |
| `functions/api/escenarios.js` | **Nuevo**, endpoint público |
| `index.html` | Tarjetas #8/#9 (l. 96, `renderActiveAssetCards` l. 331); abanico (`renderPortfolioChart` l. 338, leyenda l. 340); tabla #47 (l. 306 y subtítulo l. 109); `nextSessions` y `NYSE_HOLIDAYS`; tasa histórica y "Datos al cierre del …" |
| `schema.sql` | Columna `base_close_date` y CHECK de la l. 470 con `two_day`, en el mismo commit que el motor |
| `docs/lanzamiento/fase-2-migracion.sql` | Migración aprobada y verificaciones (la ejecuta el usuario) |
| `docs/lanzamiento/fase-2-plan.md` | Este documento y, al final, los resultados |

No se tocan `actualizar_automatico.py`, el workflow, `asset_historical_prices`, RLS, el botón "Recalcular" (0.4) ni las columnas #3/#4 (0.3), salvo que lo pidas.

---

## 5. Orden de trabajo y commits

Cada diff de producción se te muestra antes de aplicarlo. `git add` siempre por ruta. Nada directo a `main`.

1. `fix(montecarlo): #127 computed_at en el upsert de persist_result`
2. `feat(montecarlo): horizonte two_day (2 sesiones) y base_close_date; lectura desc del historial; pruebas; schema.sql (CHECK l. 470 + columna); lista admin`
3. **(Lunes 5-oct, cuando el usuario avise)**
   - a) El usuario verifica la corrida de `main` (6.2.A).
   - b) El usuario ejecuta [fase-2-migracion.sql](fase-2-migracion.sql) y sus verificaciones.
   - c) `workflow_dispatch` en la rama con `only_montecarlo = true` (6.2.B).

   Los commits 4-7 pueden programarse antes, porque no dependen de la base.

   **Regla (sección 3):** la migración va siempre antes de cualquier corrida de este motor o de cualquier merge a `main`.
4. `feat(api): /api/escenarios público de solo lectura con Cache-Control`
5. `feat(ui): tarjetas #8/#9 con Monte Carlo v2, tasa histórica y fecha de datos`
6. `feat(ui): abanico Monte Carlo v2 en la gráfica y estado "No disponible"`
7. `feat(ui): tabla #47 con cuantiles Monte Carlo`
8. `docs(lanzamiento): resultados de la Fase 2`

**Probar el Preview la misma noche de la corrida 3** (antes de las 22:00 UTC siguientes). Después, la cascada de `main` vuelve a desalinear `base_close_date` (2.3) y el Preview mostrará "No disponible" hasta el merge. Eso es correcto, pero impide validar las cifras. Si hace falta, se repite la corrida 3.

---

## 6. Cómo probar

> **Recordatorio:** el Preview de Cloudflare Pages y `workflow_dispatch` en la rama **escriben en la base de producción**.

### 6.1 Local, sin red

- `py test_montecarlo_synthetic.py`: pruebas nuevas (determinismo de `two_day`, mediana negativa con deriva negativa, ancho creciente con σ) y las existentes sin cambios.
- `node --check functions/api/escenarios.js` y `node --check functions/api/montecarlo.js`.

### 6.2 D2: confirmar la corrida del lunes 5-oct desde `main` y luego correr solo Monte Carlo

**A. Lunes 5-oct, corrida programada de `main` (22:00 UTC, motor viejo).** En el log del paso "Ejecutar script de actualización" deben aparecer:

- `Descarga de precios con ventana 5d.`
- Por activo: `SYM: N filas nuevas…; último día 2026-10-05 …`, sin `APIError 23502` (#128).
- `Precios: N filas nuevas en total; …`
- `Señales binarias (asset_signals) actualizadas en Supabase.`
- `Web Push: ttl=… s; …` y, si cambió alguna fase, `Push aceptado para …`.
- 90 líneas `Monte Carlo (SYM, daily|weekly|monthly): P(sube)=…`, sin `Error en Monte Carlo`.
- Termina sin traceback y el job sale en verde.
- **Anotar la duración del tramo de Monte Carlo** (referencia para B.4). En el log de GitHub Actions, activa "Show timestamps" (menú ⚙ del log) y resta la hora de la **primera** línea `Monte Carlo (` de la de la **última**.

Verificación SQL (tú):

```sql
select max(date) from public.asset_historical_prices;               -- 2026-10-05
select horizon, count(*), min(computed_at), max(computed_at), min(seed)
from public.asset_montecarlo_simulation group by horizon;           -- 30 por horizonte
```

**B. Corrida de la rama** (Actions → "Actualizacion Diaria de Activos" → Run workflow → rama `lanzamiento-f2-montecarlo` → marcar `only_montecarlo`). Cómo confirmar en el log que **solo corrió Monte Carlo**:

1. En el encabezado expandido del paso "Ejecutar script de actualización", la sección `env:` muestra `ONLY_MONTECARLO: 1`.
2. **No** aparece ninguna de estas líneas, que solo imprime el camino completo:
   - `Descarga de precios con ventana`
   - `filas nuevas`
   - `Precio omitido`
   - `Consistencia`
   - `Backfill histórico de señales`
   - `Señales binarias`
   - `Win Rate`
   - `Web Push:`
   - `Push aceptado`
   - `Suscripción expirada`
   - `PAGES_BASE_URL no configurado`

   El script sale con `sys.exit(0)` en `actualizar_automatico.py:37-40`, **antes** de definir o llamar cualquiera de esas funciones.
3. **Solo** aparecen líneas `Monte Carlo (…)`: **120** (30 × 4 horizontes) y ninguna `Error en Monte Carlo`. También pueden aparecer `Monte Carlo: historial insuficiente…` si algún activo tiene ≤ 90 cierres.
4. **Duración:**
   - El paso completo dura claramente menos que la corrida completa de `main`, porque no hay descarga de precios, señales, Win Rate ni push.
   - **El tramo de Monte Carlo** (primera a última línea `Monte Carlo (`, con "Show timestamps") se compara con el tramo anotado en A. Esperado: **≈ 1.2× a 1.4×** el de `main`. Cada horizonte vuelve a calibrar GARCH y a calcular las distancias de Mahalanobis, así que agregar `two_day` suma cerca de un tercio del trabajo fijo por activo, más 2 pasos de simulación.
   - Si supera **2×**, o si resulta **menor** que el de `main` (señal de activos omitidos), se detiene y se revisa antes de seguir.
5. Verificación SQL posterior (tú):

```sql
-- No debe cambiar respecto de la consulta del lunes:
select max(date), max(created_at) from public.asset_historical_prices;
select max(updated_at) from public.push_subscriptions;
-- Debe reflejar la corrida de la rama:
select horizon, count(*), max(computed_at), min(base_close_date), max(base_close_date)
from public.asset_montecarlo_simulation group by horizon order by horizon;   -- 4 horizontes x 30

-- base_close_date = último cierre REAL de cada activo, en los 4 horizontes.
-- Esperado: 0 filas. Cualquier fila es un activo u horizonte simulado sobre otro cierre.
-- CUÁNDO: el MISMO DÍA, justo después de la corrida de la rama. A partir de la siguiente
-- corrida nocturna de main (motor viejo, antes del merge) esta consulta MOSTRARÁ
-- diferencias POR DISEÑO: main agrega un cierre nuevo y actualiza daily/weekly/monthly sin
-- enviar base_close_date, y no toca two_day. Eso activa "No disponible" en la página
-- (sección 2.3) y NO es una falla.
with ultimo as (
  select symbol, max(date) as ultimo_cierre
  from public.asset_historical_prices
  group by symbol
)
select m.symbol, m.horizon, m.base_close_date, u.ultimo_cierre
from public.asset_montecarlo_simulation m
left join ultimo u using (symbol)
where m.base_close_date is distinct from u.ultimo_cierre
order by m.symbol, m.horizon;
```

6. **"No disponible" pasajero tras cada corrida nocturna (esperado, ronda 5).** Después de cada corrida, la serie de precios de la gráfica ya trae el cierre nuevo, pero el navegador puede seguir usando una respuesta de `/api/escenarios` con el `baseCloseDate` anterior:
   - `max-age` de 15 min + `stale-while-revalidate` de 1 h en el endpoint;
   - más la caché local de 15 min de la página.

   Mientras tanto, la comparación de 2.3 no coincide y se muestra "No disponible" **hasta ~1 h**. Es el comportamiento seguro, no una falla. Para comprobar las cifras nuevas antes, se recarga sin caché o se espera.

### 6.3 Preview del sitio

- **Endpoint:**
  - `/api/escenarios?symbol=AAPL` → 200, 4 horizontes, solo los campos públicos, `Cache-Control` correcto;
  - `?symbol=BTC-USD` → 404 genérico;
  - `?symbol=<script>` → 400;
  - ningún error menciona tablas ni variables;
  - `/api/montecarlo` sin secreto → sigue respondiendo 401.
- **Terminal:**
  - AAPL, KO, PG, TSLA, NG=F y GC=F: tarjetas, abanico Día/Semana/Mes y tabla #47;
  - BTC, S&P 500, Bovespa y Nikkei: "No disponible";
  - cambio rápido de activo, sin datos cruzados;
  - escritorio y celular;
  - consola sin errores.
- **En el Preview no:** registrarse con correos reales, enviar sugerencias, activar push ni fijar metas (escriben en `privacy_consents`, `user_suggestions`, `push_subscriptions` y `page_views` de producción). Basta con entrar como invitado.

---

## 7. Criterio de salida

1. **El abanico puede bajar.** Al menos un activo de producción tiene `p50 < 0` en `daily` o `two_day`, y la gráfica dibuja su centro por debajo de "Hoy". La prueba sintética con deriva negativa lo confirma de forma determinista.
2. **Se ensancha en activos volátiles.** El ancho `p90 − p10` de `daily` de TSLA y NG=F es claramente mayor que el de KO y PG, en una proporción parecida a la de sus volatilidades, y crece de 1 a 2, 5 y 21 sesiones:

```sql
select symbol, horizon,
       (quantiles->>'p90')::numeric - (quantiles->>'p10')::numeric as ancho_80,
       (quantiles->>'p50')::numeric as p50, probability_up, base_close_date
from public.asset_montecarlo_simulation
where symbol in ('TSLA', 'NG=F', 'KO', 'PG')
order by symbol, horizon;
```

3. **Tarjetas #8/#9 y tabla #47:** solo muestran cifras de Monte Carlo con los textos de D5. No queda en pantalla nada de `PREDICTION_HORIZON.prob1/prob2` ni `σ × step`.
4. **"No disponible":** funciona para los activos sin simulación y cuando `base_close_date` ≠ el último cierre mostrado.
5. **#127:** `computed_at` refleja la última corrida.
6. **`/api/escenarios`:** público, de solo lectura, con `Cache-Control`, sin `select=*` y sin nombres internos en los errores.
7. Consola limpia en escritorio y celular.

---

## 8. Decisiones pendientes

Todas resueltas en la ronda 3 (sección 0). Solo quedan **acciones del usuario** el lunes 5-oct:

- verificar la corrida de `main` (6.2.A);
- ejecutar [fase-2-migracion.sql](fase-2-migracion.sql) con sus verificaciones;
- avisar para la corrida de la rama (6.2.B).

---

## 9. Pendientes para fases posteriores

- **Fase 4 — dibujar el historial primero y agregar el abanico al llegar** (ronda 7): hoy `renderPortfolioChart` espera a `/api/escenarios` antes de dibujar, hasta el límite de 8 s (`ESCENARIOS_TIMEOUT_MS`), para hacerlo una sola vez. Con la caché de sesión casi siempre es instantáneo, pero sin caché y con red lenta la gráfica tarda en aparecer. Cambiarlo a: historial inmediato y abanico agregado cuando llega la respuesta (`chart.update()` sin reanimar).
- **Fase 4 — consumo del pulso en móvil** (ronda 8): `portfolioPulsePlugin` llama a `requestAnimationFrame` → `chart.draw()` en **cada cuadro**, mientras la gráfica exista, para animar el anillo del último cierre. Eso redibuja toda la gráfica unas 60 veces por segundo (bandas, historial y ejes), aunque solo cambie el anillo. Revisar el consumo de batería y CPU en móvil. Opciones: dibujar el anillo en una capa aparte o con CSS, pausar con `document.hidden` o `IntersectionObserver`, o respetar `prefers-reduced-motion`.
- **Fase 8 — formato de moneda por idioma** (ronda 7): hoy todo se formatea con `es-MX` y `USD`, lo que se ve como "USD 99.80". Es correcto en México, donde "$" es el peso, y se mantiene. Cuando la terminal tenga en/zh, el formato debe seguir el idioma elegido (p. ej. `en-US` → "$99.80").
- **Fase 5 — caché en el borde o límite de frecuencia para `/api/escenarios`** (ronda 5): hoy, cada solicitud que no esté en la caché del navegador consulta Supabase con `service_role`. El `Cache-Control: public` permite que el CDN guarde la respuesta, pero en Pages Functions no está garantizado sin la Cache API. Opciones:
  - Cache API de Cloudflare (`caches.default`), con clave por símbolo y TTL hasta la próxima corrida;
  - o un límite de frecuencia por IP.
- **Fase 5 — `asset_prediction_audit` crece sin límite** (ronda 11, junto con el pendiente de `/api/escenarios`): `logPredictionAudit` (`functions/api/patterns.js`) inserta **una fila nueva por cada consulta de patrones**, es decir, cada vez que cualquier visitante cambia de activo o pulsa "Agregar" (`selectAsset` → `loadPatterns`). No hay deduplicación, límite ni retención. Evaluar:
  - límite de frecuencia;
  - deduplicación (p. ej. una fila por símbolo, horizonte y día);
  - una política de retención.
  Las filas no identifican al visitante; solo se filtran por `created_at`.
- **Fase 5 — tabla de feriados NYSE:** `NYSE_HOLIDAYS` en `index.html` cubre 2026-2027 y **caduca el 31-dic-2027**. Renovarla o moverla a un dato del servidor.
- **Fase 3 — `functions/api/patterns.js:19`:** lee `asset_signals` en orden `asc` y **sin `limit`**. Si un símbolo supera el `max_rows` de Supabase (1 000), recibiría solo las señales más antiguas (mismo tipo de error que #131). Corregir con `order=date.desc` + `limit` e invertir el orden.
- **Fase 3 — ELIMINAR el botón "Recalcular"** (0.4; decisión de la ronda 3): no se corrige. Tiene valores fijos (`+0.65`, "Fuertemente alcista", "Proyección recalculada") y el aviso "Abanico Markov recalculado.".
- **Columnas #3/#4:** se quedan ocultas como están (D4, ronda 3). Si algún día vuelven, sería con un endpoint por lotes de Monte Carlo.
- **Fase 3 — cripto, junto con #120 (ronda 6):** los activos cripto (BTC-USD, ETH-USD) cotizan **7 días a la semana**.
  - Cuando tengan historial, un paso de Monte Carlo será un día natural (1.b).
  - `nextSessions` (`index.html`) necesitará un **calendario por tipo de activo**. Hoy salta fines de semana y feriados NYSE para todos, así que para cripto mostraría fechas de sesión equivocadas: "Próxima sesión (lun …)" un sábado, cuando en realidad la próxima es el domingo.
- **Fase 3 — `functions/api/market/[symbol].js` (ronda 6):** `readDailyRows` lee `asset_historical_prices` con `order=date.asc&limit=1826`. Si el `max_rows` de Supabase (1 000 por defecto) recorta la respuesta, la gráfica recibiría los cierres **más antiguos**: mismo tipo de error que #131 y que `patterns.js`. Hoy no ocurre (~504-760 filas). Si ocurriera, el último cierre mostrado no coincidiría con `baseCloseDate` y las tarjetas y el abanico mostrarían "No disponible", que es el comportamiento seguro, pero la gráfica de historial quedaría vieja. Corregir con `order=date.desc` + `limit` e invertir el orden.

---

## 10. Resultados de la implementación (2026-10-04)

Rama `lanzamiento-f2-montecarlo`, sin push. Cada commit de producción se mostró al usuario y se aprobó antes de agregarlo al índice. No se ejecutó SQL ni se corrió el workflow.

### 10.1 Commits de producción

| # | Commit | Contenido |
|---|---|---|
| 1 | `31bdd49` | #127: `computed_at` explícito en el upsert de `persist_result`. |
| 2 | `19eb14c` | Horizonte `two_day` (2 sesiones, semilla propia), `base_close_date`, lectura `desc` del historial, `schema.sql` (CHECK + columna, definición y bloque idempotente), `two_day` en la lista de `/api/montecarlo` (admin), sección 5 de las pruebas sintéticas. |
| 3 | `7cc1845` | `/api/escenarios`: público, solo lectura, `select` explícito, p5…p95, `baseCloseDate` por horizonte, errores genéricos, `Cache-Control`. |
| 4 | `62e2c64` | Tarjetas #8/#9: "Precio central de los escenarios", rango p25–p75, "Escenarios que cierran arriba del último cierre", fechas de sesión desde `baseCloseDate` (NYSE 2026-2027, en UTC), tasa histórica con la N real, "Datos al cierre del …". Sin pulso. |
| 5 | `bf945d2` | Abanico: eje lineal proporcional en sesiones (1, 2, 5, 21), bandas p5–p95 y p25–p75 y la mediana en tramos rectos (sin p10/p90). Punto "Último cierre" con `role='last-close'`; el pulso solo ahí. Tooltip de la mediana con p25–p75 y p5–p95. Tiempo límite de 8 s. |
| 6 | `8e70636` | Tabla #47: p50/p10/p90 de la fila `daily`, columna "Qué representa", título "Rango estimado para la próxima sesión", sin `innerHTML`. Se retira la fila "mediana" duplicada y su regla CSS #98. |

Los commits de documentación (plan, migración y pendientes) van aparte: `db1ebb4`, `3294482`, `d3c3861`, `2661f71`, `170bdd7`, `cb13b54`, `7899e65`, `a4a96d4` y este.

### 10.2 Pruebas locales (sin red ni base)

| Prueba | Resultado |
|---|---|
| `py test_montecarlo_synthetic.py` | **22/22**. Las filas `daily`/`weekly`/`monthly` del sintético no cambian byte a byte respecto de antes del commit 2. `two_day`: determinista, ancho ≈ √2 × `daily` (1.432); p95−p5 crece en el orden `daily` < `two_day` < `weekly`. Con deriva negativa, p50 < 0 (criterio 1); con σ×3, ancho ×3.08 (criterio 2). |
| Arnés de `/api/escenarios` (`fetch` simulado, Node de VS Code) | **30/30**: campos públicos exactos, p5…p95, filas incompletas omitidas, 404, 7 entradas inválidas → 400, 502/503 genéricos sin nombres internos, `Cache-Control`. |
| Arnés de tarjetas y tabla (DOM falso, America/Mexico_City y Asia/Shanghai) | **49/49 en ambas zonas, sin diferencias**: fechas y feriados, reloj fijo en "lunes 10:00" sin efecto, textos aprobados, "No disponible" por horizonte, 404, red caída, `fetch` colgado (se aborta), respuestas tardías, caché, tabla #47 y sintaxis del `<script>` completo (incluida la línea completa de `PREDICTION_HORIZON`). |
| Edge headless, con Chart.js 4.4.4 real y el código extraído del `index.html` (4 escenarios) | Eje proporcional exacto (21.000, 5.000 y 2.000). El abanico **baja** (mediana final 96.5 < 100) y **se ensancha** (p5–p95: 0 → 12.4 → 17.6 → 27.8 → 56.9). Sin abanico con 404. Con el lienzo estable, **ningún dataset se mueve entre cuadros** (dos corridas). El anillo cae sobre el último cierre aun renombrando la etiqueta visible. |

**Errores encontrados y corregidos durante la revisión:**
- un comentario `//` a mitad de línea que anulaba `CHART_RANGE_POINTS`, lo que habría roto la gráfica (commit 5, corregido antes del commit);
- una afirmación incorrecta sobre "$" contra "USD": `es-MX` muestra "USD 99.80" en cualquier navegador.

### 10.3 Pendiente para cerrar la Fase 2

1. **Lunes 5-oct (usuario):**
   - verificar la corrida de `main` (6.2.A);
   - ejecutar [fase-2-migracion.sql](fase-2-migracion.sql) con sus verificaciones (pasos 0 a 2);
   - autorizar la corrida de la rama (6.2.B) y verificarla con las consultas de 6.2.B.5.
2. **Preview** (6.3), el mismo día de la corrida de la rama:
   - endpoint;
   - tarjetas, abanico y tabla con datos reales;
   - hover de tooltips;
   - celular.
3. **Criterio de salida (sección 7) con datos reales:** `p50 < 0` en algún activo, y ancho TSLA/NG=F > KO/PG.
4. **Merge** solo después de la migración (regla de la sección 3).

### 10.4 Menciones de "para mañana" fuera del alcance (sin cambiar; decisión pendiente)

| Archivo:línea | Texto |
|---|---|
| `index.html:676` (tour, paso `#top-picks`) | "Aquí verás los 3 activos con mayor rango de movimiento estimado para mañana. Es información, no una recomendación." |
| `homepage/index.html:258` | "Los 3 activos con mayor rango de movimiento estimado para mañana." (`data-i18n="attributes.5.desc"`) |
| `homepage/index.html:292` | `alt="Escenario de referencia para mañana"` (imagen `assets/prob tomorrow.png`) |
| `homepage/locales/es.json:43` | "Los 3 activos con mayor rango de movimiento estimado para mañana." |
| `homepage/locales/en.json:43` (equivalente en inglés) | "The 3 assets with the widest estimated move for tomorrow." |
| `homepage/locales/zh.json:43` (equivalente en chino, verificado) | "明日预计波动幅度最大的三项资产。" ("明日" = "mañana") |

**Decisión (ronda 9): no se cambian en la Fase 2.**

- **Fase 3, junto con la decisión de Top Picks:** cambiar "para mañana" por "para la próxima sesión" en `index.html:676` (tour), `homepage/index.html:258`, `homepage/locales/es.json:43`, `homepage/locales/en.json:43` (p. ej. "for the next session") y `homepage/locales/zh.json:43` (p. ej. "下一交易日").
- **Fase 3, también con la decisión de Top Picks (ronda 10):**

  | Archivo:línea | Texto actual | Nota |
  |---|---|---|
  | `index.html:96` (subtítulo del radar) | "Ordenados por cuánto podrían moverse mañana (volatilidad estimada). No es una recomendación de compra ni de venta." | "mañana" → "en la próxima sesión", con el mismo criterio que las líneas de arriba. |
  | `index.html:94` (aviso de "Rango de escenarios") | "Rango de escenarios: 'Amplio' muestra movimientos 35 % mayores que 'Estándar'." | Sale de `RISK_MULTIPLIER = { conservative: 1, open: 1.35 }` (`index.html:517`, usado en `effectiveSigma`, l. 519). **Desde la Fase 2, ese multiplicador ya no cambia las tarjetas, el abanico ni la tabla #47** (salen de Monte Carlo). Solo afecta la etiqueta SIGMA, el radar (Top Picks) y el camino de correlación apagado, así que el aviso hoy es inexacto para las proyecciones. Decidir en la Fase 3 si se retira el control "Amplio/Estándar" o se redefine. **Debe quedar resuelto antes de la beta (Fase 9).** |
- **Fase 8, con las capturas #92/#93 de la Fase 1 (sección J):** regenerar `homepage/assets/prob tomorrow.png` y su `alt` (`homepage/index.html:292`, hoy "Escenario de referencia para mañana") a partir de la terminal ya con Monte Carlo v2. La captura actual muestra la tarjeta vieja con "Probabilidad 23.3%" (#93).

### 10.5 CI y despliegue al hacer push

- **GitHub Actions:** el único workflow es `.github/workflows/daily_update.yml`. Se dispara con `schedule` (`0 22 * * 1-5`) y `workflow_dispatch`, y **no** con `push` ni `pull_request`. El `schedule` solo corre en la rama por defecto (`main`), así que un push de esta rama no ejecuta ningún workflow.
- **Cloudflare Pages:** con la integración de Git, un push de la rama genera un **despliegue Preview**, que usa la base de **producción**. El endpoint nuevo solo lee, pero las acciones de 6.3 marcadas como "en el Preview no" siguen aplicando. Antes de la migración, `/api/escenarios` responde 502 en el Preview (columna `base_close_date` inexistente) y la página muestra "No disponible": es el comportamiento esperado.
