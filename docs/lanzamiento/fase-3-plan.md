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
| L4 | **Aprobado y corrido (2026-10-12):** H1 y H2 solo con acciones, H3 con todos, umbral p < 0.017, misma prueba fuera de muestra. Resultado en la sección 5. |
| M | **Decidido (2026-10-12): factor global por horizonte** (`k50`, `k90`), **sin factor por tipo de activo**. Se reevalúa después de corregir los futuros (punto C) y con más datos. Implementado en la rama, sin commit (M.6). |
| M.4 | **Aprobados** los textos de "Estándar" y "Amplio" en es/en/zh, con las cifras tomadas de la configuración junto con la fecha de medición. |
| N2 | **Regla (2026-10-12):** b1 no se activa en Premium hasta corregir la previa (`sensitivity-factor.js:58`) y superar a la regla 1.18 × MAD fuera de muestra. El "motor más sensible" de Premium será el **factor b1** de `sensitivity-factor.js`. En la Fase 3 solo queda como parámetro configurable por nivel, **apagado**. La comparativa b1 contra `NEWS_SENSITIVITY_FACTOR` se hace en el laboratorio L. Ningún parámetro "más sensible" se activa en Premium hasta que L muestre que mejora el acierto fuera de muestra. |

**Siguen pendientes:**

| # | Pregunta | Dónde |
|---|---|---|
| S | **Prioritario:** PR S fusionado (#7, `2641a0a`) y verificado en Producción el 2026-10-13 (28/28 rutas; login de admin con la clave nueva). Falta: Cloudflare Access en los Previews y repo privado, el mismo día (sección S, "Pendiente prioritario"). | Sección S |
| B2 | Aprobación para escribir en `asset_historical_prices` (backfill de los 4 activos). | Punto B |
| C2 | Aprobación para reescribir cierres de futuros dentro de la ventana. | Punto C |
| E1 | Límites de Elite según el diseño (propuesta del agente, más adelante). | Sección 1.2 |

---

## S. Bloque de seguridad PRIORITARIO (adelantado de la Fase 5 el 2026-10-12)

> Verificaciones de solo lectura. Ningún valor de credenciales se imprimió ni se escribe aquí. Nada se ha cambiado todavía: todo lo de esta sección es propuesta y requiere el visto bueno del usuario.

### S1. Credenciales en archivos públicos — **SÍ**

**Contraseña del superadmin (la que valida `admin-go`):** sí aparece, en texto plano, en archivos servidos al público.

| Dónde | Qué |
|---|---|
| `index.html:262` | Manejador de `admin-go`: compara usuario y contraseña con literales y guarda la contraseña tecleada en `adminApiSecret`. |
| `index.html:263` | Login del formulario principal en modo admin: la misma contraseña con otro usuario. |
| `admin.html:103` (y usuario en `admin.html:44`) | Backoffice: la misma comparación. |
| `README.md:43` | La documenta como "contraseña demo". |

- **Está en `origin/main`**, es decir, en lo que sirve Producción (`/`, `/admin` y `/README.md` en thalgorithm.com) y GitHub Pages (S2).
- **Historial de git:** la contraseña entre comillas entra en los commits `f9417aa` y `02707b0` (2026-08-27) y no ha salido. El usuario aparece además en `db0be60`.
- Desde 2026-10-01, `winrate-plan.md:65` y el comentario de `.dev.vars.example` dicen que `ADMIN_API_SECRET` "es hoy la misma contraseña". Los dos archivos son públicos.

**Valor de `ADMIN_API_SECRET`:** **no aparece** en ningún archivo del repo ni del historial con ese nombre. `.dev.vars.example` no tiene valores, y `.dev.vars` está en `.gitignore` y no existe en el repo. **No se puede confirmar** desde aquí si es igual a la contraseña demo, porque el valor vive en Cloudflare y en GitHub. Si lo es (como dicen los documentos), **el secreto que protege los endpoints de admin es público de hecho.**

**Qué protege hoy `ADMIN_API_SECRET`** (`checkAdminAuth`): `winrate.js`, `winrate-shadow.js`, `montecarlo.js`, `markov-matrix.js`, `patterns-vectors.js`, `sensitivity-factor.js`, `track-view.js` y `admin/metrics.js`.
- **Lectura:** conteos de `page_views` y `profiles` (solo `created_at`, sin datos personales), y la fila completa de Monte Carlo, que incluye VaR y CVaR.
- **Escritura:** `markov-matrix`, `patterns-vectors` y `sensitivity-factor` hacen upsert de sus tablas de snapshots cada vez que se llaman (datos calculados, no arbitrarios).
- **Costo:** `winrate*?all=1` recalcula el backtest de 30 activos (CPU del Worker).
- **Riesgo:** moderado. Sin datos personales, pero permite escribir y gastar recursos.

**Propuesta S1** (orden sugerido; requiere aprobación):
1. **Rotar `ADMIN_API_SECRET`** a un valor aleatorio largo, independiente de la contraseña demo, en Cloudflare (Production y Preview) y en el secreto de GitHub. Lo hace el usuario; el valor no pasa por el chat. Es lo único que corrige el historial, porque la contraseña ya es pública.
2. **Quitar los literales del navegador:** `admin-go` deja de comparar con una contraseña escrita en el código; el admin teclea el secreto, el panel lo envía como `X-Admin-Secret` y el servidor decide (401 si no coincide). Lo mismo en `index.html:263` y `admin.html:103`.
3. Quitar las credenciales de `README.md:43`, del comentario de `.dev.vars.example` y de `winrate-plan.md:65` (solo el texto; el historial queda).
4. **Verificación:** con el secreto nuevo, `curl` sin header → 401; con el valor viejo → 401; el panel de superadmin funciona tecleando el secreto nuevo.

### S2. Archivos del repo publicados como estáticos

**Cloudflare Pages** (`pages_build_output_dir = "."`, `_routes.json` solo manda `/api/*` a las Functions). Verificado con `curl -I` contra thalgorithm.com, solo lectura:

| Público hoy (200 con el archivo real) | No publicado (devuelve la página de inicio) |
|---|---|
| `docs/lanzamiento/*.md` de `main` (auditoría, planes, `winrate-plan.md`), `docs/lanzamiento/fase-2-migracion.sql`, `schema.sql`, `README.md`, `AGENTS.md`, `actualizar_automatico.py`, `montecarlo_engine.py`, `test_montecarlo_synthetic.py`, `.github/workflows/daily_update.yml`, `.dev.vars.example` (sin valores), `wrangler.toml`, `package.json`, `.gitignore` | `functions/**` (código de las Functions), `.git/`, `_routes.json`, archivos que no están en `main` |

- También es público `homepage/assets/shanghai-hero.jpg.png`, la imagen original con los subtítulos retirados en #91.
- Con el merge de la Fase 3 se publicarían además `docs/lanzamiento/fase-3-plan.md` (que describe estos hallazgos). **Corrección (2026-10-13):** `functions/_shared/engine-params.json` **no se publica**. Cloudflare Pages no sube la carpeta `functions/` como archivos estáticos: en el Preview, `/functions/_shared/engine-params.json` responde 200 con la página de inicio, no con el JSON. El motor lo lee del repo, así que no le afecta. Si el navegador necesita esas cifras (p. ej. los textos de "Estándar" y "Amplio" del bloque 6), tendrá que pedirlas a una Function, como `/api/tier-config` (bloque 2). La regla del middleware que lo permite no hace daño y se puede quitar.

**GitHub Pages está ACTIVO** (`has_pages: true`): `ricardoblancarte.github.io/PROYECTO-1/` sirve el mismo repositorio (200 en `README.md`, `docs/lanzamiento/winrate-plan.md`, `schema.sql`, `actualizar_automatico.py`). **El middleware de Cloudflare no lo protege**: hay que apagarlo aparte (Settings → Pages → Unpublish), o hacer el repo privado (S3).

**Propuesta S2: `functions/_middleware.js` con lista de permitidos** (sin implementar). Todo lo que no esté en la lista responde 404, así un archivo nuevo queda bloqueado por defecto. Además, una lista explícita de bloqueados por si alguien amplía los permitidos.

```js
// functions/_middleware.js — solo se sirve lo que usa la página; el resto, 404.
const ALLOWED = [
  /^\/$/, /^\/index(\.html)?$/,                 // terminal
  /^\/admin(\.html)?$/,                          // backoffice demo (ver S1)
  /^\/homepage(\/.*)?$/,                         // homepage, assets/*.png y locales/*.json
  /^\/sw\.js$/, /^\/supabase-config\.js$/,
  /^\/favicon\.png$/, /^\/logo_algorithm\.svg$/,
  /^\/functions\/_shared\/engine-params\.json$/, // público por decisión del usuario
  /^\/api\//                                    // Functions
];
const BLOCKED = /^\/(docs|\.github|\.git|functions\/(?!_shared\/engine-params\.json$)|node_modules|scratch)(\/|$)|\.(md|sql|py|pyc|toml|ya?ml|map|log|bak|tmp|example)$|(^|\/)(\.gitignore|\.dev\.vars[^/]*|\.env[^/]*|package(-lock)?\.json|wrangler\.toml|_routes\.json|shanghai-hero\.jpg\.png)$/i;

export async function onRequest(context) {
  const path = decodeURIComponent(new URL(context.request.url).pathname);
  if (!BLOCKED.test(path) && ALLOWED.some(rule => rule.test(path))) return context.next();
  return new Response('No encontrado.', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}
```

- **Requisito: cambiar `_routes.json`.** Hoy las Functions (y por tanto el middleware) solo corren en `/api/*`, así que un middleware **no vería** `/docs/...`. Propuesta: `"include": ["/*"]` y `"exclude"` con los estáticos permitidos (`/`, `/index.html`, `/admin`, `/admin.html`, `/homepage/*`, `/sw.js`, `/supabase-config.js`, `/favicon.png`, `/logo_algorithm.svg`), para no gastar invocaciones de Functions en ellos. Todo lo demás pasa por el middleware y recibe 404. Límite de Pages: 100 reglas en `_routes.json`; aquí son ~11.
- **Efecto secundario:** las rutas inexistentes dejan de devolver la página de inicio con 200 y devuelven 404. Es lo correcto.
- **Alternativa más limpia (más trabajo):** carpeta de salida dedicada (`public/` con `index.html`, `admin.html`, `homepage/`, `sw.js`, `supabase-config.js`, `favicon.png`, `logo_algorithm.svg`, `_routes.json`) y `pages_build_output_dir = "public"`. Las Functions siguen en `functions/` en la raíz. Cambia rutas de archivos en el repo (no las URL públicas) y hay que confirmar la configuración de Pages en el panel. Se puede hacer después del middleware.
- **Cómo probarlo en el Preview** (después del push de la rama, con la URL del Preview en `$PREVIEW`):

```
for p in / /index.html /admin /homepage/ /homepage/locales/es.json "/homepage/assets/top%20portafolios.png" /sw.js /supabase-config.js /favicon.png /logo_algorithm.svg /functions/_shared/engine-params.json "/api/escenarios?symbol=AAPL" \
         /schema.sql /README.md /AGENTS.md /docs/lanzamiento/winrate-plan.md /docs/lanzamiento/fase-2-migracion.sql /actualizar_automatico.py /montecarlo_engine.py \
         /test_montecarlo_synthetic.py /.github/workflows/daily_update.yml /.dev.vars.example /wrangler.toml /package.json /.gitignore /homepage/assets/shanghai-hero.jpg.png /no-existe; do
  printf "%-50s " "$p"; curl -s -o /dev/null -w "%{http_code} %{content_type}\n" "$PREVIEW$p"; done
```

  **Esperado:** las primeras 12 rutas → 200 (o 308 en las `.html`); las demás → **404**. Después, en el navegador: terminal, homepage en es/en/zh, imágenes, registro del service worker, `/api/*`, panel de superadmin y consola sin errores.

### S3. ¿Qué pasa si el repo se hace privado? (solo explicación; no se cambió nada)

- **Cloudflare Pages:** sigue funcionando. La integración usa la app de GitHub de Cloudflare, que conserva el acceso al repo privado si se instaló con acceso a este repositorio (o a todos). Los despliegues de Producción y Preview siguen igual. **Pero hacer el repo privado no cambia lo que Cloudflare publica**: sin S2, `docs/`, `schema.sql` y demás siguen servidos en thalgorithm.com.
- **GitHub Actions:** sigue funcionando (schedule, `workflow_dispatch` y secretos). En un repo privado del plan Free los minutos son limitados (2 000 al mes); la cascada diaria usa una fracción pequeña. Conviene revisar el uso en Settings → Billing.
- **Lo que se apaga o cambia:**
  - **GitHub Pages:** en el plan Free no está disponible para repos privados, así que `ricardoblancarte.github.io/PROYECTO-1/` deja de publicarse. Es justo lo que conviene; se puede apagar también sin hacer el repo privado.
  - **Estrellas y observadores:** GitHub avisa que se pierden al pasar a privado (hoy son 0).
  - **Reglas de protección de ramas:** en el plan Free no están disponibles para repos privados (hoy no se usan, hasta donde se ve en el repo).
  - **Enlaces públicos** al repo o a archivos `raw` dejan de funcionar.
  - **Forks:** hoy hay 0.
- **No borra lo ya publicado:** el historial con la contraseña pudo haberse copiado o quedar en cachés. Por eso la rotación (S1.1) es necesaria en cualquier caso.

### Estado de S (2026-10-12)

| Paso | Estado |
|---|---|
| Rotar `ADMIN_API_SECRET` | **Hecho por el usuario:** GitHub, Cloudflare Production y Preview, con redespliegue. La contraseña vieja da 401 en ambos entornos (verificado por el usuario). |
| Apagar GitHub Pages | **Hecho por el usuario** (despublicado, Branch = None). Verificado por el agente: `github.io/PROYECTO-1/` responde 404 en `/`, `README.md`, `winrate-plan.md` y `schema.sql`; la API de GitHub devuelve `has_pages: false`. |
| PR "S": middleware, `_routes.json` y quitar los literales (S1.2, S1.3, S2) | **Fusionado** (#7, `2641a0a`, 2026-10-13). Verificado en Producción por el agente (28/28 rutas con `curl`; `/api/winrate*` sin clave dan 401 de la Function, o sea que pasan el middleware) y por el usuario en el navegador (clave vieja → "Clave incorrecta."; la nueva entra; MOTOR SOMBRA (v2) 49.9 %; con F5 la vuelve a pedir; también en `/admin`). |
| ¿Repo privado? (S3) | **Decidido:** sí, después de los merges de la Fase 3. Lo hace el usuario en GitHub; el agente confirma después que Cloudflare y Actions siguen funcionando. |
| Cloudflare Access en los Previews | **Pendiente prioritario**, el mismo día que el repo pase a privado (ver abajo). |

**Pendiente prioritario de S: los Previews viejos siguen publicando archivos (2026-10-13).** Cloudflare mantiene accesible cada despliegue de Preview, por su alias de rama y por su URL con hash, hasta que se borra. Los alias de ramas anteriores a S no tienen middleware. Verificado con `curl`: `lanzamiento-1-5c`, `lanzamiento-winrate` y `lanzamiento-f2-montecarlo` responden 200 en `/schema.sql` y `docs/` (en la última, `docs/` ya responde 200 HTML, pero `schema.sql` sigue expuesto), y sirven el `index.html` viejo con la contraseña demo, que ya no abre nada. `lanzamiento-f3-bloque1` y `lanzamiento-f3-calculos` ya traen `main` con S.
- **Opción elegida: Cloudflare Access en "Preview deployments"**, a activar el mismo día que el repo pase a privado. Workers & Pages → proyecto → Settings → *Enable access policy*.
- **Lo que pide Cloudflare:**
  - una organización de Zero Trust; el plan Free incluye 50 usuarios;
  - según el foro de Cloudflare (sin documentación oficial encontrada), **un método de pago aunque el cargo sea $0**: confirmarlo en el panel;
  - por defecto se entra con un código de un solo uso enviado al correo.
- **Cuidado:** *Enable access policy* crea **dos** políticas: una para el `*.pages.dev` de Producción (`algorithm-global-engine.pages.dev`) y otra para los Previews. Si `PAGES_BASE_URL` (secreto de GitHub, no legible) apuntara a `algorithm-global-engine.pages.dev`, la cascada recibiría la pantalla de Access y **dejaría de registrar el Win Rate**.
  - **Antes de activarlo:** volver a guardar `PAGES_BASE_URL` con `https://thalgorithm.com` (es una URL pública).
  - **Después:** decidir si se conserva o se borra la política del `*.pages.dev` de Producción.
  - `thalgorithm.com` no queda protegido por esas políticas (necesitaría su propia aplicación de Access), así que sigue público.
- **Evidencia sobre `PAGES_BASE_URL`:** la corrida #30 (desde `lanzamiento-winrate`) devolvió el `asOf` del código viejo, así que no apunta a un alias de Preview de rama. No descarta `algorithm-global-engine.pages.dev`.
- **Alternativas o complementos:** borrar en Cloudflare los despliegues viejos de esas ramas, o hacer merge de `main` en las ramas que sigan vivas (esto solo cubre el alias, no las URLs con hash).

**Costo del middleware (2026-10-13):** con `"include": ["/*"]`, toda ruta que no esté en `exclude` ejecuta el middleware: una invocación de Functions por petición. Hoy pasan por ahí las imágenes de `/homepage/assets/*` (~10 por visita a la homepage), `/admin` con barra final, las rutas inexistentes y `/api/*`. El plan gratis de Functions tiene un límite diario de invocaciones. **Revisar el costo si el tráfico crece** (Cloudflare → Workers & Pages → métricas). Opciones: excluir `/homepage/assets/*` en `_routes.json` y borrar del repo `shanghai-hero.jpg.png`, la única imagen bloqueada, o mover los estáticos a una carpeta de salida dedicada (S2).

**Efectos de la rotación que hay que vigilar:**
- **Panel de superadmin:** `admin-go` sigue validando la contraseña demo y la envía como `X-Admin-Secret`, así que los endpoints de admin responden **401** hasta implementar S1.2 (teclear el secreto nuevo). Afecta "MOTOR SOMBRA (v2)", "Recalcular" y las métricas del panel. Es esperado, no es una falla nueva.
- **Cascada de esta noche:** usa el secreto nuevo de GitHub. En el log deben aparecer `Win Rate (legacy) registrado: …` y `Win Rate (shadow_v2) registrado: …` sin `HTTP 401` (#130).
- **Sigue público en Cloudflare** (hasta el middleware): los documentos, `schema.sql` y los scripts. La contraseña demo y la mención de que era igual al secreto ya no abren nada.

### Orden propuesto para S

1. Rotar `ADMIN_API_SECRET` (usuario) y apagar GitHub Pages (usuario).
2. PR "S": middleware y `_routes.json` (S2) más quitar los literales del navegador (S1.2-S1.3). Probar en el Preview con los `curl` de arriba.
3. Decidir si el repo pasa a privado (S3).
4. Más adelante, opcional: carpeta `public/` dedicada.

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
- **Cambio (J1 = b):** se elimina `RISK_MULTIPLIER` y `effectiveSigma` deja de escalar. El control decide qué bandas dibuja el abanico: **Estándar** = p25-p75 (la mitad de los escenarios); **Amplio** = además p5-p95. **El texto no dice "9 de cada 10"** mientras no exista la calibración (punto M): dice la cobertura medida en L3 (ver M.4). Se reescriben el aviso de l. 94, los toasts de `setRiskPosture`, el paso 8 del tour y la homepage (`attributes[4]`, `block7`). Se conservan los valores `conservative`/`open` en `user_state.risk_posture` (`schema.sql:236`), así que **no hay cambio de esquema**.
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
- **`max_rows` = 1 000** (valor por defecto de Supabase; confirmado por el usuario el 2026-10-12; no se cambia). El arreglo no depende de su valor.
- **Prueba:** prueba local con `fetch` simulado de 1 200 filas (como T1 del Win Rate); en el Preview, la gráfica de AAPL termina en el último cierre.
- **Niveles:** `correlation.js` devuelve todas las correlaciones sobre el umbral (1.4). `RETENTION` de `market/[symbol].js` pasa a la configuración en el bloque 2, donde vive `tier-config.js`.

---

### M. Calibración de Monte Carlo — M

**M.1 Medición (L3, 2026-10-12, 30 activos, 26 fechas por activo y horizonte, solo lectura):**

| Horizonte | Dentro de p25-p75 (esperado 50 %) | Dentro de p5-p95 (esperado 90 %) |
|---|---|---|
| Día | 46.7 % (±3.5) | **85.0 %** (±2.1) |
| Semana | 44.7 % (±3.5) | **87.3 %** (±2.1) |

Las bandas son algo **angostas**, sobre todo la exterior. El margen supone independencia entre activos; como en las mismas fechas se mueven juntos, el margen real es mayor.

**M.2 Causas posibles (por verificar, no confirmadas):**
1. El pool de shocks pesa por `e^-Mahalanobis` (`montecarlo_engine.py:541-544`): concentra el peso en pocos días parecidos a hoy, baja el tamaño efectivo de muestra y adelgaza las colas.
2. El pronóstico GARCH de un paso no incorpora la incertidumbre de sus propios parámetros ni los saltos.
3. La renormalización `E[z²] = 1` (l. 549-550) fija la varianza, pero no la forma de las colas.

**M.3 Opciones:**

| Opción | Qué hace | Pros | Contras |
|---|---|---|---|
| **a) Factor de calibración empírico por horizonte (recomendada primero)** | Ensancha las distancias a la mediana: `q' = p50 + k · (q − p50)`, con `k50` para p25/p75 y `k90` para p5/p95 (p10/p90 interpolado), uno por horizonte. Los `k` se estiman con las coberturas pasadas de **todos** los activos juntos (por activo, 26 puntos son pocos). | Simple, explicable, no cambia el modelo; p50 y `probUp` no se mueven | Es un parche: no corrige la causa; hay que recalibrar periódicamente |
| b) Ajuste de colas en el motor | Mezclar los pesos del pool con un peso uniforme (`w = (1−ε)·e^-D + ε`) para subir el tamaño efectivo, o sortear parte de los shocks de la Student-t del GARCH | Ataca la causa | Cambia el modelo; más difícil de validar; L |
| c) Mapeo por PIT (cuantiles empíricos) | Usar la distribución histórica de la posición del cierre real dentro del pronóstico para reasignar los niveles | El más flexible | Necesita más cuantiles (p1, p2.5, p97.5, p99; caben en el `jsonb` sin cambio de esquema) y más datos |

**Implementación propuesta (opción a):**
- Los factores viven en `ENGINE_PARAMS.mcCalibration = { daily: { k50, k90, medidoEl }, two_day: …, weekly: …, monthly: … }` (bloque 2). Sin cambio de esquema.
- `montecarlo_engine.py` los aplica al guardar `quantiles` y conserva los cuantiles sin calibrar en `model_notes.raw_quantiles` para auditoría. `/api/escenarios` no cambia.
- `test_montecarlo_synthetic.py`: con `k = 1` las filas no cambian byte a byte; con `k > 1` p50 es idéntico y el ancho crece en la proporción exacta.

**Validación fuera de muestra con el mismo L3 (solo lectura):**
1. Ampliar L3: últimas ~500 sesiones, cada 5 sesiones, horizontes `daily`, `two_day`, `weekly` y `monthly` (sin traslape dentro de cada horizonte).
2. **Partición en el tiempo:** los `k` se estiman solo con fechas anteriores a un corte; la cobertura se mide después del corte con esos `k` fijos. Variante rodante: el `k` de cada fecha usa solo evaluaciones cuyo cierre real ya ocurrió.
3. **Criterio:** en el tramo de prueba, la cobertura conjunta queda dentro del margen de 50 % y 90 % en los cuatro horizontes, sin activos con desvío sistemático. Se reporta también el ancho medio de las bandas, para no "ganar" cobertura con bandas absurdamente anchas.
4. Recalibrar con el laboratorio cada mes, o cuando la cobertura se salga del margen.

**Tamaño:** M. L3 ampliado: S (~5 min de cómputo). Motor, configuración y pruebas: M.

**M.4 Textos de "Estándar" y "Amplio" (J1) (APROBADOS el 2026-10-12).** Dicen la cobertura medida fuera de muestra, no "9 de cada 10". **Cifras actualizadas con las bandas calibradas (M.6): 49 y 89 de cada 100**; antes de calibrar eran 47 y 85. Las cifras salen de la configuración, con la fecha de medición, y se actualizan cada vez que se vuelve a correr L3. Se usan las del horizonte diario, que son las más bajas.

| | es | en | zh |
|---|---|---|---|
| Estándar | "Estándar: banda central de los escenarios simulados. En nuestras pruebas con datos pasados, el cierre real cayó dentro de ella cerca de la mitad de las veces (49 de cada 100)." | "Standard: the central band of the simulated scenarios. In our tests on past data, the actual close fell inside it about half the time (49 out of 100)." | "标准：模拟情景的中间区间。在我们基于历史数据的测试中，实际收盘价约有一半的时间（每100次中49次）落在其中。" |
| Amplio | "Amplio: agrega la banda exterior. En nuestras pruebas con datos pasados, el cierre real cayó dentro de ella 89 de cada 100 veces." | "Wide: adds the outer band. In our tests on past data, the actual close fell inside it 89 times out of 100." | "宽：增加外侧区间。在我们基于历史数据的测试中，实际收盘价每100次中有89次落在其中。" |
| Aviso corto (`index.html:94`) | "Rango de escenarios: 'Estándar' muestra la banda central (el cierre real cayó dentro ~49 de cada 100 veces en nuestras pruebas); 'Amplio' agrega la exterior (~89 de cada 100)." | "Scenario range: 'Standard' shows the central band (the actual close fell inside ~49 out of 100 times in our tests); 'Wide' adds the outer band (~89 out of 100)." | "情景区间：“标准”显示中间区间（在我们的测试中，实际收盘价约每100次中49次落在其中）；“宽”增加外侧区间（约每100次中89次）。" |

**M.5 Validación del factor de calibración (2026-10-12, solo lectura, motor real, 9 720 evaluaciones)**

- **Datos y método:** el CSV de la sección 5. Fechas base del 2024-09-11 al 2026-10-02, cada 5 sesiones (cada 21 en `monthly`), cuatro horizontes, sin traslape dentro de cada horizonte. **Corte:** los `k` se estiman con las evaluaciones cuyo cierre real es anterior o igual al **2025-10-10** (4 920); la cobertura se mide en las evaluaciones con base posterior al corte (4 720). `k50` = mediana y `k90` = percentil 90 del factor que hace entrar el cierre real en la banda.
- Los márgenes suponen independencia entre activos; como en las mismas fechas se mueven juntos, el margen real es mayor.

**Cobertura total después del corte (factor global por horizonte):**

| Horizonte | n | k50 | k90 | p25-p75 sin | p25-p75 con | p5-p95 sin | p5-p95 con | Margen 50 / 90 |
|---|---|---|---|---|---|---|---|---|
| Día | 1 470 | 1.042 | 1.075 | 46.9 % | **48.9 %** | 86.3 % | **88.7 %** | ±2.6 / ±1.5 |
| 2 sesiones | 1 470 | 1.045 | 1.080 | 45.2 % | **46.8 %** | 86.9 % | **89.5 %** | ±2.6 / ±1.5 |
| Semana | 1 450 | 1.050 | 1.076 | 47.4 % | **49.3 %** | 86.3 % | **89.0 %** | ±2.6 / ±1.5 |
| Mes | 330 | 0.996 | 1.073 | 49.1 % | **48.8 %** | 87.6 % | **89.4 %** | ±5.4 / ±3.2 |

Con el factor, 7 de 8 coberturas quedan dentro del margen. La única fuera es p25-p75 a 2 sesiones (46.8 % contra un mínimo de 47.4 %). Las bandas se ensanchan solo **4-8 %**: la mediana y `probUp` no cambian.

**Por tipo de activo (después del corte):**

| Horizonte | Tipo | n | p5-p95 sin | Factor global (p25-p75 / p5-p95) | k por tipo (k50 / k90) | Factor por tipo (p25-p75 / p5-p95) | Ancho p5-p95 sin → con global |
|---|---|---|---|---|---|---|---|
| Día | Acciones | 980 | 86.5 % | 47.4 % / 88.6 % | 1.122 / 1.145 | **50.5 % / 89.7 %** | 6.2 % → 6.7 % |
| Día | Futuros | 490 | 85.7 % | **51.8 % / 89.0 %** | 0.992 / 1.011 | 49.4 % / 86.3 % | 7.7 % → 8.2 % |
| 2 sesiones | Acciones | 980 | 84.9 % | 44.7 % / 87.7 % | 1.072 / 1.092 | 45.4 % / 87.9 % | 9.0 % → 9.7 % |
| 2 sesiones | Futuros | 490 | 91.0 % | 51.0 % / 93.3 % | 1.027 / 1.054 | 51.0 % / 92.7 % | 10.9 % → 11.8 % |
| Semana | Acciones | 960 | 87.0 % | 49.1 % / 88.9 % | 1.107 / 1.077 | 51.6 % / 88.9 % | 14.6 % → 15.7 % |
| Semana | Futuros | 490 | 85.1 % | 49.8 % / 89.2 % | 0.963 / 1.067 | 46.5 % / 88.8 % | 17.4 % → 18.8 % |
| Mes | Acciones | 220 | 90.0 % | 51.4 % / 92.3 % | 1.031 / 1.117 | 52.7 % / 93.2 % | 30.7 % → 32.9 % |
| Mes | Futuros | 110 | 82.7 % | 43.6 % / 83.6 % | 0.941 / 0.901 | 41.8 % / 80.0 % | 35.6 % → 38.2 % |

**Lectura:**
- Las acciones necesitan algo más de ensanche que los futuros, pero la diferencia es **moderada**. El factor por tipo **no mejora de forma consistente fuera de muestra**: ayuda a las acciones (día: 89.7 % contra 88.6 %) y empeora a los futuros (día: 86.3 % contra 89.0 %; mes: 80.0 % contra 83.6 %). Con la mitad de los datos por tipo, el factor se ajusta al ruido del periodo de estimación.
- Los futuros a 1 mes quedan bajos con cualquier factor (n = 110, margen ±5.6). Puede influir la serie de futuros guardada (punto C: velas provisionales y cambios de contrato).
- **Recomendación:** factor **global por horizonte** (tabla de arriba). **No** un factor por tipo por ahora; volver a evaluarlo cuando haya más datos y después del punto C (futuros). Al implementarlo, las cifras del texto (M.4) se vuelven a medir con L3 sobre los cuantiles ya calibrados.
- **Decisión (2026-10-12):** factor **global por horizonte**, sin factor por tipo. Se reevalúa después del punto C (futuros) y con más datos.

**M.6 Implementación (2026-10-12, en la rama, sin commit; no se corrió el workflow ni se escribió en Supabase)**

- **Configuración:** `functions/_shared/engine-params.json` (nuevo; desde M.7 incluye `k80` explícito por horizonte). Es JSON para que lo lean el motor en Python y, en el bloque 2, `tier-config.js`. Contiene:
  - `mcCalibration`: `measuredAt` = 2026-10-12, método y `k50`/`k90` por horizonte, estimados con **todas** las evaluaciones (9 720), para incluir el periodo más reciente.
  - `coverageText`: las cifras de los textos de "Estándar" y "Amplio" (M.4) con su fecha y su método.
- **Factores de producción** (todas las evaluaciones) y, para comparar, los estimados antes del corte (M.5):

| Horizonte | k50 / k90 (producción) | k50 / k90 (antes del corte) |
|---|---|---|
| Día | 1.054 / 1.123 | 1.042 / 1.075 |
| 2 sesiones | 1.089 / 1.088 | 1.045 / 1.080 |
| Semana | 1.056 / 1.102 | 1.050 / 1.076 |
| Mes | 1.008 / 1.091 | 0.996 / 1.073 |

- **Motor (`montecarlo_engine.py`):**
  - `load_mc_calibration()` lee el JSON al importar el módulo.
  - `calibrate_quantiles()` aplica `q' = q + (k − 1)·(q − p50)` (con k = 1 devuelve `q` exacto): `k50` para p25/p75, `k90` para p5/p95 y `k80 = k50 + 0.75·(k90 − k50)` para p10/p90. Garantiza el orden de los cuantiles y que ningún precio quede ≤ 0.
  - `run_montecarlo_for_symbol(..., calibration=None)`: usa el JSON; un dict explícito tiene prioridad (pruebas y laboratorio). Solo cambian los `quantiles` publicados; `probability_up`, VaR, CVaR y la semi-desviación siguen sin calibrar.
  - `model_notes.raw_quantiles` guarda los cuantiles originales y `model_notes.calibration` los factores, la fecha y la fuente (`engine-params.json`, `override` o `sin_configuracion`).
  - Sin el JSON, k = 1 y la cascada no falla. La línea del log agrega `calibracion=<fuente>`.
  - **Sin cambio de esquema:** `quantiles` y `model_notes` ya son `jsonb`. `/api/escenarios` no cambia: publica los cuantiles calibrados a partir de la primera corrida después del merge.
- **Pruebas (`test_montecarlo_synthetic.py`, sección 6): 29 de 29.**
  - 6a: el JSON se carga con los 4 horizontes y la fecha.
  - 6b: con k = 1, los cuantiles publicados son idénticos a los crudos.
  - 6c: con k50 = 1.2 y k90 = 1.5, p50 queda idéntico y las distancias se multiplican por 1.2, 1.425 y 1.5 exactos.
  - 6d: la calibración no toca `probability_up`, VaR, CVaR ni la semi-desviación.
  - 6e: sin override, el motor usa los factores del JSON.
  - 6f: sin configuración, k = 1 y no falla.
  - 6g: con factores extremos se conserva el orden y ningún precio queda ≤ 0.
- **Con k = 1, idéntico a `HEAD`:** 72 de 72 corridas reales (6 activos × 4 horizontes × 3 fechas) dan cuantiles, `probability_up` y VaR95 iguales bit a bit. La primera versión usaba `p50 + k·(q − p50)` y difería por redondeo en 28 de 72; se cambió a la forma equivalente exacta.
- **Cobertura con las bandas ya calibradas por el propio motor** (factores estimados antes del corte; 4 720 evaluaciones después del corte):

| Horizonte | n | Dentro de p25-p75 | Dentro de p5-p95 | Ancho medio p5-p95 |
|---|---|---|---|---|
| Día | 1 470 | **48.9 %** | **88.7 %** | 7.2 % |
| 2 sesiones | 1 470 | 46.8 % | 89.5 % | 10.4 % |
| Semana | 1 450 | 49.3 % | 89.0 % | 16.8 % |
| Mes | 330 | 48.8 % | 89.4 % | 34.7 % |

  Coincide exactamente con el cálculo de M.5. **Cifras de los textos** (`coverageText`, horizonte diario, medidas fuera de muestra): **Estándar 49 de cada 100; Amplio 89 de cada 100.** Los factores de producción (estimados con todos los datos) son algo mayores, así que la cobertura real esperada es igual o un poco más alta: las cifras publicadas son conservadoras.
- **Textos de M.4 con las cifras nuevas:**
  - es: "Estándar: … cerca de la mitad de las veces (49 de cada 100)." / "Amplio: … 89 de cada 100 veces."
  - en: "… about half the time (49 out of 100)." / "… 89 times out of 100."
  - zh: "…（每100次中49次）…" / "…每100次中有89次…"

  La interfaz los leerá de `coverageText` en el bloque 6 (F).
- **Factores de producción contra factores validados:** los de producción (estimados con todos los datos) son **mayores** que los validados (estimados antes del corte): en el día, k90 1.123 contra 1.075. Los textos usan las cifras **validadas** fuera de muestra (49 y 89 de cada 100), que por eso son **conservadoras**: con los factores de producción, la cobertura real esperada es igual o algo mayor.
- **Merge:** después del bloque 1. El bloque 1 va primero, tras verificar K con el log de hoy.

**M.7 Validación de p10-p90 (meta 80 %), pedida por el usuario, porque la tabla #47 muestra p10/p90 al público y k80 es interpolado**

Mismas 9 720 evaluaciones, regeneradas para guardar p10/p90 (los demás cuantiles salieron idénticos a la corrida anterior). Corte en 2025-10-10.

| Horizonte | n | Sin calibrar | k80 interpolado (antes del corte) | Con k80 interpolado | k80 estimado directo | Con k80 directo | Margen |
|---|---|---|---|---|---|---|---|
| Día | 1 470 | 76.3 % | 1.067 | **77.7 %** (fuera por 0.3) | 1.114 | **79.1 %** | ±2.0 |
| 2 sesiones | 1 470 | 75.6 % | 1.071 | 78.2 % | 1.087 | 78.8 % | ±2.0 |
| Semana | 1 450 | 75.7 % | 1.069 | 78.9 % | 1.071 | 78.9 % | ±2.1 |
| Mes | 330 | 75.5 % | 1.054 | 78.2 % | 1.048 | 77.9 % | ±4.3 |

- Con el k80 interpolado, 3 de 4 horizontes quedan dentro del margen; **el día queda 0.3 puntos por debajo**. Con k80 estimado directamente (percentil 80 del factor necesario), los 4 quedan dentro.
- Por tipo, con k80 interpolado: acciones 76.6-78.6 %, futuros 77.3-81.4 %. Es el mismo patrón que p5-p95: las acciones necesitan algo más.
- **Decidido e implementado (2026-10-12):** `k80` explícito por horizonte en `engine-params.json`; el motor lo usa si existe y, si no, interpola (`model_notes.calibration.k80_source` = `explicito` o `interpolado`). Prueba 6h: con `k80` explícito, p10/p90 usan ese factor; 30 de 30 pruebas sintéticas. Valores de producción (todos los datos): día 1.128 (hoy interpolado 1.106), 2 sesiones 1.110 (1.088), semana 1.091 (1.091), mes 1.074 (1.070). Cambio pequeño: motor, JSON y una prueba sintética (6h: con `k80` explícito, p10/p90 usan ese factor). `calibrate_quantiles` ya garantiza el orden aunque k80 > k90.

**M.8 ¿Se muestran VaR, CVaR o la semi-desviación? — No.**
- `functions/api/escenarios.js:26`, el único endpoint público de Monte Carlo, selecciona solo `horizon, probability_up, quantiles, base_close_date, computed_at`.
- `functions/api/montecarlo.js:21` devuelve la fila completa (`select=*`, con VaR, CVaR y semi-desviación), pero está protegido por `checkAdminAuth` (l. 12) y **ninguna pantalla lo llama**.
- `index.html`, `admin.html` y la homepage no muestran ninguno de los tres.
- Por eso no hace falta calibrarlos ni quitarlos ahora. Si algún día se muestran, deben calibrarse con `k90` (VaR95 sobre p5) o etiquetarse como "sin calibrar". Nota: con S1, hoy cualquiera con la contraseña demo podría leerlos vía `/api/montecarlo` (datos de mercado, no personales).
- **Verificación después del merge:** en el log de la corrida, 120 líneas `Monte Carlo (…)` con `calibracion=engine-params.json`. En Supabase, `model_notes->'calibration'->>'source'` = `engine-params.json` y `model_notes ? 'raw_quantiles'` en las 120 filas.

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

**Prueba del usuario en el Preview del bloque 1 (2026-10-13):** hoy Markowitz **le asigna peso a Bitcoin aunque no tiene historial**: 30 % con 2 activos y 1 % con 4. Es el hallazgo del punto D: un activo sin historial deja `minLength = 0`, la covarianza de todos queda en cero y los pesos salen de la sigma anual escrita a mano. Lo corrige el bloque 7 (mínima varianza; activos sin historial excluidos con aviso).

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
- **Datos usados (2026-10-12):** `asset_historical_prices_rows (1).csv` (Descargas del usuario; no se copia al repo): 23 251 filas, 30 símbolos con 774-778 filas cada uno, del 2023-09-08 al 2026-10-08 (acciones) o 2026-10-09 (futuros), sin cierres vacíos ni duplicados. `asset_news_scores`: 0 filas, sin CSV.
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
| ¿Guardamos historial de noticias? | **No, en la práctica.** El esquema lo prevé: `asset_news_scores` guardaría cada titular puntuado (`published_at`, `impact_score` de −10 a 10, resúmenes; único por `content_hash`), solo cuando alguien abre el Newsbox. Pero **la tabla está vacía en producción (0 filas al 2026-10-12, dato del usuario)**. Posible causa por revisar en la Fase 6a: el insert de `news.js` descarta cualquier error sin registrarlo (`.catch(() => {})`, sin revisar `response.ok`), y GDELT responde 429 con frecuencia (#118). Consecuencia: el "Ajuste noticia" de `patterns.js` hoy siempre vale 0. | `schema.sql:133-145, 222-223`; `news.js:26-57` |

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

### Resultados con datos reales (ronda 1, 2026-10-12)

- **Datos:** el CSV validado (sección 5, "Datos usados"); ~521 días de prueba por activo (oct-2024 a oct-2026). Solo lectura; 74 s. Los CSV de salida quedan fuera del repo.
- **Potencia:** un acierto solo se distingue del azar si se aleja más de 50 % ± 4.3 puntos.

**L0b. Matrices de transición (30 activos)**

| Prueba | Activos o filas que superan el margen (95 %) | Esperados por azar |
|---|---|---|
| 2 estados, orden 1: separación P(sube \| subió) − P(sube \| bajó) | 5 de 30: ASML −0.100, GC=F −0.081, HG=F −0.132, KO −0.074 (reversión) y JNJ +0.084 (inercia); margen ±0.07 | ~1.5 |
| 2 estados, orden 2: chi² "filas iguales" | 3 de 30 (ASML, HG=F, KC=F); por fila, 7 de 120 | ~1.5; ~6 |
| 2 estados, orden 3: chi² "filas iguales" | 8 de 30; por fila, 16 de 240 (filas con apenas 53 casos) | ~1.5; ~12 |
| 3 estados (terciles): separación alcista − bajista | 4 de 30 (HG=F −0.172, SI=F −0.110, ASML −0.095, JNJ +0.091); chi² 3 de 30 (HG=F p = 0.0003, SI=F, TSLA) | ~1.5 |

**L0c. Acierto fuera de muestra (promedio de 30 activos)**

| Modelo | Acierto | Brier | Mejora el Brier de la prob. simple | Lo empeora |
|---|---|---|---|---|
| "Siempre sube" | **52.2 %** | — | — | — |
| Probabilidad simple de alza | 51.9 % | 0.2500 | — | — |
| 2 estados, orden 1 | 51.9 % | 0.2503 | 1 (HG=F) | 3 |
| 2 estados, orden 2 | 51.3 % | 0.2512 | 0 | 9 |
| 2 estados, orden 3 | 51.8 % | 0.2531 | 0 | 7 |
| 3 estados (terciles) | 51.8 % | 0.2508 | 1 (HG=F) | 2 |

**L1. μ histórico contra μ = 0:** μ histórico mejora a 0 solo en 5 de 30 activos (AMD, GC=F, JNJ, JPM, TSM). Portafolio de 30 activos, rebalanceo cada 21 sesiones, 504 días:

| Estrategia | Volatilidad anual | Retorno anual | Sharpe |
|---|---|---|---|
| Mínima varianza | **9.2 %** | 20.8 % | **2.27** |
| μ histórico | 13.3 % | 27.1 % | 2.03 |
| Peso igual | 14.5 % | 31.7 % | 2.18 |

Los retornos son altos porque el periodo fue alcista; no son una expectativa.

**L2.** b1: mediana entre 0.211 y 0.235 en los 30 activos (atorado en la previa). Su error es apenas 0.1-1.6 % menor que el de la constante legacy y **19-38 % mayor** que el de la regla 1.18 × MAD (t entre −4.8 y −8.9 en los 30). Noticias: **no evaluable** (0 filas en `asset_news_scores`).

**L3.** Ver el punto M.1.

**Conclusiones:**
1. Ningún Markov, de 2 o de 3 estados y de orden 1 a 3, predice la dirección mejor que "siempre sube". Los órdenes altos empeoran (sobreajuste) y los "significativos" de L0b son poco más de lo que da el azar.
2. Los resultados respaldan J2 = b (mínima varianza) y la línea de la Fase 2: medir rangos, no predecir dirección.
3. **HG=F (cobre): candidato a vigilar con datos nuevos.** Es el único activo con reversión en L0b (orden 1 y 3 estados) que además mejora fuera de muestra (57.5 % contra 53.5 %). Con 30 activos, uno así puede salir por azar: **sin uso en el producto**; se vuelve a medir en cada ronda de L.
4. **b1 no se activa en Premium** hasta corregir la previa y superar a la regla 1.18 × MAD fuera de muestra.
5. Las bandas de Monte Carlo son algo angostas (punto M).

### L4. Volumen y día de la semana (ronda 2; solo lectura; corrido el 2026-10-12)

**Datos (verificado el 2026-10-12):** el CSV trae `volume` en las 30 series, sin vacíos. En las **20 acciones** es utilizable: ningún cero y medianas de millones. En los **10 futuros no**: 121 días con volumen 0, y medianas imposibles para el contrato activo (GC=F 443, SI=F 89, HG=F 724). Parece el volumen de un solo vencimiento de la serie continua de Yahoo, no el del contrato activo. Por eso H1 y H2 se evalúan **solo en las 20 acciones**; H3 en los 30 activos.

**Hipótesis fijadas de antemano** (no se agregan otras al ver los resultados):
- **H1. Alza tras día de volumen alto.** "Volumen alto" = volumen del día > 1.5 × mediana de las 20 sesiones previas (sin mirar el futuro). Dos estados: alto / normal. ¿P(sube mañana | alto) ≠ P(sube mañana | normal)?
- **H2. Dirección × volumen.** Cuatro estados: subió con volumen alto, subió normal, bajó con volumen alto, bajó normal. ¿Alguno difiere de la tasa base?
- **H3. Día de la semana.** Cinco estados (lunes a viernes, por la fecha de la sesión que se predice). ¿P(sube | día) difiere entre días?

**Método:** el mismo de L0b y L0c. Tablas por activo con casos por fila, margen de error al 95 % y chi²; acierto y Brier fuera de muestra con la ventana que avanza, contra "siempre sube" y contra la probabilidad simple. Como son 3 hipótesis, se reporta también el umbral corregido (p < 0.05 / 3 ≈ 0.017) y cuántos positivos se esperan por azar.

**Criterio:** una hipótesis solo se considera útil si mejora a "siempre sube" fuera de muestra en varios activos de forma consistente y supera el umbral corregido. Si no, se descarta.

**Tamaño:** S (se agregó a `lab_l.py`; mismo CSV). Prueba sintética: 17 de 17 autocomprobaciones (detecta un efecto de volumen y uno de lunes plantados, y no marca nada en el activo sin memoria).

**Cómo leer el acierto:** si un estado solo hace *más* probable la alza, el modelo predice "sube" igual que "siempre sube" y no le puede ganar en acierto; su aporte se vería en el Brier contra la probabilidad simple. Para ganarle en acierto, algún estado tendría que predecir "baja" y acertar.

**Resultados (umbral corregido p < 0.017; ~520 días de prueba por activo):**

| Hipótesis | Activos | Con estados distintos (p < 0.017) | Por azar | Acierto del modelo / "siempre sube" | Le gana a "siempre sube" | Brier: mejora / empeora (\|t\| > 2.39) |
|---|---|---|---|---|---|---|
| H1. Volumen alto | 20 acciones | **0** | ~0.3 | 51.7 % / 52.2 % | 3 de 20 | 0 / 0 |
| H2. Dirección × volumen | 20 acciones | **0** | ~0.3 | 51.4 % / 52.2 % | 4 de 20 | 0 / 1 |
| H3. Día de la semana | 30 activos | **0** | ~0.5 | 51.2 % / 52.2 % | 6 de 30 | 0 / 3 |

**Conjunto de activos (solo descriptivo, no es una prueba):**
- H1: P(sube) tras volumen alto 53.2 % (n = 1 863) contra 53.1 % tras volumen normal (n = 13 197).
- H2: tras bajar con volumen alto 54.7 %; tras subir con volumen alto 51.7 %; los dos estados normales, ~53 %.
- H3: lunes 54.6 %; martes a viernes, entre 51.2 % y 53.0 %. La diferencia del lunes no aparece en ningún activo por separado, y los 30 activos se mueven juntos en las mismas fechas, así que no se toma como efecto.

**Conclusión:** ni el volumen ni el día de la semana agregan nada a la dirección. Las tres hipótesis se **descartan**. Confirma la ronda 1: con estos datos, ninguna regla simple predice la dirección mejor que "siempre sube".

### Estado del laboratorio (2026-10-12): EN PAUSA hasta la Fase 6a

- **Rondas hechas:** ronda 1 (L0-L3), ronda 2 (L4) y validación de la calibración (M.5, M.6).
- **Resumen de L4:** ni el volumen (H1, H2; 20 acciones) ni el día de la semana (H3; 30 activos) agregan nada a la dirección. 0 activos con diferencias reales con el umbral corregido (p < 0.017), acierto del modelo (51.2-51.7 %) por debajo de "siempre sube" (52.2 %) y ningún Brier mejor. Las tres hipótesis se descartan.
- **Por qué se pausa:** las preguntas que quedan abiertas (L2-noticias: `NEWS_SENSITIVITY_FACTOR` y el ajuste de `patterns.js`) necesitan historial de noticias, y `asset_news_scores` está vacía (0 filas). Se reanuda cuando la Fase 6a guarde historial diario.
- **Antes de reanudar:** reevaluar el factor de calibración global contra uno por tipo después del punto C (futuros), y volver a medir HG=F con datos nuevos.

### Cómo se corre con datos reales (cuando el usuario entregue el CSV)

```
py lab_l.py --prices precios.csv [--news noticias.csv] --repo "<ruta del repo>" --out salida_real
```

El usuario comparte `informe.md` y los CSV de salida; no contienen secretos.

---

## 6. Bloques (un PR por bloque), en orden de prioridad para la beta

| # | Bloque | Puntos | Tamaño | Depende de | Parte de "Diseño por niveles" |
|---|---|---|---|---|---|
| **S** | **Seguridad (prioritario)** | S1, S2 | S-M | **Fusionado** (#7) y verificado en Producción; falta Access en Previews y repo privado | — |
| 1 | Lecturas seguras + verificación de K | I, K | M | **Listo para merge** en `lanzamiento-f3-bloque1` (`842622b` + merge de `main`, `36a3b9b`). K verificado en la corrida #36. Pruebas del usuario en el Preview OK. **Orden: S (hecho) → bloque 1 → M**, después de la prueba de push de Oro | Regla 4: `correlation.js` devuelve todas las correlaciones |
| L | Laboratorio (solo lectura) | L0, J2, N2, calibración | M | **Rondas 1 y 2 (L4) hechas** y validación de M (2026-10-12). **En pausa hasta la Fase 6a** (historial de noticias) | Regla 3: decide qué parámetros por nivel se activan |
| 2 | Configuración por niveles | 1.2, 1.3 | S-M | **En rama `lanzamiento-f3-niveles`** (2026-10-13). Opción (b): el radar sigue en 3 para todos hasta el bloque 8; `radarSize` solo queda en la configuración. Valores idénticos a los del código; prueba de equivalencia de `patterns.js` y `/api/market` 36/36 y 16/16 | Reglas 1 y 3: `TIER_LIMITS`, `ENGINE_PARAMS`, `/api/public-config`, sustituir la tabla 1.1; sin cambio visible para Free |
| 3 | Guardas en activos sin historial | B1, parte fija de D | S-M | — | — (el tope de alertas por nivel queda para la Fase 5, 1.5) |
| 4 | Textos y limpieza | E, H | S | **En rama `lanzamiento-f3-textos`** (2026-10-13): "mañana" → "la próxima sesión" en el subtítulo del radar, el tour y la homepage es/en/zh; `#recalculate` y su manejador retirados. El nombre "Radar" y su subtítulo nuevo esperan al bloque 8. J3, H | Regla 1: textos con `radarSize` y `portfolioAssets` interpolados |
| 5 | Patrones binarios | G | S-M | — | Reglas 1 y 3: `patternHorizons` y `patternWindows` desde la configuración |
| 6 | Sigma y postura de riesgo | A, F | M | — (J1 = b) | Regla 3: `newsSensitivity` |
| M | Calibración de Monte Carlo | M | M | **Implementado en la rama, sin commit (M.6)**; merge después del bloque 1. Factores en `functions/_shared/engine-params.json`. El texto de "Amplio" con la cobertura medida (M.4) va en el bloque 6 | Regla 3: factores `k50`/`k90` por horizonte en `ENGINE_PARAMS` |
| 7 | Markowitz (mínima varianza) | D | S-M (M con endpoint) | Bloque 1 (J2 = b) | Regla 2: cálculo para N activos en el servidor |
| 8 | Radar en el servidor (J3 = b) | J3 | M | Bloque 2; nombre de la sección | Reglas 2 y 4: `/api/radar` con ranking completo |
| 9 | Futuros: diagnóstico y corrección | C1, luego C2 | S + M | Aprobación C2 | — |
| 10 | Poblar los 4 activos + calendario cripto | B2 | L | Bloques 1 y 9 (C2), aprobación B2 | Nota: universo de activos en una sola lista (B2.5) |

Cada diff de producción se muestra antes de aplicarlo; `git add` por ruta; sin push, SQL ni workflow hasta que el usuario lo indique.

---

## QA. Herramientas de verificación (rama `lanzamiento-qa-tools`, 2026-10-16)

Reemplazan los videos de verificación por pruebas automáticas que corren en la computadora del usuario. No tocan Producción ni la cascada. `scripts/` no se publica: el middleware responde 404 (verificado con `verificar.sh`).

| Archivo | Qué hace |
|---|---|
| `scripts/verificar.sh` | Solo lectura con `curl`: 30 rutas del middleware (las 28 de S más `/scripts/*`), `/api/tier-config`, `/api/market/AAPL`, `/api/escenarios?symbol=AAPL` (con `baseCloseDate` igual al último cierre), `/api/winrate?all=1` sin clave y huellas de cada bloque fusionado. Tabla ✅/❌; código 1 si falla algo. |
| `scripts/qa_navegador.py` | Playwright (Chromium sin ventana). Invitado QA con estado guardado; AAPL, Bitcoin, contador y tope de Free, horizontes de patrones, radar, tour, homepage es/en/zh, red (sin `/api/correlation`, patrones una vez por activo) y errores de consola conocidos o nuevos. Superadmin opcional con `ALGO_ADMIN_KEY`. Capturas y `reporte.md` en `qa-salida/`. |
| `scripts/requirements-qa.txt` | `playwright==1.64.0` |
| `.gitignore` | `qa-salida/` y `.qa-estado/` |

**Instalación (una vez; fuera de OneDrive, en `%LOCALAPPDATA%lgo-qa`, ~843 MB con Chromium; se desinstala borrando esa carpeta):**
```bash
py -m venv "$LOCALAPPDATA/algo-qa/venv"
"$LOCALAPPDATA/algo-qa/venv/Scripts/python" -m pip install -r scripts/requirements-qa.txt
PLAYWRIGHT_BROWSERS_PATH=0 "$LOCALAPPDATA/algo-qa/venv/Scripts/python" -m playwright install chromium
```

**Uso (Git Bash, desde la raíz del repo):**
```bash
bash scripts/verificar.sh preview <rama> [--guardar]          # ~20-60 s
bash scripts/verificar.sh produccion [--guardar]
PY="$LOCALAPPDATA/algo-qa/venv/Scripts/python"
"$PY" scripts/qa_navegador.py --rama <rama>                    # Preview; ~1-2 min
"$PY" scripts/qa_navegador.py --produccion                     # solo lectura; ~20 s
"$PY" scripts/qa_navegador.py --rama <rama> --con-noticias     # deja pasar /api/news (solo Preview)
read -rs ALGO_ADMIN_KEY && export ALGO_ADMIN_KEY               # opcional: la clave no se ve al teclear
"$PY" scripts/qa_navegador.py --rama <rama> --superadmin
unset ALGO_ADMIN_KEY                                           # borra la clave de la terminal
```

**Uso en PowerShell** (la terminal de VS Code). `bash` no está en el PATH de PowerShell, así que `verificar.sh` se corre con el Bash de Git:
```powershell
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()             # para ver bien ✅/❌ y los acentos
& "C:\Program Files\Git\bin\bash.exe" scripts/verificar.sh produccion --guardar
& "C:\Program Files\Git\bin\bash.exe" scripts/verificar.sh preview <rama>
$PY = "$env:LOCALAPPDATA\algo-qa\venv\Scripts\python.exe"
& $PY scripts\qa_navegador.py --rama <rama>
& $PY scripts\qa_navegador.py --produccion
$clave = Read-Host -AsSecureString "Clave de superadmin"         # no se ve al teclear
$env:ALGO_ADMIN_KEY = (New-Object System.Net.NetworkCredential('', $clave)).Password
& $PY scripts\qa_navegador.py --rama <rama> --superadmin
Remove-Item Env:ALGO_ADMIN_KEY; Remove-Variable clave            # borra la clave de la sesión
```
La clave queda solo en la variable de entorno de esa ventana de PowerShell (no en el historial: `Read-Host` no se guarda en PSReadLine) y se borra con la última línea. Instalación equivalente en PowerShell:
```powershell
py -m venv "$env:LOCALAPPDATA\algo-qa\venv"
& "$env:LOCALAPPDATA\algo-qa\venv\Scripts\python.exe" -m pip install -r scripts\requirements-qa.txt
$env:PLAYWRIGHT_BROWSERS_PATH = "0"; & "$env:LOCALAPPDATA\algo-qa\venv\Scripts\python.exe" -m playwright install chromium
```

`.gitattributes` fija `*.sh text eol=lf`: con `core.autocrlf=true`, un checkout nuevo dejaría `verificar.sh` con CRLF y Bash fallaría (`$'\r': command not found`).

**Qué escribe en Supabase cada corrida** (el Preview usa la base de producción):

| Tabla | Preview, 1.ª corrida | Preview, siguientes | Producción (`--produccion`) |
|---|---|---|---|
| `privacy_consents` | 1 (correo QA) | 0 (estado en `.qa-estado/`) | 0 (POST simulado) |
| `asset_prediction_audit` | 1 (AAPL diario; BTC responde 422 y no escribe) | 1 | 0 (`/api/patterns` simulado) |
| `asset_pattern_snapshots` | hasta 2 upserts | hasta 2 | 0 |
| `page_views` | 0 (`track-view` simulado) | 0 | 0 |
| `asset_news_scores` | 0 (`/api/news` simulado; con `--con-noticias`, posible) | 0 | 0 |
| Superadmin | 0 extra (patrones respondidos con la captura del invitado) | 0 | 0 |

También se simula el `POST /cdn-cgi/rum` (Cloudflare Web Analytics), para que las corridas de QA no cuenten como visitas. Cualquier otra escritura (`POST`, `PATCH` o `DELETE` a `/api/*` o a Supabase) se aborta y se reporta como ❌.

**Clave de superadmin:** solo se lee de `ALGO_ADMIN_KEY`; nunca se imprime, nunca se guarda (el contexto del superadmin no guarda estado), no se graban trazas ni video, y si aparece en un error se reemplaza por «oculta».

**Prueba inicial (2026-10-16, por el agente):** `verificar.sh produccion` 43/43 en 22 s. `qa_navegador.py --produccion` 20 ✅, 0 ❌ y 2 omitidas (patrones, interceptados en Producción), en ~19 s. La primera versión marcaba ❌ el `POST /cdn-cgi/rum` de Cloudflare; ahora se simula.

## 7. Pendientes para fases posteriores

- **Al activar Premium — esperar `/api/tier-config` antes de validar el tope** (bloque 2, 2026-10-13): mientras la configuración no llega (o si falla), el navegador usa los límites de Free. Un Premium con más de 5 activos ve "N/5 activos" y **no puede agregar** hasta que llega la respuesta (cacheada 5 min). Hoy no afecta a nadie real (todo es Free; solo pruebas gratuitas y modo admin). Antes de activar Premium: esperar la configuración antes de validar el tope en `addPortfolioAsset` (o reintentar al validar) y no mostrar el contador hasta tenerla.
- **Bloque 2 — refrescar el contador al cambiar de nivel:** `setDevTier` y `startTrial` llaman a `applyTierGating`, que actualiza horizontes e historial pero no el contador "N/límite" del portafolio; se actualiza en el siguiente `renderPortfolio` (al seleccionar o agregar un activo). Ya era así antes del bloque 2. **Resuelto el 2026-10-13** en `lanzamiento-f3-niveles`: `applyTierGating` actualiza el contador.

- **Fase 4 — llamadas repetidas a activos sin historial** (visto en el Preview el 2026-10-13; ya ocurre en `main`, no es una regresión). Al seleccionar Bitcoin, cada selección hace 3 llamadas a `/api/market/BTC-USD` (404) y 2 a `/api/escenarios?symbol=BTC-USD` (404): `renderPortfolio` → `renderPortfolioChart`, `loadPatterns` → `loadShadowCorrelation` → `renderPortfolioChart` y `obtenerHistoricoActivo`. A eso se suman la de `syncAssetDataWithSupabase` al arrancar y las de Markowitz con BTC en el portafolio (el usuario vio 8-10). Además `/api/patterns` responde 422 en cada selección. Propuesta:
  - guardar en caché por sesión los "sin historial" (404/422);
  - no pedir `/api/escenarios` ni `/api/patterns` para activos sin historial;
  - que `renderPortfolioChart` reutilice el historial ya descargado en vez de pedirlo en cada redibujado.
- **Fase 4 — caché de `/api/patterns` por pestaña:** `sessionStorage`, 60 min. Para ver la llamada en Network hay que usar una pestaña nueva o borrar `algo_patterns_*`.

- **Fase 5 — Monitoreo de cobertura de Monte Carlo:** `asset_montecarlo_simulation` sobrescribe la fila de cada activo y horizonte cada noche, así que no hay historial para medir si las bandas siguen calibradas.
  - **Propuesta (requiere aprobación de esquema):** tabla nueva `asset_montecarlo_history`: `symbol`, `horizon`, `base_close_date`, `quantiles` (calibrados), `raw_quantiles`, `probability_up`, `calibration` (k y fecha de medición), `computed_at`. PK `(symbol, horizon, base_close_date)`; RLS activado sin políticas (solo `service_role`). La cascada agrega un upsert por fila además del actual. Son ~120 filas por día hábil, ~31 000 al año.
  - **Chequeo mensual (solo lectura):** cruzar el historial con `asset_historical_prices` (cierre `steps` sesiones después de `base_close_date`) y medir la cobertura de p25-p75, p10-p90 y p5-p95 por horizonte en los últimos 3 meses. Si alguna se sale del margen, recalibrar con el laboratorio (L3/M) y actualizar `engine-params.json` y las cifras de los textos.
  - **Alternativa sin esquema:** correr cada mes el laboratorio sobre un CSV exportado, como en M.5. Es más manual y depende de que el motor sea reproducible (hoy lo es: la semilla depende de símbolo, horizonte y fecha).
- **Fase 5 — validar el nivel en el servidor** (1.5): hoy todo límite por nivel se controla solo en el navegador; Premium lo requerirá en el servidor.
- **Fase 5 — Supabase: "Automatically expose new tables" está activado.** Supabase recomienda desactivarlo: con esa opción, toda tabla nueva queda expuesta por la API desde que se crea. Revisarlo junto con las RLS de las 20 tablas.
- **Bloque 2 — correlaciones por nivel:** hoy la interfaz muestra como máximo **una** correlación (la primera confirmada por volumen, `renderShadowEngine`), igual para todos los niveles, y solo dentro del motor sombra oculto. No hay regla por nivel. Si vuelve en la Fase 5, el número debe salir de `TIER_LIMITS` (p. ej. `correlationSuggestions`).
- **b1 (`sensitivity-factor.js:58`):** la previa domina el ajuste (sección 5, L0a y resultados). **No se activa en Premium hasta corregir la previa y superar a la regla 1.18 × MAD fuera de muestra** en el laboratorio.
- **HG=F (cobre):** candidato a vigilar con datos nuevos en cada ronda de L; sin uso en el producto.
- **Fase 5 — `NEWS_SENSITIVITY_FACTOR`:** el resultado de `applyNewsWeighting` (`index.html:679`) no se usa; decidir si se borra o se conecta según L2.
- **Fase 6a — historial diario de noticias (requisito):** `asset_news_scores` está vacía en producción, así que las preguntas del laboratorio que dependen de noticias (L2-noticias: `NEWS_SENSITIVITY_FACTOR` y el ajuste de `patterns.js`) **no se pueden evaluar**. La descarga nocturna de noticias debe guardar historial diario por activo, independiente de que alguien abra el Newsbox. Además, **`news.js` descarta los errores al guardar**: el insert en `asset_news_scores` termina en `.catch(() => {})` y no revisa `response.ok` (`functions/api/news.js:50-55`). Una falla de guardado no deja rastro; debe registrarse. Ningún ajuste por noticias se activa hasta tener ese historial y evaluarlo en L.
- **Límites de Elite (E1):** el agente los propone según el diseño de las pantallas; mientras tanto, la interfaz usa el tope visual `UI_CAPS`.
- **Laboratorio L:** comparativa b1 contra `NEWS_SENSITIVITY_FACTOR` y validación del μ histórico antes de activar cualquier parámetro "más sensible" en Premium.
- **Fase 5 — `asset_prediction_audit`** crece en cada consulta de patrones (ya anotado en fase-2-plan, sección 9); se agrava mientras `loadShadowCorrelation` siga activo (punto I).
- **Diseño de Premium — Monte Carlo por nivel:** requiere columna `tier` o tabla nueva en `asset_montecarlo_simulation` (cambio de esquema, 1.3).
- **Universo de activos en una sola lista** (B2.5).
- **Fase 8:** `alt` y captura de `homepage/assets/prob tomorrow.png` (E). El `alt` ("Escenario de referencia para mañana", `homepage/index.html:292`) se queda hasta regenerar la imagen.
- **Fase 8 — revisión nativa del chino:** los textos de `homepage/locales/zh.json` (incluido "下一交易日预计波动幅度最大的三项资产。" del bloque 4) los revisa un hablante nativo antes del lanzamiento.
