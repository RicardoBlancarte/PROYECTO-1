# Fase 3 — Cálculos visibles: hallazgos y plan

- **Fecha:** 2026-10-12 (revisión 2, con las respuestas del usuario a J1-J3, H, N1 y N2)
- **Rama:** `lanzamiento-f3-calculos` (desde `main` en `de48a4e`, merge del PR #6)
- **Alcance de hoy:** solo investigación y plan. No se editó código de producción, no se ejecutó SQL y no se tocaron esquemas ni tablas.
- **Referencias:** [fase-1-auditoria.md](fase-1-auditoria.md) (#95, #113, #117, #120), [fase-2-plan.md](fase-2-plan.md) (sección 9 y 10.4), [winrate-plan.md](winrate-plan.md) (1.a y D5) y [1-5c-plan.md](1-5c-plan.md).
- **Pendiente previo:** verificar esta noche el push real al celular (1.5c, D.4.2).

> Los números de línea corresponden a `de48a4e`. En `index.html` muchas líneas son muy largas; cuando ayuda, se cita la función.

---

## 0. Decisiones del usuario (2026-10-12)

| # | Decisión |
|---|---|
| J1 | **b.** Estándar = banda p25-p75; Amplio = además p5-p95. Se quita el multiplicador 1.35× (`RISK_MULTIPLIER`). |
| J2 | **b.** Mínima varianza para N activos, sin μ. Los activos sin historial se excluyen con aviso. El μ histórico queda para cuando el laboratorio L lo valide. |
| J3 | **b.** Orden por el ancho p5-p95 diario de Monte Carlo. Arriba/abajo (`probUp`) se muestra como **reparto de escenarios**, nunca como criterio de orden. Nombres propuestos en la sección 4. |
| H | Se quita **solo** `#recalculate` y su manejador. `#winrate-refresh` se queda. |
| I | **`max_rows` = 1 000** (valor por defecto; no se cambia). Confirmado por el usuario. |
| N1 | Free = 5 activos y Top 3; Premium = 12 activos y Top 10. Elite: **"por definir"** en la configuración, pero **nunca ilimitado en la interfaz**: todo nivel tiene un tope visual (1.2). Los límites de Elite se proponen después, según el diseño. |
| N2 | El "motor más sensible" de Premium será el **factor b1** de `sensitivity-factor.js`. En la Fase 3 solo queda como parámetro configurable por nivel, **apagado**. La comparativa b1 contra `NEWS_SENSITIVITY_FACTOR` se hace en el laboratorio L. Ningún parámetro "más sensible" se activa en Premium hasta que L muestre que mejora el acierto fuera de muestra. |

**Siguen pendientes:**

| # | Pregunta | Dónde |
|---|---|---|
| L | CSV exportado de `asset_historical_prices` (y, si se puede, de `asset_news_scores`) para correr el laboratorio. | Sección 5 |
| B2 | Aprobación para escribir en `asset_historical_prices` (backfill de los 4 activos). | Punto B |
| C2 | Aprobación para reescribir cierres de futuros dentro de la ventana. | Punto C |
| E1 | Límites de Elite según el diseño (propuesta del agente, más adelante). | Sección 1.2 |

---

## 1. Diseño por niveles (aplica a todos los bloques)

**Objetivo de producto:**
- **Free:** 5 activos en el portafolio y Top 3 del radar.
- **Premium:** 10–12 activos, Top 10 y un motor más sensible (factor de sensibilidad).
- **Elite:** algoritmos y gráficas adicionales.

Nada de lo que se construya en la Fase 3 debe cerrar ese camino. Cuatro reglas:

1. **Límites en un solo objeto por nivel** (`TIER_LIMITS`), nunca números fijos en el código.
2. **El servidor calcula para todos los activos** (ranking completo del radar, Markowitz para N activos). El nivel solo decide cuántos se **muestran**.
3. **Parámetros del motor como configuración** (`ENGINE_PARAMS`), con valor por defecto y posibilidad de valor por nivel.
4. **Los endpoints devuelven datos completos** (todos los cuantiles, todo el ranking), no lo que dibuja una pantalla.

### 1.1 Dónde están hoy los límites (todos fijos y dispersos)

| Límite | Archivo:línea | Valor |
|---|---|---|
| Activos en el portafolio (Free) | `index.html:434` (`FREE_TIER_ASSET_LIMIT`); usado en l. 354 (`renderPortfolio`, "x/5 activos (Free)") y l. 435 (`addPortfolioAsset`) | `5`, solo para `normal`; Premium y Elite **sin límite** |
| Tamaño del radar | `index.html:326` (`renderTopPicks`, `.slice(0,3)`) | `3` para todos los niveles |
| Horizontes de patrones | `index.html:310` (`allowedPatternHorizons`) **y** `functions/api/patterns.js:51` (duplicado) | normal: día; premium: día y semana; elite: los 3 |
| Estrategias de cobertura | `index.html:611` y `:612` (dos manejadores con el mismo `3`) | Premium: 3; Elite: sin límite |
| Vista de historial | `index.html:568` y `:616` (`premium` o `elite`) | — |
| Resultados del explorador | `index.html:919` (`assetAccessLimit() { return Infinity; }`) | sin límite |
| Rango de nivel | `index.html:563` (`TIER_RANK`) | — |
| Textos con la cifra fija | `index.html:98` ("Hasta 5 activos…"), `index.html:788` (tour, "los 3 activos"), `homepage/index.html:258, 365, 366` y `homepage/locales/*.json:43, 52` ("los 3 activos") | — |

### 1.2 Propuesta: `TIER_LIMITS`

Una sola fuente de verdad en `functions/_shared/tier-config.js` (módulo ES, como `asset-catalog.js`):

```js
// Tope visual: ningún nivel muestra más filas que esto, aunque su límite esté "por definir".
export const UI_CAPS = { portfolioAssets: 12, radarSize: 10, hedgeStrategies: 3 };
// 'por-definir' = marcador; la interfaz lo resuelve al tope visual (nunca ilimitado).
export const TIER_LIMITS = {
  normal:  { portfolioAssets: 5,             radarSize: 3,             patternHorizons: ['daily'],                       hedgeStrategies: 0,             historyView: false },
  premium: { portfolioAssets: 12,            radarSize: 10,            patternHorizons: ['daily', 'weekly'],             hedgeStrategies: 3,             historyView: true  },
  elite:   { portfolioAssets: 'por-definir', radarSize: 'por-definir', patternHorizons: ['daily', 'weekly', 'monthly'], hedgeStrategies: 'por-definir', historyView: true  }
};
export function tierLimits(tier) {
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.normal;
  return Object.fromEntries(Object.entries(limits).map(([name, value]) =>
    [name, name in UI_CAPS ? Math.min(Number.isFinite(value) ? value : UI_CAPS[name], UI_CAPS[name]) : value]));
}
```

- **N1 (decidido):** Free 5 / Top 3; Premium 12 / Top 10. Elite queda `'por-definir'` y la interfaz lo resuelve al tope visual `UI_CAPS`. **Hoy Premium y Elite no tienen tope de activos** (`index.html:354, 435`); con esto lo tendrán.
- **Pendiente (E1):** proponer los límites de Elite según el diseño de las pantallas.
- **Servidor:** `patterns.js:51` importa `tierLimits(tier).patternHorizons` en lugar de su lista propia.
- **Navegador:** `index.html` no tiene paso de compilación ni módulos. Se entrega el objeto por `/api/public-config` (ya se pide al arrancar) como `tierLimits`. Mientras no llega, o si falla, el navegador usa **los límites de Free** (falla del lado seguro). Una función `tierLimits()` en `index.html` sustituye cada número de la tabla 1.1.
- **Textos:** las cifras se interpolan desde la configuración ("Hasta ${portfolioAssets} activos…"). En la homepage, que es estática y describe el plan Free, se dice explícitamente "En el plan Free, los 3 activos…".

### 1.3 Propuesta: `ENGINE_PARAMS`

Mismo archivo, con valores por defecto y sobrescritura opcional por nivel:

```js
export const ENGINE_PARAMS = {
  default: {
    newsSensitivity: 0.35,        // hoy: index.html:673 (NEWS_SENSITIVITY_FACTOR) y el .35 fijo de index.html:368
    patternWindows: [3, 5],       // hoy: functions/api/patterns.js:46
    markovOrder: 1,               // hoy implícito en markov-matrix.js (transiciones de 1 paso)
    markovStates: 3,              // hoy: markov-matrix.js:28 (STATES)
    historicalUpWindow: 252,      // hoy: index.html:335 (HISTORICAL_UP_WINDOW)
    chartHistorySessions: 504,    // hoy: index.html:355 (slice(-504)) y market/[symbol].js:7 (RETENTION.daily)
    sensitivityB1: false          // N2: factor b1 de sensitivity-factor.js; apagado hasta que L lo valide
  },
  byTier: { premium: {}, elite: {} } // vacíos: nada "más sensible" se activa sin validación de L
};
export function engineParams(tier) { return { ...ENGINE_PARAMS.default, ...(ENGINE_PARAMS.byTier[tier] || {}) }; }
```

- **N2 (decidido):** el "motor más sensible" de Premium será el factor b1 de `functions/api/sensitivity-factor.js` (regresión Student-t, solo admin; Monte Carlo lo usa como verificación cruzada). En la Fase 3 solo existe el parámetro `sensitivityB1`, apagado en todos los niveles. **Regla:** ningún parámetro "más sensible" se activa en Premium hasta que el laboratorio L muestre que mejora el acierto fuera de muestra.
- **Pendiente (L):** comparativa entre b1 y `NEWS_SENSITIVITY_FACTOR` (`index.html:673-674`): qué mide cada uno y su efecto en el acierto.
- **Límite de este diseño:** Monte Carlo corre en la cascada y guarda **una fila por activo y horizonte** (PK `(symbol, horizon)`, `schema.sql:468-501`). Un Monte Carlo con parámetros distintos por nivel necesitaría una columna `tier` o una tabla nueva, es decir, **cambio de esquema**. No entra en la Fase 3; se anota para cuando se diseñe Premium.
- Los parámetros de Monte Carlo (`montecarlo_engine.py:40-60`: `WINDOW`, `MIN_RETURNS`, `STEPS_BY_HORIZON`…) viven en Python. No se mueven en esta fase; solo se documentan como "por defecto".

### 1.4 Endpoints con datos completos (regla 4)

| Endpoint | Hoy | Propuesta |
|---|---|---|
| `/api/escenarios` | Ya devuelve los 4 horizontes y los 7 cuantiles | Sin cambio |
| Radar (nuevo, según J3) | El ranking se arma en el navegador con 35 llamadas a `/api/market` y se corta a 3 | `/api/radar`: ranking **completo** de todos los activos con datos; el navegador corta con `radarSize` |
| Markowitz (según J2) | Se calcula en el navegador con N descargas de historial | `POST /api/markowitz` con la lista de símbolos: pesos para **N** activos, sin límite de nivel dentro del cálculo |
| `/api/patterns` | Calcula ventanas fijas `[3, 5]` y solo el horizonte pedido | Ventanas desde `engineParams`; devuelve todas las ventanas configuradas |
| `/api/correlation` | `suggestions.slice(0, 5)` (l. 44) | Devolver todas las correlaciones que pasan el umbral; el cliente decide cuántas mostrar |
| `/api/market/{símbolo}` | Corta a `RETENTION.daily = 504` (l. 7 y 20) | `RETENTION` como configuración; Elite (gráficas adicionales) podrá pedir más historial |

### 1.5 Pendiente para la Fase 5: el nivel solo se controla en el navegador

Hoy **ningún límite por nivel se valida en el servidor**:
- `effectiveTier()` (`index.html:571`) lee el texto de `#my-level` y la prueba gratuita guardada en `localStorage` (`algo_trial_v1`, `index.html:569`), que el usuario puede editar.
- `functions/api/patterns.js:6` **confía en `?tier=`** de la URL.
- `functions/api/push/subscribe.js` no limita cuántos activos con alerta tiene un usuario.
- El límite de 5 activos solo se revisa en `addPortfolioAsset` (`index.html:435`).

Mientras todo sea gratis no hay pérdida, pero **Premium requerirá validar el nivel en el servidor**: derivarlo de la sesión de Supabase (`profiles.user_level`) y no de un parámetro, mover las pruebas gratuitas al servidor, y aplicar `TIER_LIMITS` en `/api/patterns`, `/api/radar`, `/api/markowitz` y `/api/push/subscribe`.

---

## 2. Respuesta a K: ¿la corrida de hoy rellena el 9-oct?

**Sí, si Yahoo ya entrega el cierre de ese día.** No requiere ningún cambio.

- La ventana `5d` de esta noche cubre del 6 al 12-oct (si cuenta sesiones) o del 8 al 12-oct (si cuenta días naturales). En ambos casos entra el 9-oct.
- El 9-oct no está guardado para las 20 acciones, así que cae en `older_missing` (`actualizar_automatico.py:246-248`) y se **inserta**. El 12-oct entra como `latest` con upsert.
- Como cada acción recibe más de una fila, se vuelve a correr `backfill_asset_signals()` (l. 266-267) y las señales del 9-oct también quedan al día.
- **Funciona igual si la corrida se retrasa** después de medianoche UTC, y en la corrida de mañana. A partir del miércoles 14-oct ya no es seguro.
- **Riesgo (no verificable sin correrlo):** el control de consistencia compara el 8-oct guardado con el descargado, con tolerancia de 0.5 %. yfinance no tiene versión fija en el workflow; si ajusta por dividendos y alguna acción tuvo fecha ex-dividendo el 9 o el 12-oct mayor a 0.5 %, esa acción se omite completa (ni el 9 ni el 12).
- **Qué revisar en el log:** `AAPL: 2 filas nuevas (2026-10-09, 2026-10-12)…` en las 20 acciones, y ninguna línea `Inconsistencia:` ni `Precio omitido: … 2026-10-09`.
- **Si falla:** el input existente `backfill_1mo` lo recupera. Escribe en `asset_historical_prices`, así que solo con aprobación del usuario.

---

## 3. Hallazgos y propuesta por punto

### A. Sigma con dos unidades (#95, #113) — M

- **Dónde:** valor anual escrito a mano en `assetData` (`index.html:275`, p. ej. BTC 0.72); `syncAssetDataWithSupabase` (`index.html:656`) lo reemplaza por la desviación **diaria**. Lo leen:
  - la píldora SIGMA (`index.html:97`, se llena en l. 333);
  - el radar (l. 326);
  - Markowitz (l. 441);
  - derivados y coberturas (l. 588-611), bloqueados como "Próximamente" pero el código se ejecuta;
  - el camino de correlación (l. 386), oculto (#96).
- **Causa:** un mismo campo `sigma` guarda dos unidades. Además, la píldora muestra valores distintos según quién la llame: `renderPortfolioChart` (l. 368) le suma el factor de noticias (`× (1 + 0.35 × score)`) y `selectAsset` (l. 626) no.
- **Cambio:** sin renombrar el campo, dos funciones:
  - `dailySigma(asset)`: la sigma diaria solo si `sigmaSynced`; si no, `null`.
  - `annualSigma(asset)`: la diaria × √252 (√365 para cripto, ver B2), o la anual escrita a mano como respaldo.

  Black-Scholes y coberturas usan la anual. El radar deja de usar sigma (J3 = b: ancho p5-p95 de Monte Carlo). La píldora pasa a "Volatilidad diaria x.xx %", muestra "—" sin historial y no suma el factor de noticias (resuelve #113).
- **Riesgo:** bajo; los paneles de derivados siguen bloqueados.
- **Prueba:** recargar y ver que la píldora no cambia de escala; AAPL contra BTC (debe mostrar "—"); en consola, `annualSigma` de AAPL ≈ 0.25-0.35.
- **Niveles:** el `.35` fijo de l. 368 pasa a `engineParams().newsSensitivity` (1.3).

### B. BTC-USD, ^GSPC, EWZ y EWJ sin historial (#120)

**B1. Guardas inmediatas — S**
- `proposePortfolioGoal` (`index.html:431`): si no hay `lastClose`, aviso "Este activo aún no tiene historial; no se pueden fijar metas." `portfolioState` (l. 331) usa `lastClose`, no `price`.
- `push-enable-btn` (l. 536) y `subscribeAssetPush` (l. 505): no reintentar en activos sin historial.
- **Servidor:** `functions/api/push/subscribe.js` hoy acepta cualquier símbolo. Propuesta: un GET `limit=1` a `asset_historical_prices` y responder **422** si no hay filas. Cubre también metas viejas guardadas en `localStorage`.
- **Prueba:** en el Preview, BTC no deja fijar meta; una llamada simulada a `/api/push/subscribe` con `BTC-USD` → 422; AAPL igual que antes.

**B2. Poblar el historial — L (requiere aprobación: escribe en la tabla)**
1. Agregar los 4 símbolos a `assets` (`actualizar_automatico.py:30-39`). `asset_type` no tiene CHECK (`schema.sql:116-127`): sin cambio de esquema.
2. Backfill único: input nuevo `backfill_symbols` en el workflow con periodo largo, permitido **solo** para esos símbolos. Para un símbolo nuevo el control de consistencia no tiene referencia e inserta todo. Señales y Monte Carlo (> 90 cierres) se llenan solos esa noche.
3. **Dependencia:** 3 años de BTC son ~1 100 filas, por encima del `max_rows` de 1 000. **El bloque I debe fusionarse antes**, o limitar BTC a ~2 años.
4. **Calendario cripto (7 días):**
   - `nextSessions` y `NYSE_HOLIDAYS` (`index.html:337, 347`) necesitan calendario por tipo de activo (cripto: días naturales).
   - En Monte Carlo un paso es una fila, es decir, un día natural para BTC. "Semana" serían 5 días naturales: rotularlo o usar 7 pasos (decisión).
   - **Hallazgo:** la corrida guarda la vela de BTC del día cuando está en curso (22:00 UTC; la vela cierra a las 00:00) y nunca la corrige. Al día siguiente el control de 0.5 % detectaría la diferencia y **omitiría BTC con frecuencia**. Se resuelve con C2.
5. Win Rate (`CATALOG` en `winrate.js:6` y `winrate-shadow.js:5`): propuesta, dejarlo en 30 símbolos.
- **Riesgo:** medio; escribe en producción, sin tocar filas existentes.
- **Prueba:** corrida en la rama con `backfill_symbols`; SQL de conteo, `min`/`max` por símbolo y 4 horizontes de Monte Carlo por símbolo nuevo.
- **Niveles:** la lista de activos está repetida en 5 lugares (`actualizar_automatico.py:30`, `winrate.js:6`, `winrate-shadow.js:5`, `fmpSymbols` en `index.html:653`, `functions/_shared/asset-catalog.js`). Premium (10–12 activos) puede requerir más símbolos en la cascada; conviene que el universo de activos tenga una sola lista. Se anota; no se unifica en esta fase.

### C. Futuros: aviso de "cambio de contrato" — M (L si hay que ajustar por roll)

- **Dónde:** `actualizar_automatico.py:226-249`. Solo se reescribe el día más reciente; los días anteriores **nunca se corrigen**.
- **Causa probable, por verificar:** que GC, SI, CL, BZ, NG, HG y ZS avisen a la vez con 0.5-1.8 % **no encaja con un cambio de contrato** (vencen en meses distintos). Encaja con esto: a las 22:00 UTC (o más tarde, por el retraso de GitHub) CME ya abrió la sesión siguiente y Yahoo aún no publica la liquidación. La corrida guarda una vela provisional que nunca se corrige.
- **C1 (solo lectura):** script en el scratchpad que descarga 60 días de los 10 futuros con yfinance, más una consulta SQL del usuario para comparar con lo guardado. Diferencias en días sueltos → vela provisional; salto persistente → cambio de contrato.
- **C2 (si es la vela provisional; requiere aprobación):** para futuros y cripto, upsert de los días de la ventana que difieran dentro de la tolerancia. Sirve también para BTC (B2).
- **C3 (si hay saltos reales por roll):** excluir los retornos de esos días en Monte Carlo. La serie ajustada completa requiere precios por contrato (`GCZ26.CMX`…) y es frágil; después de la beta.
- **Riesgo:** C2 reescribe cierres guardados de futuros.
- **Niveles:** no aplica.

### D. Markowitz — S-M (depende de J2)

- **Dónde:** `index.html:441` (`optimizePortfolioMarkowitz`): `mu = effectiveSigma × 0.21` y `varianceFloor = (σ/√252)²`, que trata la sigma como anual.
- **Causa (hallazgo nuevo):** basta un activo sin historial para que `minLength = 0`; entonces la covarianza de **todos** queda en cero y los pesos salen solo de `μ/piso` ∝ 1/σ. BTC, con sigma anual, recibe ~1 % y se ignoran las correlaciones del resto. Con historial completo, μ ∝ σ es en realidad el portafolio de **máxima diversificación**, no un Markowitz de retornos.
- **Cambio (J2 = b):** **mínima varianza** para N activos: pesos ∝ Σ⁻¹·1 con la covarianza de retornos diarios sobre la ventana común, el mismo encogimiento de covarianzas y el mismo tope por activo. Sin μ, así que desaparece `effectiveSigma × 0.21`. Los activos sin historial se excluyen con aviso ("Bitcoin no entra en el cálculo: aún no tiene historial"); si quedan menos de 2, no se calcula. Título y textos: "Reparto de menor volatilidad histórica (Markowitz)". El μ histórico queda para cuando L lo valide.
- **Prueba:** portafolio AAPL, KO y BTC: BTC fuera con aviso; pesos de AAPL y KO iguales a un cálculo hecho a mano.
- **Niveles:** el cálculo no debe suponer ≤ 5 activos (hoy no lo supone: `maxWeight` depende de N). Propuesta: `POST /api/markowitz` en el servidor para **N** activos (1.4), con lecturas paginadas del bloque I. El nivel solo limita cuántos activos caben en el portafolio.

### E. "para mañana" → "para la próxima sesión" — S (depende de J3)

- Tour (`index.html:788`), subtítulo del radar (`index.html:96`, "podrían moverse mañana" → "en la próxima sesión"), `homepage/index.html:258` y `homepage/locales/{es,en,zh}.json:43` ("for the next session", "下一交易日").
- El `alt` de `homepage/index.html:292` se queda para la Fase 8, con la imagen.
- Si J3 quita el radar, solo cambian la homepage y el tour.
- **Prueba:** homepage en es/en/zh.
- **Niveles:** "los 3 activos" no se escribe fijo: en la terminal se interpola `radarSize`; en la homepage se dice "en el plan Free" (1.2).

### F. Aviso "Amplio / Estándar" — S-M (depende de J1; obligatorio antes de la beta)

- **Dónde:** aviso (`index.html:94`), `RISK_MULTIPLIER` y `setRiskPosture` (l. 574-581), paso 8 del tour (l. 790), homepage (`attributes[4]`, `block7`).
- **Causa:** desde la Fase 2 el 1.35× solo cambia la píldora SIGMA; el orden del radar no cambia porque escala a todos por igual.
- **Cambio (J1 = b):** se elimina `RISK_MULTIPLIER` y `effectiveSigma` deja de escalar. El control decide qué bandas dibuja el abanico: **Estándar** = p25-p75 (la mitad de los escenarios); **Amplio** = además p5-p95 (9 de cada 10). Se reescriben el aviso de l. 94, los toasts de `setRiskPosture`, el paso 8 del tour y la homepage (`attributes[4]`, `block7`). Se conservan los valores `conservative`/`open` en `user_state.risk_posture` (`schema.sql:236`), así que **no hay cambio de esquema**.
- **Niveles:** los cuantiles ya llegan completos (1.4); el nivel podría decidir qué bandas se ven sin cambiar el endpoint.

### G. P(alza) del panel "Patrones binarios" — S-M

- **Dónde:** `functions/api/patterns.js:58-80`, `index.html:320` y encabezado en l. 111.
- **Causa:**
  - Frecuencia condicional con pocas muestras (~20-25 coincidencias con ventana 5), mostrada con un decimal y sin el tamaño de muestra al lado.
  - La columna "Frecuencia" muestra en realidad **el número de coincidencias**.
  - El "ajuste de noticias" suma `promedio impact_score / 100` (hasta ±10 puntos) sin calibración.
  - El Win Rate de este mismo motor (shadow_v2) es **49.7 %**: como lanzar una moneda.
- **Propuesta:** rotularlo como historia ("Tras este patrón, subió en X de N ocasiones (Y %)", sin decimales); quitar "Ajuste noticia" y "P(alza) ajustada"; aviso si N < 30; actualizar el texto de #49. Alternativa: ocultar el panel.
- **Prueba:** Preview con AAPL y NG=F; comparar X/N contra `asset_signals`.
- **Niveles:** ventanas desde `engineParams().patternWindows` y horizontes desde `tierLimits().patternHorizons` (quita el duplicado de `patterns.js:51` e `index.html:310`).

### H. Eliminar "Recalcular" — S

- **Hay dos botones con ese nombre:**
  - `#recalculate` del Market brief: oculto, con valores fijos ("Fuertemente alcista"); HTML en `index.html:117`, manejador en l. 873. **Es el que se decidió eliminar (Fase 2, ronda 3).**
  - `#winrate-refresh`, junto a "MOTOR SOMBRA (v2)" en el panel de superadmin (l. 224 y 561). Este sí funciona.
- **Decisión (H):** se quita **solo** `#recalculate` y su manejador; `#winrate-refresh` se queda.
- **Cuidado:** `hedgeMetrics` (l. 603) lee `$('brief')`; se quitan solo el botón y su manejador, no la sección.
- **Niveles:** no aplica.

### I. Lecturas en orden `asc` — M

| Archivo:línea | Lectura | Riesgo hoy (~775 filas por símbolo) |
|---|---|---|
| `functions/api/patterns.js:19` y `:32` | `asc`, sin `limit` | Pasados 1 000, el "patrón actual" saldría de datos viejos |
| `functions/api/market/[symbol].js:35` | `asc`, `limit=1826` | Igual; con BTC (B2), inmediato |
| `markov-matrix.js:43`, `patterns-vectors.js:33`, `sensitivity-factor.js:43` | `asc`, `limit=5000` (solo admin) | El comentario de `patterns-vectors.js:19` es falso: `limit` no supera `max_rows` |
| `functions/api/correlation.js:21` | ~2 700 filas, sin `limit` | **Posible falla hoy:** con `max_rows` de 1 000 solo llegan AAPL … INTC |
| **Nuevo:** `actualizar_automatico.py:125-132` (`backfill_asset_signals`) | `asc`, sin `limit` | Pasados 1 000, recalcularía cada noche sin completar |

- **Cambio:**
  - Lecturas por símbolo: `order=date.desc` + `limit` e invertir. Si `max_rows` es menor que `limit`, PostgREST recorta, pero se quedan las filas **más recientes**.
  - `correlation.js`: paginar con `limit`/`offset` y avanzar por las filas recibidas **hasta una página vacía** (no "hasta una página incompleta": si `max_rows` fuera menor que el tamaño de página, esa regla cortaría antes de tiempo).
  - Python (`backfill_asset_signals`): necesita **todo** el historial, así que se pagina con `.range()` hasta una página vacía, en lugar de `desc` + `limit`.
- **Extra opcional (no incluido en el bloque 1):** `loadShadowCorrelation` (`index.html:322`) sigue llamando a `/api/correlation` y `/api/patterns` con el motor sombra oculto, y `patterns.js` escribe en `asset_prediction_audit` en cada llamada. Cortarlo con `SHOW_SHADOW_ENGINE`.
- **`max_rows`:** sin dato aún. El arreglo no depende de su valor; el usuario lo confirma antes del merge.
- **Prueba:** prueba local con `fetch` simulado de 1 200 filas (como T1 del Win Rate); en el Preview, la gráfica de AAPL termina en el último cierre.
- **Niveles:** `correlation.js` devuelve todas las correlaciones sobre el umbral (1.4). `RETENTION` de `market/[symbol].js` pasa a la configuración en el bloque 2, donde vive `tier-config.js`.

---

## 4. Decisiones de producto (J): opciones

**Decididas el 2026-10-12: J1 = b, J2 = b, J3 = b** (sección 0). Las tablas quedan como registro.

**Nombre de la sección del radar (J3, decidido):**

| Idioma | Título | Subtítulo |
|---|---|---|
| es | Radar | Activos con mayor rango de escenarios para la próxima sesión |
| en (propuesta) | Radar | Assets with the widest range of scenarios for the next session |
| zh (propuesta) | 雷达 | 下一交易日情景区间最宽的资产 |

Cada fila muestra el rango p5-p95 y el reparto "X % de los escenarios arriba / Y % abajo" como dato, no como orden. En la homepage, `attributes[5]` y `block8` cambian al mismo texto (en el plan Free, "los 3 activos…").

### J1. Postura de riesgo

| Opción | Pros | Contras |
|---|---|---|
| a) Quitar el control | Honesto e inmediato (S) | Se pierde un bloque de la homepage y la imagen "Perfil de riesgo" |
| b) Redefinir: Estándar = banda p25-p75; Amplio = además p5-p95 | Usa cuantiles reales que ya existen, sin matemática nueva | M: cambian gráfica, textos, tour y homepage |
| c) Conservar el 1.35× aplicado al abanico | Mínimo cambio visual | Agranda el abanico sin base en el modelo; contradice "escenarios simulados" |

### J2. Markowitz

| Opción | Pros | Contras |
|---|---|---|
| a) Clásico, μ = retorno histórico medio | El Markowitz "de libro" | μ muy ruidoso; pesos extremos; suena a recomendación |
| b) Mínima varianza (sin μ) | Robusto y fácil de explicar ("reparto de menor volatilidad histórica") | Se concentra en KO, PG y oro; ya no es la cartera tangente |
| c) Mantener la matemática y llamarla "máxima diversificación" | Cambio mínimo; es lo que ya calcula | Concepto menos conocido; dejaría de llamarse "Markowitz" |
| d) Quitarlo | Cero riesgo | Se pierden el botón, un paso del tour, un bloque de la homepage y 2 imágenes |

### J3. Top Picks (radar)

| Opción | Pros | Contras |
|---|---|---|
| a) Dejarlo con la sigma de 2 años | Ya funciona; solo textos (E) | Casi el mismo orden todos los días; no es "la próxima sesión" |
| b) Ordenar por el ancho p5-p95 diario de Monte Carlo | Coherente con las tarjetas; cambia con el GARCH | M: endpoint por lotes (`/api/radar`, 1.4) |
| c) Quitarlo | Cero riesgo | Se pierden el bloque 8 de la homepage y un paso del tour; cierra el "Top 10" de Premium |
| d) "Mayores movimientos de la última sesión" | Dato cierto, no estimación | Es otra función (M) |

Con el diseño por niveles, a), b) y d) admiten Top 3 / Top 10 sin cambios: el servidor devuelve el ranking completo y `radarSize` decide cuántos se ven.

---

## 5. Laboratorio L (alcance aprobado el 2026-10-12)

- **Qué es:** una evaluación **de solo lectura y fuera de muestra**. Nada de lo que mida cambia la interfaz ni la cascada.
- **Datos:** **sin credenciales.** El script solo lee un CSV exportado de `asset_historical_prices` (columnas `symbol, date, close` y, opcional, `volume`) que entrega el usuario. Para L2-noticias acepta además un CSV de `asset_news_scores` (`symbol, published_at, impact_score`).
- **Script:** `lab_l.py` (en el scratchpad del agente; no se agrega al repo salvo que el usuario lo pida). Escribe CSV y un `informe.md` en la carpeta de salida. **Todavía no se ha corrido con datos reales.**
- **Definición de "sube":** `close_t > close_{t-1}` (estricta), igual que `asset_signals`.
- **Criterio general:** un parámetro solo se activa en un nivel si mejora la métrica fuera de muestra de forma consistente entre activos, no en promedio por un par de activos.

### L0 (pregunta principal)

**L0a. Inventario (solo lectura del código, 2026-10-12, líneas en `842622b`)**

| Pieza | Qué calcula | Archivo:línea |
|---|---|---|
| `markov-matrix.js` | 3 estados (bajista / neutral / alcista) definidos por **terciles** del retorno log del propio activo. **Orden 1:** cuenta parejas de días seguidos `(estado_t, estado_t+1)`. Ventana: todo el historial que llega (pide 5 000; con `max_rows` = 1 000, las 1 000 sesiones más recientes desde el bloque 1). Semana y mes: `P^5` y `P^21`, sin reajustar. Guarda en `asset_markov_matrix`. Ninguna pantalla lo usa. | l. 28-31 (constantes), 54-57 (terciles), 123-127 (conteo de transiciones), 63-66 (potencia), 167-183 (guardado) |
| `patterns-vectors.js` | Un vector por día: retorno log y volumen, ambos normalizados por MAD. Patrón = 3 vectores seguidos. Distancia de Mahalanobis entre el patrón actual y cada patrón histórico; peso `e^-D`; `P(sube)` = proporción ponderada de días siguientes al alza. Etiqueta de confianza con N mínimo de Silverman. Ventana: todo el historial. Guarda en `asset_pattern_vectors` (últimos 260) y `asset_pattern_vectors_snapshots`. Ninguna pantalla lo usa. | l. 124-145 (vectores), 62-76 (kernel y `P(sube)`), 203-211 (distancia), 81-89 (Silverman) |
| `sensitivity-factor.js` (b1) | Factor de **magnitud**, no de dirección: ajusta `abs(r_t) = S · MAD(20 días previos)` con verosimilitud Student-t y previa en 0.21 (el `step` legacy). Guarda en `asset_sensitivity_factor`. | l. 20-23 (constantes), 55-88 (ajuste), 131-140 (pares) |
| **Hallazgo en b1** | La previa pesa unas **250 veces** más que los datos: `lambda0 = K_PRIOR / mean(x²)` no se escala por τ², así que b1 **nunca se aleja de 0.21**. En datos sintéticos GARCH: b1 = 0.2116 (idéntico en el JS real y en la réplica de Python), contra 1.22 por mínimos cuadrados sin previa. Hoy b1 es, en la práctica, la constante legacy. No se corrige en el laboratorio; se documenta para N2. | l. 58 |
| ¿Cómo combina shadow_v2? | **No hay una fórmula que combine** Markov, patrones, Monte Carlo y noticias. Son piezas independientes (filas siguientes). | — |
| · Panel "Patrones binarios" | Patrón binario de 3 y 5 días; frecuencia empírica más `promedio impact_score / 100` de las últimas 20 noticias, acotado a [5 %, 95 %]. | `patterns.js`: l. 44-49 (noticias), 61-83 (estimación) |
| · Win Rate shadow_v2 | Solo el patrón binario de 5 días, **sin noticias** ni otras piezas. | `winrate-shadow.js`: l. 6, 55-66 |
| · Monte Carlo v2 | GARCH(1,1) con Student-t y simulación histórica filtrada: el pool de shocks se pondera con `e^-Mahalanobis` de patrones de 3 días (la misma idea de `patterns-vectors.js`) y `lambda_pool` = 1 fijo. **Noticias: no** (`news_uncertainty_variance = 0`). **b1 y Markov: no**; solo se guardan como `b1_crosscheck` y `b2_crosscheck`. | `montecarlo_engine.py`: l. 541-544 (pool), 55 y 519-523 (`lambda_pool`), 572 y 621 (noticias = 0), 626-627 (crosscheck) |
| · `NEWS_SENSITIVITY_FACTOR` (0.35) | Solo lo usa `applyNewsWeighting`; su resultado (`adjusted`) se calcula y **no se usa**. Hoy no tiene efecto visible. El `.35` que escala la píldora SIGMA con `newsDebateScore` es otra constante escrita a mano. | `index.html`: l. 676-677, 679, 371 |
| ¿Guardamos historial de noticias? | **Sí, pero no sistemático.** `asset_news_scores` guarda cada titular puntuado (`published_at`, `impact_score` de −10 a 10, resúmenes; único por `content_hash`). Solo se escribe cuando alguien abre el Newsbox de un activo, y GDELT responde 429 con frecuencia (#118), así que muchos puntajes son heurísticos y la cobertura depende del tráfico. | `schema.sql:133-145, 222-223`; `news.js:26-57` |

**Hallazgos de L0a:**
1. **No existe una fórmula que combine las piezas.** Markov, patrones binarios, vectores, Monte Carlo y noticias se calculan por separado; Monte Carlo solo guarda b1 y Markov como verificación, sin usarlos.
2. **El Win Rate de 49.7 % solo mide el patrón binario de 5 días** (`winrate-shadow.js`), sin noticias, Markov, vectores ni Monte Carlo. No es una medida del "motor sombra" completo.
3. **b1 está atorado en 0.21 por la previa** (`sensitivity-factor.js:58`): la previa pesa ~250 veces más que los datos.
4. **`applyNewsWeighting` se calcula y no se usa** (`index.html:679`): hoy `NEWS_SENSITIVITY_FACTOR` no tiene efecto visible.

**L0b. Matrices de transición de orden 1, 2 y 3.** Por activo, `P(sube | últimos k días)` con el número de casos por fila. En orden 1, la separación `P(sube|subió) − P(sube|bajó)` con su margen de error al 95 %. En órdenes 2 y 3, cada fila contra la tasa base (margen al 95 %) y una prueba chi² de "todas las filas iguales". El informe indica cuántos positivos se esperan por azar (5 %), porque con 30 activos y muchas filas habrá falsos positivos.
- **Markov de 2 estados (sube/baja) contra Markov de 3 estados (terciles).** El de 2 estados es el diseño original del usuario: es el orden 1 binario de arriba, `P(sube | subió)` y `P(sube | bajó)`. El de 3 estados es el que calcula hoy `markov-matrix.js` (bajista / neutral / alcista por terciles del propio activo). Para compararlos con la misma medida, de cada uno se reporta `P(sube | estado del día anterior)` con casos por fila; para el de 3 estados, además, la matriz 3×3 completa, la separación `P(sube|alcista) − P(sube|bajista)` con su margen al 95 % y una chi² de "las 3 filas iguales". En L0b los terciles salen de todo el historial, como en el endpoint (descriptivo).

**L0c. Acierto fuera de muestra.** Ventana que avanza (se expande): desde la sesión 252, en cada día se predice con los conteos de los días anteriores y luego se agrega el dato observado. Órdenes 1, 2 y 3 (2 estados) y Markov de 3 estados contra "siempre sube" y contra la probabilidad simple de alza. En el de 3 estados, los terciles se recalculan cada 21 sesiones **solo con datos anteriores** (sin mirar el futuro). Métricas: acierto (umbral 0.5), Brier y una prueba *t* pareada del Brier contra la probabilidad simple. Tabla por activo y resumen.
- **Potencia:** con ~520 días de prueba por activo, un acierto solo se distingue del azar si supera 50 % ± ~4 puntos, y el *t* del Brier necesita efectos aún mayores. En datos sintéticos, un efecto real de ±14 puntos dio t ≈ 1.4.

### L1. μ histórico contra μ = 0 (J2)
- Por activo: R² fuera de muestra (μ de las 252 sesiones previas contra 0, para predecir el retorno medio de las 21 siguientes, sin traslape).
- Portafolio: mínima varianza, μ histórico y peso igual, con el mismo esquema que la interfaz (encogimiento de 0.35, recorte de negativos y tope por activo), rebalanceo cada 21 sesiones. Volatilidad, retorno y Sharpe realizados.

### L2. b1 contra `NEWS_SENSITIVITY_FACTOR` (N2)
- **No miden lo mismo:** b1 es un factor de magnitud; `NEWS_SENSITIVITY_FACTOR` desplaza una probabilidad de dirección. Se evalúan por separado.
- **b1:** pronóstico de `abs(r_{t+1})` con b1 (reajustado cada 21 sesiones con el mismo algoritmo del JS) contra la constante legacy 0.21 y la constante normal `√(2/π) × 1.4826 ≈ 1.183`. Métrica: error absoluto medio.
- **Noticias (solo con el CSV de noticias):** Brier de la dirección del día siguiente con `applyNewsWeighting` para sensibilidades 0, 0.1, 0.2, 0.35 y 0.5, y con el ajuste de `patterns.js`, solo en los días con noticias publicadas.

### L3. Cobertura de Monte Carlo v2 (J1, J3)
- Se ejecuta el motor real (`montecarlo_engine.run_montecarlo_for_symbol`, importado con `--repo`) en fechas pasadas, cada 10 sesiones dentro de las últimas 252, sin traslape, para `daily` y `weekly`.
- Se mide qué fracción de los cierres reales cae dentro de p25-p75 (esperado 0.50) y de p5-p95 (esperado 0.90), con su margen de error.

### Prueba con datos sintéticos (2026-10-12): 12 de 12 autocomprobaciones OK

Seis activos sintéticos con propiedades conocidas: sin memoria; memoria de orden 1; memoria solo de orden 2; tendencia del 60 %; volatilidad GARCH; y reversión tras días grandes (la dirección depende del tamaño del movimiento previo).
- L0b detecta la memoria de orden 1 (separación 0.169, margen 0.065) y no la marca en el activo sin memoria (−0.003). La memoria de orden 2 aparece en la chi² de orden 2 (p = 5·10⁻¹⁰).
- L0c: el orden correcto acierta más que la probabilidad simple (59.7 % contra 50.5 %; 59.4 % contra 50.2 %). En el activo con tendencia, "siempre sube" acierta 0.598.
- 2 contra 3 estados: en el activo con reversión tras días grandes, el de 3 estados ve la separación (−0.31, margen 0.08; chi² p = 10⁻¹³) que el de 2 estados solo ve diluida, y acierta más fuera de muestra (60.4 % contra 58.3 %). En el activo sin memoria, ninguno marca separación.
- L2: b1 replica exactamente al JS (0.211623) y confirma el hallazgo de la previa.
- L3: la cobertura p5-p95 del activo GARCH queda dentro del margen de 0.90.
- Tiempo: ~7 s sin L3 y del orden de minutos con L3 (depende de `--mc-step`).

### Cómo se corre con datos reales (cuando el usuario entregue el CSV)

```
py lab_l.py --prices precios.csv [--news noticias.csv] --repo "<ruta del repo>" --out salida_real
```

El usuario comparte `informe.md` y los CSV de salida; no contienen secretos.

---

## 6. Bloques (un PR por bloque), en orden de prioridad para la beta

| # | Bloque | Puntos | Tamaño | Depende de | Parte de "Diseño por niveles" |
|---|---|---|---|---|---|
| 1 | Lecturas seguras + verificación de K | I, K | M | **Hecho:** `842622b`, en la rama con push; merge tras verificar K en la corrida de hoy | Regla 4: `correlation.js` devuelve todas las correlaciones |
| L | Laboratorio (solo lectura) | L0, J2, N2, calibración | M | Script listo y probado con datos sintéticos; falta el CSV real (sección 5) | Regla 3: decide qué parámetros por nivel se activan |
| 2 | Configuración por niveles | 1.2, 1.3 | S-M | — (N1 y N2 decididos) | Reglas 1 y 3: `TIER_LIMITS`, `ENGINE_PARAMS`, `/api/public-config`, sustituir la tabla 1.1; sin cambio visible para Free |
| 3 | Guardas en activos sin historial | B1, parte fija de D | S-M | — | — (el tope de alertas por nivel queda para la Fase 5, 1.5) |
| 4 | Textos y limpieza | E, H | S | J3, H | Regla 1: textos con `radarSize` y `portfolioAssets` interpolados |
| 5 | Patrones binarios | G | S-M | — | Reglas 1 y 3: `patternHorizons` y `patternWindows` desde la configuración |
| 6 | Sigma y postura de riesgo | A, F | M | — (J1 = b) | Regla 3: `newsSensitivity` |
| 7 | Markowitz (mínima varianza) | D | S-M (M con endpoint) | Bloque 1 (J2 = b) | Regla 2: cálculo para N activos en el servidor |
| 8 | Radar en el servidor (J3 = b) | J3 | M | Bloque 2; nombre de la sección | Reglas 2 y 4: `/api/radar` con ranking completo |
| 9 | Futuros: diagnóstico y corrección | C1, luego C2 | S + M | Aprobación C2 | — |
| 10 | Poblar los 4 activos + calendario cripto | B2 | L | Bloques 1 y 9 (C2), aprobación B2 | Nota: universo de activos en una sola lista (B2.5) |

Cada diff de producción se muestra antes de aplicarlo; `git add` por ruta; sin push, SQL ni workflow hasta que el usuario lo indique.

---

## 7. Pendientes para fases posteriores

- **Fase 5 — validar el nivel en el servidor** (1.5): hoy todo límite por nivel se controla solo en el navegador; Premium lo requerirá en el servidor.
- **Fase 5 — Supabase: "Automatically expose new tables" está activado.** Supabase recomienda desactivarlo: con esa opción, toda tabla nueva queda expuesta por la API desde que se crea. Revisarlo junto con las RLS de las 20 tablas.
- **Bloque 2 — correlaciones por nivel:** hoy la interfaz muestra como máximo **una** correlación (la primera confirmada por volumen, `renderShadowEngine`), igual para todos los niveles, y solo dentro del motor sombra oculto. No hay regla por nivel. Si vuelve en la Fase 5, el número debe salir de `TIER_LIMITS` (p. ej. `correlationSuggestions`).
- **Fase 5 — b1 (`sensitivity-factor.js:58`):** la previa domina el ajuste (sección 5, L0a). Corregir antes de usar b1 en cualquier nivel, y solo si L lo justifica.
- **Fase 5 — `NEWS_SENSITIVITY_FACTOR`:** el resultado de `applyNewsWeighting` (`index.html:679`) no se usa; decidir si se borra o se conecta según L2.
- **Límites de Elite (E1):** el agente los propone según el diseño de las pantallas; mientras tanto, la interfaz usa el tope visual `UI_CAPS`.
- **Laboratorio L:** comparativa b1 contra `NEWS_SENSITIVITY_FACTOR` y validación del μ histórico antes de activar cualquier parámetro "más sensible" en Premium.
- **Fase 5 — `asset_prediction_audit`** crece en cada consulta de patrones (ya anotado en fase-2-plan, sección 9); se agrava mientras `loadShadowCorrelation` siga activo (punto I).
- **Diseño de Premium — Monte Carlo por nivel:** requiere columna `tier` o tabla nueva en `asset_montecarlo_simulation` (cambio de esquema, 1.3).
- **Universo de activos en una sola lista** (B2.5).
- **Fase 8:** `alt` y captura de `homepage/assets/prob tomorrow.png` (E).
