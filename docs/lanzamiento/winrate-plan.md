# Win Rate (#130 y #131): hallazgos y plan

- **Fecha:** 2026-10-05
- **Rama:** `lanzamiento-winrate` (desde `main` en `9905289`, merge de la Fase 2, PR #3)
- **Alcance de hoy:** solo investigación y plan. No se editó código ni se ejecutó SQL. No se tocó `asset_historical_prices` ni el esquema.
- **Referencias:** [fase-1-auditoria.md](fase-1-auditoria.md) (#107, #128, #130, #131) y [fase-2-plan.md](fase-2-plan.md) (patrón de `fetch_price_history` y pendientes de Fase 3).

---

## 1. Hallazgos

### a) #131: cómo leen el historial `/api/winrate` y `/api/winrate-shadow`

| Archivo | Línea | Lectura |
|---|---|---|
| `functions/api/winrate.js` | 38 | `asset_historical_prices?symbol=eq.X&order=date.asc&select=close,date&limit=400` |
| `functions/api/winrate-shadow.js` | 44 | Idéntica: `order=date.asc`, `limit=400` |

- **Confirmado:** ambos piden las 400 filas **más antiguas** de cada símbolo. Con ~504 filas por símbolo (dato de la auditoría, 2026-10-03), quedan fuera las ~104 sesiones más recientes. `asOf` y `lastClose` (winrate.js:68, winrate-shadow.js:71) son los de la fila 400 (abril de 2025) y no hay ningún error visible.
- **`max_rows`:** con `limit=400` no se llega al `max_rows` de PostgREST (1 000 por defecto en Supabase). El problema actual es solo el orden, no el truncado del servidor. Si algún día se subiera el `limit` por encima de `max_rows`, el orden `asc` también haría que se perdieran las filas recientes; el orden `desc` evita ambos casos.
- **Propuesta (mismo patrón que `fetch_price_history`, montecarlo_engine.py:639-657):** `order: 'date.desc'`, mismo `limit`, y `rows.reverse()` justo después de `response.json()`. El resto del backtest (que recorre de antiguo a reciente) no cambia.
- **Límite: mantener 400.** Motivos: (1) mismo tamaño de muestra que hoy, así el cambio solo mueve la ventana en el tiempo; (2) el backtest de `winrate-shadow.js` es O(n²) por símbolo (l. 54-62: por cada día recorre todo el historial conocido con `slice` y `join`) y se ejecuta para 30 símbolos en una sola petición; con 400 filas ya sabemos que cabe en el límite de CPU del Worker. Subir a todo el historial (~504) es posible, pero cambia el costo y conviene decidirlo aparte (ver D1).
- **Otras lecturas en esos dos archivos:** no hay. Cada archivo hace una sola consulta a Supabase. El `history.slice(-30)` de winrate.js:68 ya toma los 30 días más recientes **del arreglo**, así que se corrige solo cuando el arreglo esté en orden correcto.
- **Caché del servidor:** ambos endpoints guardan la respuesta de `?all=1` en `caches.default` durante 30 min con una clave fija (`https://asset-winrate-cache.internal/all` y `https://asset-winrate-shadow-cache.internal/all`). Ese caché no se borra con un despliegue, así que tras el merge se podría servir hasta 30 min el resultado calculado con el código viejo. Propuesta: cambiar la clave a `.../all-v2` en el mismo commit (ver D4).

**Mismo problema fuera de esos archivos (solo registro; no entra en este arreglo):**

| Archivo | Lectura | Riesgo hoy |
|---|---|---|
| `functions/api/market/[symbol].js:35` | `asc`, `limit=1826` | Ya anotado en fase-2-plan (Fase 3). No ocurre con ~504-760 filas. |
| `functions/api/patterns.js:19` y `:32` | `asc`, **sin `limit`** | Ya anotado en fase-2-plan (Fase 3) para `asset_signals`; la segunda lectura (precios, l. 32) tiene el mismo riesgo y no estaba anotada. |
| `markov-matrix.js:43`, `patterns-vectors.js:33`, `sensitivity-factor.js:43` | `asc`, `limit=5000` | Con `max_rows` de 1 000, a partir de 1 000 filas recibirían las más antiguas. Hoy no ocurre. |
| `functions/api/correlation.js:21` | Todos los símbolos, últimos 130 días naturales, `order=symbol.asc,date.asc`, **sin `limit`** | **Posible fallo actual:** ~90 sesiones × 30 símbolos ≈ 2 700 filas. Si el `max_rows` del proyecto es 1 000, la respuesta se corta y solo llegan los primeros ~11 símbolos en orden alfabético. **Hay que verificar** el `max_rows` del proyecto en Supabase (API settings) antes de darlo por hecho. Lo propongo como hallazgo nuevo para la Fase 3, no para esta rama. |

### b) #130: dónde la corrida llama a los endpoints y qué falta

- **No existe una función `calculate_win_rate`.** La auditoría la nombra así, pero en `main` es un bloque en el nivel superior de `actualizar_automatico.py`, **l. 254-274**, entre el upsert de `asset_signals` y `send_push_alerts()`.
- La llamada es `requests.get(f"{PAGES_BASE_URL.rstrip('/')}{path}", timeout=30)` (l. 261), **sin headers**. `PAGES_BASE_URL` sale del secreto de GitHub del mismo nombre (workflow l. 39).
- Ambos endpoints llaman a `checkAdminAuth` (`functions/_shared/admin-auth.js`), que exige `X-Admin-Secret` igual a `ADMIN_API_SECRET`. Desde `1a36a4f` (1-oct) es cerrada por defecto: 503 si Cloudflare no tiene el secreto y 401 si falta el header o no coincide.
- El error queda dentro de `try/except` (l. 271-272): la corrida sigue y termina en verde, así que el fallo solo se ve en el log.
- **Qué hace falta:**
  1. **Secreto de GitHub `ADMIN_API_SECRET`** (Settings → Secrets and variables → Actions), con **el mismo valor que en Cloudflare Pages → Production**. Lo crea el usuario; el valor no pasa por el chat ni por el repo.
  2. **Workflow** (`.github/workflows/daily_update.yml`, `env` del paso "Ejecutar script de actualización", l. 36-43): `ADMIN_API_SECRET: ${{ secrets.ADMIN_API_SECRET }}`.
  3. **Script:** leer `ADMIN_API_SECRET = os.environ.get("ADMIN_API_SECRET")` junto a las demás variables (l. 13-23) y llamar con `headers={"X-Admin-Secret": ADMIN_API_SECRET}`. Si falta, imprimir `"ADMIN_API_SECRET no configurado; se omite el registro diario de Win Rate."` y no llamar (hoy solo se comprueba `PAGES_BASE_URL`).
- **Que el valor no aparezca en el log:**
  - El script nunca lo imprime. Los mensajes actuales imprimen `e` (para un `HTTPError` de `requests` el texto es `401 Client Error: Unauthorized for url: …`, sin headers) y `globalWinRate`. No hay `print(response.request.headers)` ni nada parecido, y no se agregará.
  - GitHub Actions enmascara con `***` cualquier aparición literal de un secreto en el log.
  - Para diagnosticar se registrará solo el status: `HTTP 401`/`HTTP 503`, nunca el header.
  - Nota: el valor de `ADMIN_API_SECRET` es hoy la misma contraseña que el superadmin teclea en `admin-go` (ver `.dev.vars.example`). Guardarla como secreto de GitHub no cambia su exposición, pero es un motivo más para no imprimirla.

### c) Qué se escribe en `win_rate_history` y los días perdidos

- **Esquema** (`schema.sql:266-275`): `date`, `engine` (`legacy` | `shadow_v2`), `global_win_rate`, `details jsonb`, `computed_at`; PK `(date, engine)`; RLS activado **sin políticas** (solo `service_role` lee y escribe).
- **Por corrida:** una fila por motor, `upsert` con `on_conflict="date,engine"` y `date = date.today()` del runner (la corrida es a las 22:00 UTC, así que es la fecha del día de mercado). `details` guarda la respuesta completa del endpoint: para `legacy`, 30 objetos con `winRate`, `bandCoverage`, `proximity`, `sampleSize`, `lastClose`, `asOf` y los 30 puntajes diarios más recientes (`history`); para `shadow_v2`, solo agregados por símbolo.
- **Filas actuales:** 4 por motor, última fecha 2026-09-29 (consulta del usuario del 2026-10-03, registrada en #130). Hoy no puedo volver a contarlas: no hay credenciales locales con lectura (RLS sin política para `anon`). Consulta para confirmarlo:
  ```sql
  select engine, count(*), min(date), max(date)
  from public.win_rate_history group by engine order by engine;
  ```
- **Las 4 filas existentes ya estaban afectadas por #131:** se calcularon con las 400 filas más antiguas (`asOf` de abril de 2025). No sirven como punto de comparación con las nuevas.
- **Días perdidos desde ~30-sep: quedan como huecos.** El endpoint no guarda estado: cada llamada rehace el backtest completo "a hoy" y no acepta fecha de corte. El script guarda ese resultado con la fecha del día. Así que:
  - La primera corrida tras el arreglo **sí incluye** los cierres de los días perdidos en su muestra (y en el `history` de `legacy`).
  - Pero **no recrea** las filas diarias del 30-sep al día del merge.
  - Recrearlas exigiría un parámetro nuevo de fecha de corte (`?until=YYYY-MM-DD`) más un backfill que escribe en producción. **Recomendación: no hacer backfill** (ver D2). Esta serie solo sirve para comparar los dos motores a partir de ahora, y las filas previas no son comparables.

### d) Dónde se muestra el Win Rate en la interfaz

- **Solo en el panel de superadmin dentro de `index.html`** (`#admin-dashboard-modal`, l. 224), al que se entra con el login demo de administrador. Se llena con `loadWinRateKpi` / `renderWinRateKpi` / `renderShadowWinRate` (l. 506-511), que llaman **en vivo** a `/api/winrate?all=1` y `/api/winrate-shadow?all=1` con `adminHeaders()`.
- **Oculto desde la Fase 1 (#107):** `#winrate-global-tag`, `#winrate-notice`, `#winrate-promote-note`, `#winrate-table` (CSS, l. 66) y las gráficas "Win Rate por activo" y "Evolución del acierto predictivo" (`.f1-oculto`).
- **Sigue visible para el superadmin:** la etiqueta **"MOTOR SOMBRA (v2) xx %"** (`#winrate-shadow-tag`) y el botón "Recalcular". Tras el arreglo, ese porcentaje cambiará porque pasará a calcularse con datos recientes. Es el único cambio visible.
- **Nada público depende de esto.** El bloque "Modo sombra · motor de señales v2" del panel de patrones (l. 111, #50) usa `patterns.js`, no el Win Rate. `admin.html` no lo usa. **Ninguna pantalla ni endpoint lee `win_rate_history`**: hoy solo se escribe.
- Nota menor (no entra aquí): "Recalcular" omite el caché del navegador, pero no el `caches.default` del servidor (30 min), así que no siempre recalcula de verdad.

### e) Cómo probar antes del merge sin ensuciar producción

Las tres pruebas solo **leen** de Supabase. Ninguna escribe en `win_rate_history` ni en `asset_historical_prices`.

1. **Local, sin red:** un script de Node, `test_winrate_synthetic.mjs` (como `test_montecarlo_synthetic.py` de la Fase 2), que importa `onRequestGet` de ambos endpoints con `fetch` y `caches` simulados y 504 filas sintéticas. Comprueba: (a) que la URL pedida lleva `order=date.desc` y `limit=400`; (b) que `asOf` es la última fecha sintética y `lastClose` su cierre; (c) que `sampleSize` es 394 en legacy (400 − 5 − 1) y que shadow_v2 sigue devolviendo resultado; (d) 401 sin header y 503 sin `ADMIN_API_SECRET`.
2. **Preview de Cloudflare Pages:** al subir la rama, Pages crea un despliegue de preview con el código nuevo. Se llama con `curl` a `/api/winrate?symbol=AAPL` y `/api/winrate-shadow?symbol=AAPL`, **sin `all=1`** para no pasar por el caché compartido, con el header leído de una variable de entorno local, sin escribirlo en el comando ni en el chat. Requisito: que el entorno **Preview** de Pages tenga `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `ADMIN_API_SECRET` (por verificar en el panel). Se comprueba que `asOf` = `max(date)` de AAPL en `asset_historical_prices`.
3. **Corrida de GitHub Actions desde la rama, sin escribir:** nuevo input `only_winrate` en `workflow_dispatch` (como `only_montecarlo`). Ejecuta solo el bloque del Win Rate y en modo **solo lectura**: imprime motor, status HTTP, `globalWinRate`, `totalSamples` y el `asOf` más reciente, y **no hace upsert**. Como la corrida apunta a `PAGES_BASE_URL` (producción, que hasta el merge tiene el código viejo), esta prueba valida **#130** (200 en lugar de 401, y el secreto enmascarado); el `asOf` seguirá siendo viejo hasta el merge, como es de esperar. Si se prefiere no tocar el workflow para pruebas, la alternativa es validar #130 solo con `curl` y esperar a la primera corrida programada después del merge (ver D3).

---

## 2. Archivos a tocar

| Archivo | Cambio |
|---|---|
| `functions/api/winrate.js` | l. 38: `order: 'date.desc'`; `rows.reverse()` tras l. 41; clave de caché `all-v2` (l. 20). |
| `functions/api/winrate-shadow.js` | l. 44: `order: 'date.desc'`; `rows.reverse()` tras l. 47; clave de caché `all-v2` (l. 23). |
| `actualizar_automatico.py` | Leer `ADMIN_API_SECRET` (l. 13-23); header `X-Admin-Secret` en l. 261; omitir con aviso si falta; status HTTP en el mensaje de error; modo `ONLY_WINRATE` solo lectura (si se aprueba D3), que sale antes de precios, señales, push y Monte Carlo, igual que `ONLY_MONTECARLO`. |
| `.github/workflows/daily_update.yml` | `ADMIN_API_SECRET: ${{ secrets.ADMIN_API_SECRET }}` en el `env` del paso; input `only_winrate` y `ONLY_WINRATE` (si se aprueba D3). |
| `test_winrate_synthetic.mjs` (nuevo) | Prueba local sin red (sección 1.e.1). |
| `docs/lanzamiento/fase-1-auditoria.md` | Estado de #130 y #131 al cerrar. |
| `docs/lanzamiento/winrate-plan.md` | Resultados de las pruebas y criterio de salida. |

**No se tocan:** `schema.sql`, `asset_historical_prices`, `win_rate_history` (más allá de la escritura diaria normal tras el merge), `index.html`, `admin-auth.js`.

## 3. Orden de commits

Cada cambio de producción se muestra como diff antes de aplicarlo. `git add` siempre por ruta.

1. `fix(winrate): leer las 400 sesiones más recientes en legacy y shadow_v2 (#131)`: `winrate.js`, `winrate-shadow.js`, `test_winrate_synthetic.mjs`.
2. `fix(cascada): enviar X-Admin-Secret al registrar el Win Rate (#130)`: `actualizar_automatico.py`, `daily_update.yml`.
3. `docs(lanzamiento): resultados de las pruebas del Win Rate`: este archivo y `fase-1-auditoria.md`.

Requisito previo del usuario, antes de la prueba 1.e.3: crear el secreto `ADMIN_API_SECRET` en GitHub y confirmar las variables del entorno Preview en Cloudflare.

## 4. Pruebas

| # | Prueba | Resultado esperado |
|---|---|---|
| T1 | `node test_winrate_synthetic.mjs` | Todas las comprobaciones de 1.e.1 en verde. |
| T2 | Preview: `?symbol=AAPL` en ambos endpoints, con header | 200; `asOf` = último cierre guardado de AAPL; `sampleSize` 394 (legacy). |
| T3 | Preview: sin header | 401. |
| T4 | Preview: `?symbol=GC=F` (futuro) y un símbolo con poco historial | 200 o 422 (`Historial insuficiente…`), nunca 500. |
| T5 | Actions desde la rama con `only_winrate` | `HTTP 200` en ambos motores; ninguna línea muestra el secreto; no hay mensaje de upsert; `win_rate_history` sin filas nuevas (consulta de 1.c). |
| T6 | Consola del navegador en el panel de superadmin (preview) | "MOTOR SOMBRA (v2)" muestra un valor; sin errores en consola. |

## 5. Criterio de salida

- `/api/winrate` y `/api/winrate-shadow` devuelven `asOf` igual a la última fecha de `asset_historical_prices` para cada símbolo con datos (comprobado al menos en AAPL y GC=F).
- La primera corrida programada desde `main` tras el merge registra en el log `Win Rate (legacy) registrado: …` y `Win Rate (shadow_v2) registrado: …`, sin 401/503 y sin el valor del secreto.
- `win_rate_history` tiene una fila nueva por motor con la fecha de esa corrida, y el `asOf` dentro de `details` es reciente:
  ```sql
  select date, engine, global_win_rate,
         (select max(i->>'asOf') from jsonb_array_elements(details->'items') i) as max_as_of
  from public.win_rate_history order by date desc, engine limit 4;
  ```
- Los huecos del 30-sep al día del merge y la falta de comparabilidad con las 4 filas previas quedan anotados en #130/#131.

## 6. Decisiones pendientes del usuario

| # | Pregunta | Recomendación |
|---|---|---|
| D1 | ¿Mantener `limit=400` o leer todo el historial (~504; hasta 1 000 por `max_rows`)? | **Mantener 400.** Mismo tamaño de muestra y mismo costo de CPU en shadow_v2 (O(n²)). |
| D2 | ¿Backfill de las filas diarias de `win_rate_history` desde el 30-sep? | **No.** Requiere un parámetro nuevo y escribir en producción, y las filas previas no son comparables. Se dejan los huecos documentados. |
| D3 | ¿Añadir el input `only_winrate` (solo lectura) al workflow para probar desde la rama? | **Sí.** Es la única forma de verificar el secreto de GitHub antes del merge sin escribir en producción. |
| D4 | ¿Cambiar la clave de caché del servidor a `all-v2`? | **Sí.** Evita servir hasta 30 min el resultado viejo después del despliegue. |
| D5 | Hallazgo nuevo de `correlation.js` (posible corte por `max_rows`): ¿pasa a la Fase 3? | **Sí, a la Fase 3**, primero verificando el `max_rows` del proyecto. |
