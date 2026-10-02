# Fase 1 — Auditoría de textos (paso 1.3)

- **Rama:** `lanzamiento-f1-textos` (desde `main` @ `1a36a4f`, tag `pre-launch-v0`)
- **Fecha:** 2026-10-01
- **Alcance:** solo lectura. Este documento no modifica ningún archivo de producción.
- **Criterios aplicados:** (1) nada promete lo que el código no hace hoy; (2) nada suena a recomendación; (3) lenguaje político neutral ("escenario de continuidad / de cambio"); (4) texto entendible sin saber finanzas.

## Prioridades

| Prioridad | Significado |
|---|---|
| **P0** | Bloquea el lanzamiento: promesa falsa respecto al código, recomendación de inversión o lenguaje político. |
| **P1** | Corregir antes del lanzamiento si es posible: jerga técnica o interna visible, inconsistencias o errores de traducción. |
| **P2** | Cosmético o de baja exposición (inglés suelto, paneles bloqueados, solo admin). |

Si en la columna *problema* aparece **[lógica]**, el texto propuesto no basta: el código hace algo distinto de lo que dice el texto y habrá que decidir si se cambia el texto, el código o ambos.

## Resumen

- **82 hallazgos:** 33 P0, 34 P1 y 15 P2.
- **Hallazgos que bloquean el lanzamiento:**
  1. **Top picks** ("Mejores oportunidades", "Top Portfolio", "mejores activos para invertir hoy"). Ordena por **volatilidad** (`sigma × 0.21`), no por retorno, y siempre marca "Alcista" (#1–#5, #67–#68, #72).
  2. **"Más probable mañana / Probabilidad 24.1 %".** El precio de mañana siempre sale por encima del actual (`precio × (1 + sigma × paso)`), y la "probabilidad" es una constante fija (`24.1 / (1 + 2σ)`), no sale de ningún modelo (#8, #9, #48).
  3. **Panel "Estado de mercado".** Muestra números fijos en el HTML: `$4,610.69` y `24.1 %` (#19).
  4. **Debate de noticias.** Usa etiquetas "IA conservadora / IA liberal". Además, la terminal y la homepage dicen que el debate ajusta la probabilidad, pero el propio código muestra "todavía no ajusta la probabilidad mostrada arriba" (#23–#28, #31, #69, #70).
  5. **Promesas sin respaldo en el código:**
     - "Tiempo real": el mapa es fijo por activo y los precios son cierres diarios.
     - "Simulamos miles de futuros": en el navegador no corre ninguna simulación de Monte Carlo.
     - "Notificación al instante": el push se envía una vez al día (22:00 UTC, de lunes a viernes).
     - Hedge Strategies aparece en el plan Free, pero está bloqueado como "Coming soon".
  6. **Aviso de privacidad (es/en/zh):**
     - Dice "cifrado de grado militar / military-grade / 军工级".
     - Dice "extremo a extremo" (HTTPS no es cifrado de extremo a extremo).
     - No incluye un aviso explícito de que la plataforma **no es asesoría de inversión**.
- **Traducciones de la homepage:** `es.json`, `en.json` y `zh.json` tienen exactamente las mismas 57 claves (ninguna falta ni sobra). Los problemas están en el **contenido**, que repite en los 3 idiomas las mismas promesas.
- **No existen:** `manifest.json`, etiquetas `og:*` ni `twitter:*` en ninguna de las dos páginas (#78).
- **`NEWS_API_KEY`:** **no está expuesta** (ver la sección final).

## Metodología

1. Busqué, sin distinguir mayúsculas, los términos indicados en es/en/zh:
   - **Lista base:** recomendad, recommend, mejor, best, invertir hoy, invest today, óptim, optim, oportunidades, opportunit, tiempo real, real-time, real time, send the order, en un solo paso, one step, dentro del cálculo, grado militar, military, neutraliz, conservador, conservative, liberal, simulamos miles, thousands, doble clic, double click, Supabase, caché local, cache, localStorage, Markov, Win Rate, modo sombra, shadow, `asset_`, `_prices`, `.close`, `profiles`, `privacy_consents`.
   - **Equivalentes en chino:** 推荐, 最佳, 最优, 实时, 保守, 自由, 优化, 机会, 军工, 一步, 马尔可夫, 胜率, 影子, 缓存.
   - **Términos adicionales:** garantiz, compart/share, WhatsApp, sin riesgo.
2. **Archivos revisados:**
   - `index.html`: HTML, `<title>`, `meta`, tooltips, `aria-label`, `placeholder`, textos generados por JS, tour de bienvenida, botón Share y aviso de privacidad en 3 idiomas.
   - `homepage/index.html` y `homepage/locales/{es,en,zh}.json`.
   - `admin.html`.
   - `functions/**/*.js`, `sw.js`, `supabase-config.js` y `README.md`.
   - `actualizar_automatico.py`: textos de las notificaciones push.
   - `.github/workflows/daily_update.yml`: horario real de las alertas.
3. **Coincidencias descartadas:** las que solo aparecen en identificadores o comentarios de código (por ejemplo `supabaseClient`, `localStorage.getItem`, `shadowState`, `readCache`). No son visibles para el usuario.
4. **Contraste con el código:** cada texto que describe una funcionalidad lo comparé con lo que el código hace realmente (fórmulas, gating por plan y horario del cron).
5. **Lo que no revisé:**
   - Los textos dentro de las imágenes de `homepage/assets/*.png`, que requieren revisión visual (#81).
   - Los resúmenes que genera el LLM en tiempo de ejecución; sí revisé el prompt que los produce (#27).

> Los números de línea corresponden a `1a36a4f`. En `index.html` muchas líneas son muy largas; cuando ayuda, se cita la función o el `id`.

---

## A. Terminal (`index.html`): Top picks y botón Share

| # | Texto actual | Archivo y línea | Idioma | Problema | Texto propuesto | Prioridad | Decisión |
|---|---|---|---|---|---|---|---|
| 1 | "Top picks" / "Mejores oportunidades por TH ALGORITHM" | index.html:85 | ES/EN | Suena a recomendación. **[lógica]** El ranking (`renderTopPicks`, l. 313) ordena por `effectiveSigma × 0.21`, es decir, por **volatilidad**, no por oportunidad. | Eyebrow: "Radar de volatilidad". Título: "Activos con mayor rango de movimiento estimado" | P0 | |
| 2 | "Ranking por retorno esperado a 1 día; comparte la señal con un clic." | index.html:85 | ES | Falso: no es retorno esperado, es volatilidad. "Señal" suena a señal de trading. | "Ordenados por cuánto podrían moverse mañana (volatilidad estimada). No es una recomendación de compra ni de venta." | P0 | |
| 3 | Columnas "Tendencia Markov (1D)" y "Proyección óptima" | index.html:85 | ES | Este cálculo no usa Markov. "Óptima" suena a recomendación. | "Movimiento estimado (1 día)" y "Precio de referencia" | P0 | |
| 4 | "Alcista (x.x%)" en cada fila | index.html:313 (`renderTopPicks`) | ES | **[lógica]** `expectedReturn` siempre es ≥ 0, así que **siempre** muestra "Alcista". | "± x.x %" (rango posible, sin dirección) | P0 | |
| 5 | Mensaje de WhatsApp: "🚨 \*Alerta Algorithm\* 🚨 Se detecta movimiento óptimo: … 📈 \*Tendencia Markov:\* … 🎯 \*Proyección:\* … \_Monitoreado vía caché segura y motor híbrido.\_" | index.html:312 (`enviarAlertaWhatsApp`) | ES | Formato de "alerta de trading" (🚨, "movimiento óptimo"). Jerga interna ("caché segura", "motor híbrido"). No incluye enlace ni aviso. | "📊 The Algorithm · {activo}: podría moverse ± x.x % mañana (precio de referencia {precio}). Es un cálculo estadístico, no una recomendación de inversión. thalgorithm.com" | P0 | |
| 6 | Mismo mensaje de WhatsApp (bug) | index.html:312 | — | **[lógica]** El texto no pasa por `encodeURIComponent`. En "S&P 500", "JPMorgan Chase & Co.", "Johnson & Johnson" y "The Procter & Gamble Company", el `&` corta el mensaje. | Usar `encodeURIComponent(mensaje)` (es un arreglo rápido) | P1 | |
| 7 | Botón "Share" | index.html:313 | EN | Texto en inglés en una interfaz en español. | "Compartir" | P2 | |

## B. Terminal: portafolio, proyección y datos

| # | Texto actual | Archivo y línea | Idioma | Problema | Texto propuesto | Prioridad | Decisión |
|---|---|---|---|---|---|---|---|
| 8 | "MÁS PROBABLE MAÑANA" / "MÁS PROBABLE PASADO MAÑANA" | index.html:86 | ES | **[lógica]** `renderActiveAssetCards` (l. 320) calcula `precio × (1 + sigma × paso)`, que siempre queda por encima del precio actual. No sale de ninguna distribución. | "ESCENARIO DE REFERENCIA · MAÑANA" / "· PASADO MAÑANA" | P0 | |
| 9 | "Probabilidad 24.1 %" / "Probabilidad 18.5 %" | index.html:86 y l. 320 | ES | **[lógica]** Es una constante fija (`prob1 / (1 + 2σ)`, l. 314), no una probabilidad calculada. | Quitar la cifra o poner "Estimación ilustrativa (no es una probabilidad calibrada)" | P0 | |
| 10 | "Histórico, camino probable y abanico Markov/Monte Carlo desde Hoy. Doble clic en la gráfica para proponer una alerta." | index.html:86 | ES | En el navegador no corre Markov ni Monte Carlo (es una fórmula con sigma). "Doble clic" no funciona en móvil. Jerga. | "Precio histórico y rango estimado para los próximos días. Toca dos veces (o haz doble clic) en la gráfica para fijar una meta de precio." | P1 | |
| 11 | "No hay metas activas. Puedes fijarlas con doble clic en la gráfica del portafolio." | index.html:257 | ES | Instrucción solo para escritorio. | "No hay metas activas. Toca dos veces (o haz doble clic) en la gráfica para fijar una." | P2 | |
| 12 | Leyenda de la gráfica: "Serie de cierres reales asset_historical_prices.close." | index.html:327 (`afterLabel`) | ES | Expone el nombre de una tabla interna. | "Precios de cierre diarios reales." | P1 | |
| 13 | Leyenda de la gráfica: "Markov: Trayectoria central estimada…", "P10: Escenario conservador: percentil 10 de Monte Carlo.", "P90: Escenario optimista: percentil 90 de Monte Carlo." | index.html:327 | ES | P10/P90 no vienen de Monte Carlo (son `exp(±1.2816·σ)`). "Conservador" se confunde con el debate político. | Etiquetas: "Escenario central", "Escenario bajo", "Escenario alto". Texto: "Estimación basada en la volatilidad del activo." | P1 | |
| 14 | "{activo} · x/y cierres close · Hoy y abanico Diario Markov/Monte Carlo." | index.html:327 (`portfolio-focus`) | ES/EN | Jerga técnica ("close", "abanico", "Markov/Monte Carlo"). | "{activo} · {x} días de historial · rango estimado {Diario}" | P2 | |
| 15 | "Sin cierres reales en Supabase para este activo." | index.html:327 | ES | Menciona un proveedor interno. | "Aún no hay historial de precios para este activo." | P1 | |
| 16 | `last-update`: "Supabase / caché local", "API en vivo / caché 60 min", "API en vivo (hoy)", "Supabase (asset_historical_prices.close)" | index.html:531 | ES | Jerga técnica y nombre de tabla visibles. | "Cierre del último día hábil" / "Precio de hoy (hasta 60 min de retraso)" | P1 | |
| 17 | Píldora `cache-status`: "MERCADO: CACHÉ EN VIVO", "MERCADO: SUPABASE", "MERCADO: API EN VIVO", "MERCADO: SIN CONEXIÓN" | index.html:531 | ES | Jerga técnica. | "DATOS: CIERRE DIARIO" / "DATOS: PRECIO DE HOY" / "DATOS: SIN CONEXIÓN" | P1 | |
| 18 | "MARKET ACTIVE" (siempre en verde) | index.html:80 | EN | Promesa: es un texto fijo que no depende del horario de mercado. | Quitarlo, o "Datos de cierre diario" | P1 | |
| 19 | Panel "Estado de mercado": "Activo de referencia $4,610.69", "Probabilidad principal 24.1 %" | index.html:104 | ES | **[lógica]** Valores **fijos en el HTML** que nunca se actualizan. | Quitar las dos métricas fijas o conectarlas a datos reales | P0 | |
| 20 | Textos fijos por activo (`tech`), p. ej. oro: "el escenario central contempla una subida moderada mañana y continuidad condicionada pasado mañana" | index.html:264 (`assetData`) | ES | Narrativa direccional escrita a mano que no depende de los datos del día. | Quitar las frases que indican dirección. Ej.: "El oro suele comportarse como activo defensivo; su rango estimado depende de la volatilidad reciente." | P1 | |
| 21 | "N cierres · asset_historical_prices.close" | index.html:729 | ES | Nombre de tabla visible. | "N cierres diarios" | P1 | |
| 22 | "N activos / caché local" | index.html:723 | ES | Jerga técnica. | "N activos" | P2 | |

## C. Terminal: noticias y debate (criterio político)

| # | Texto actual | Archivo y línea | Idioma | Problema | Texto propuesto | Prioridad | Decisión |
|---|---|---|---|---|---|---|---|
| 23 | "IA conservadora · x/10" / "IA liberal · x/10" / "Síntesis neutral · Impacto neto" | index.html:536 (`debateMarkupFromScores`) | ES | Etiquetas políticas. | "Escenario de continuidad · x/10" / "Escenario de cambio · x/10" / "Síntesis · impacto neto" | P0 | |
| 24 | "Marco conservador" / "Marco liberal" / "Conclusión neutral · Índice político/macro" | index.html:278 (`debateMarkup`) | ES | Etiquetas políticas (versión de respaldo en el navegador). | "Escenario de continuidad" / "Escenario de cambio" / "Síntesis · índice de impacto" | P0 | |
| 25 | Textos de respaldo: "Prioriza continuidad institucional…" / "Enfatiza los efectos distributivos, cooperación internacional…" / "…recomienda ampliar bandas…" | index.html:277 (`politicalDebate`) | ES | Contenido con carga ideológica y uso de "recomienda". | Continuidad: "Si las condiciones actuales se mantienen: …". Cambio: "Si el evento escala o cambia el entorno: …". Cierre: "…sugiere un rango más amplio de lo normal…" | P0 | |
| 26 | "Vista previa ilustrativa (todavía no ajusta la probabilidad mostrada arriba)" | index.html:536 | ES | Es correcto, pero **contradice** el tour (#31) y la homepage (#69). Sirve como evidencia del comportamiento actual. | Mantener la idea con lenguaje simple: "Ilustrativo: hoy esta noticia no cambia las cifras de arriba." | P1 | |
| 27 | Prompt del LLM: "…debate entre dos analistas macro: uno de sesgo liberal (progresista) y uno de sesgo conservador…"; campos `liberal_summary` y `conservative_summary` | functions/api/news.js:3 | ES | Si se cambian las etiquetas de la UI sin cambiar el prompt, los resúmenes seguirán con el marco político. Los campos de la API se pueden quedar en inglés. | "…dos escenarios: uno de **continuidad** (el entorno actual se mantiene) y uno de **cambio** (el evento altera el entorno)…" (las claves JSON no cambian) | P1 | |
| 28 | Resúmenes heurísticos: "Riesgo de continuidad y prima de riesgo elevada." / "Riesgo de disrupción y efectos macro amplios." / "Impacto negativo cautelar; ampliar bandas de incertidumbre." | functions/api/news.js:90-92 | ES | Jerga ("prima de riesgo", "bandas"). | "Si nada cambia, el riesgo se mantiene alto." / "Si el evento escala, el impacto podría ser amplio." / "Posible impacto negativo; el rango de precios podría ampliarse." | P1 | |
| 29 | "LIVE FEED" / "ACTIVE REGION" / "USA / ACTIVE REGION" | index.html:88, 279, 537 | EN | Inglés y promesa de "en vivo": las noticias se guardan 20 min en caché. | "NOTICIAS RECIENTES" / "REGIÓN" | P2 | |

## D. Terminal: tour de bienvenida

| # | Texto actual | Archivo y línea | Idioma | Problema | Texto propuesto | Prioridad | Decisión |
|---|---|---|---|---|---|---|---|
| 30 | "Este mapa te muestra en tiempo real dónde se está cocinando algo importante para tu activo…" | index.html:589 | ES | Falso: las regiones son fijas por activo (`regions` en `assetData`). El propio código dice "no … un flujo de noticias en vivo" (l. 264). | "Este mapa muestra las regiones del mundo que más suelen influir en tu activo. Rojo = alta influencia, amarillo = media, azul = baja." | P0 | |
| 31 | "Cada noticia relevante pasa por un debate real entre dos posturas: una más conservadora y otra más liberal… la usamos para ajustar la probabilidad de tu activo — sin sesgos, solo matemáticas." | index.html:590 | ES | Lenguaje político. Es falso que ajuste la probabilidad (ver #26). "Sin sesgos" es una promesa que no se puede comprobar. | "Cada noticia se analiza en dos escenarios: uno de continuidad y uno de cambio. Te mostramos ambos y una síntesis para que entiendas su posible impacto." | P0 | |
| 32 | "Con Markov y Monte Carlo simulamos miles de futuros posibles para tu activo. Juega con los periodos — 1 día, 1 semana, 1 mes y más…" | index.html:591 | ES | En el navegador no se simula nada (Monte Carlo solo corre en el servidor, en modo sombra y visible solo para admin). "Y más" es falso: los horizontes son diario, semanal y mensual. | "Aquí ves el historial del activo y un rango estimado de hacia dónde podría moverse. Cambia el horizonte (día, semana o mes) para comparar." | P0 | |
| 33 | "¿Quieres armar el mejor portafolio posible…? …la combinación de pesos que mejor balancea retorno y riesgo, calculada al segundo." | index.html:592 | ES | "El mejor portafolio" es una promesa y suena a recomendación. | "¿Tienes varios activos en la mira? Pulsa 'Optimizar' y verás cómo los repartiría la teoría de Markowitz, equilibrando rendimiento histórico y riesgo." | P1 | |
| 34 | "…el top 3 de activos con mejor proyección del día, listo para revisar o compartir con un clic." | index.html:593 | ES | Suena a recomendación y no corresponde a la lógica real (ver #1). | "Aquí verás los 3 activos con mayor rango de movimiento estimado para mañana. Es información, no una recomendación." | P0 | |
| 35 | "…te mandamos una notificación al instante — sin saturarte, solo cuando de verdad importa." | index.html:594 | ES | Falso: el push sale **una vez al día**, después del cierre (`cron '0 22 * * 1-5'`, daily_update.yml:5). | "Fija una meta de precio y te avisamos cuando tu activo se acerque o la alcance. Revisamos una vez al día, después del cierre del mercado." | P0 | |
| 36 | "…y las recomendaciones se adaptan a tu forma de invertir, no al revés." | index.html:595 | ES | "Recomendaciones". | "…y los rangos estimados se ajustan a cuánto riesgo quieres ver." | P0 | |
| 37 | Botón "Next" / "Saltar tour" | index.html:208 | EN/ES | Mezcla de idiomas. | "Siguiente" / "Saltar recorrido" | P2 | |

## E. Terminal: alertas, planes y otros paneles

| # | Texto actual | Archivo y línea | Idioma | Problema | Texto propuesto | Prioridad | Decisión |
|---|---|---|---|---|---|---|---|
| 38 | Interruptores "Top de noticias globales — Eventos relevantes del feed." y "Riesgo y semáforo — Cambios de fase de portafolio." | index.html:113 | ES | **[lógica]** Solo guardan la preferencia en el navegador (comentario en l. 353). El servidor solo envía alertas de **metas de precio**. | Ocultarlos o marcarlos como "Próximamente" | P0 | |
| 39 | "Recibe una notificación push cuando un activo con meta cambie de zona." | index.html:113 | ES | No dice con qué frecuencia. "Zona" es ambiguo. | "Te avisamos cuando un activo se acerque a tu meta de precio o la alcance. Revisamos una vez al día, después del cierre." | P1 | |
| 40 | Push: título "ALGORITHM · {símbolo}", cuerpo "Entró a zona roja (meta alcanzada). Precio: … · Meta: …" | actualizar_automatico.py:209-211, 252-253 | ES | "Zona roja" para una meta **alcanzada** (algo positivo) confunde. La fase `blue` se llama "zona verde". Solo existe en español. | Roja: "{símbolo} alcanzó tu meta: {precio} (meta {meta}). Dato al cierre." Amarilla: "{símbolo} está a menos de 3 % de tu meta." Verde: "{símbolo} se alejó de tu meta." | P1 | |
| 41 | Plan Free: "Acceso completo a los 30 activos, volumen al 100 %" | index.html:87 | ES | Hay **34** activos en el selector. "Volumen al 100 %" no se entiende. | "Acceso a todos los activos del selector" | P1 | |
| 42 | Plan Free: "Hedge Strategies, hasta 5 activos en portafolio y alertas push" | index.html:87 | ES/EN | **[lógica]** Hedge Strategies está bloqueado con "Coming soon" (`applyTierGating`, l. 432). | "Hasta 5 activos en tu portafolio y alertas de metas de precio" | P0 | |
| 43 | Plan Free: "Markov, Monte Carlo, patrones y Newsbox geopolítico sin restricciones" | index.html:87 | ES | Monte Carlo no está disponible para el usuario (ver #32). | "Rangos estimados, patrones históricos y noticias con análisis de escenarios" | P1 | |
| 44 | "Activación instantánea; conecta tu propio proveedor de pagos para procesar cada suscripción." | index.html:87 | ES | Es una nota para desarrolladores, visible para usuarios. | "Hoy todo es gratis. Los planes Premium y Elite llegarán pronto." | P0 | |
| 45 | "$0 /siempre" | index.html:87 | ES | Promesa a perpetuidad. | "$0" | P1 | |
| 46 | "Monte Carlo y el abanico percentil son funciones Premium." / "Ver planes y prueba gratis" | index.html:99 | ES | Contradice el plan Free. Hoy está oculto porque el panel no está bloqueado, pero sigue en el DOM. | Quitarlo o "Próximamente" | P2 | |
| 47 | "Probabilidades de modelos combinados" / "Markov de 1 día y cuantiles Monte Carlo derivados de z-score × sigma diaria del activo." | index.html:99 | ES | Jerga. No combina modelos: es la misma fórmula con sigma. | "Rango estimado para mañana" / "Escenarios bajo, central y alto calculados con la volatilidad del activo." | P1 | |
| 48 | Tabla: "Cadenas de Markov (1 día)", "x % confianza", "Monte Carlo P10 (conservador)", "P90 (optimista)", "Consistente con Markov 1D" | index.html:296 (`renderProbabilityTable`) | ES | **[lógica]** La "confianza" es la constante 24.1 / (1 + 2σ). Ni Markov ni Monte Carlo se ejecutan aquí. "Conservador" en otro sentido. | Filas: "Escenario central", "Escenario bajo (10 %)", "Escenario alto (90 %)". Quitar la columna "Confianza". | P0 | |
| 49 | "$1$ representa subida y $0$ bajada. La nota geopolítica ajusta la frecuencia empírica…" | index.html:100 | ES | Los `$…$` se ven literales (no se carga KaTeX ni MathJax). "Frecuencia empírica" es jerga. | "1 = día de subida, 0 = día de bajada. La noticia del día ajusta ligeramente la frecuencia histórica; no garantiza resultados." | P1 | |
| 50 | "Modo sombra · motor de señales v2" / "…no sustituye la probabilidad del portafolio hasta validar el Win Rate." | index.html:100 | ES | Texto **interno** visible para todos los usuarios ("modo sombra", "v2", "Win Rate"). | Ocultarlo para quien no es admin, o "Laboratorio (experimental): cálculo en evaluación que no cambia las cifras de arriba." | P1 | |
| 51 | "Correlación alta y confirmada por volumen con {X} (r=0.83) — camino alterno disponible…" / "Sin correlaciones ≥0.8…" | index.html:308 | ES | Jerga ("r=", "confirmada por volumen"). | "{X} suele moverse en la misma dirección que este activo; en la gráfica verás su camino alterno." | P2 | |
| 52 | "Postura de riesgo: los cálculos de volatilidad usan sigma base (conservador) salvo que abras la tolerancia manualmente." Botones "Conservador" / "Abierto" | index.html:83 | ES | Jerga ("sigma base"). "Conservador" se confunde con el debate político. Inconsistente con la homepage ("Agresivo", #75). | "Rango de escenarios: Estándar / Amplio. 'Amplio' muestra movimientos 35 % mayores." | P1 | |
| 53 | Toast: "Postura abierta: la volatilidad se amplifica 1.35× en los cálculos." / "Postura conservadora activa (sigma base)." | index.html:436 | ES | Igual que #52. | "Rango amplio activado." / "Rango estándar activado." | P2 | |
| 54 | "Pesos óptimos (Markowitz)" / toast "Portafolio optimizado con la Teoría de Markowitz." / title "Calcula pesos óptimos…" | index.html:86, 351 | ES | "Óptimo" sin matiz; suena a recomendación. | "Reparto calculado con Markowitz (con datos históricos)" / "Cálculo de Markowitz listo." | P1 | |
| 55 | "Configura Supabase antes de usar la autenticación." / "Configuración de Supabase" (error) | index.html:220, 216 | ES | Mensaje de desarrollo visible. | "El inicio de sesión no está disponible en este momento. Intenta más tarde." | P2 | |
| 56 | "Strike sugerido…" / "Activar contrato" | index.html:453, 102 | ES | "Sugerido" y "contrato" implican asesoría u operación real (los paneles están bloqueados con "Coming soon"). | "Strike de referencia" / "Simular cobertura" | P2 | |
| 57 | Eyebrows en inglés: "Private intelligence terminal", "Private workspace", "Daily briefing", "Top picks", "Market pulse", "Intelligence synthesis", "PREMIUM-ELITE VERSION COMING SOON", "Coming soon", "Homepage", "Upgrade" | index.html:62, 66, 76, 80, 83-104, 112 | EN | AGENTS.md pide la interfaz en español. | "Terminal de análisis", "Tu espacio", "Resumen del día", "Radar de volatilidad", "Pulso del mercado", "Lectura del activo", "Próximamente", "Inicio", "Mejorar plan" | P2 | |

## F. Aviso de privacidad (`index.html`, es/en/zh)

| # | Texto actual | Archivo y línea | Idioma | Problema | Texto propuesto | Prioridad | Decisión |
|---|---|---|---|---|---|---|---|
| 58 | "…se cifran extremo a extremo mediante el protocolo HTTPS apoyado en TLS 1.3, neutralizando ataques de interceptación…" | index.html:134 | ES | HTTPS **no** es cifrado de extremo a extremo. "Neutralizando" es absoluto. | "Las comunicaciones entre tu navegador y nuestros servidores viajan cifradas mediante HTTPS (TLS), lo que protege contra la interceptación." | P0 | |
| 59 | "End-to-end communication security … via HTTPS encrypted with TLS 1.3, preventing interception." | index.html:160 | EN | Igual que #58. | "Communications between your browser and our servers are encrypted via HTTPS (TLS), protecting them against interception." | P0 | |
| 60 | "…通过基于 TLS 1.3 加密的 HTTPS 通道进行端到端保护，防止拦截。" | index.html:186 | ZH | Igual que #58 (端到端 = de extremo a extremo). | "您的浏览器与我们服务器之间的通信通过 HTTPS（TLS）加密传输，以防止拦截。" | P0 | |
| 61 | "…cifrado de grado militar AES-256…" / "military-grade AES-256 encryption" / "军工级 AES-256 加密" | index.html:135, 161, 187 | ES/EN/ZH | Término de marketing, inadecuado en un texto legal. | "…cifrado AES-256 en reposo (proporcionado por Supabase)" / "AES-256 encryption at rest (provided by Supabase)" / "静态数据采用 AES-256 加密（由 Supabase 提供）" | P0 | |
| 62 | Sección 4: "…no garantiza de ninguna manera resultados… Las proyecciones tienen fines analíticos y de investigación." | index.html:139, 165, 191 | ES/EN/ZH | Falta decir explícitamente que **no es asesoría ni recomendación de inversión**. | Añadir: "La información de la plataforma es educativa e informativa y no constituye asesoría, recomendación ni oferta de inversión. Toda decisión es responsabilidad del usuario." (más su versión en EN y ZH) | P0 | |
| 63 | "Zero Financial Returns:" (título de la sección 4, EN) | index.html:165 | EN | Mal traducido: se lee como "la plataforma da cero ganancias". | "No Guarantee of Returns:" | P1 | |
| 64 | "零收益保证：" (título de la sección 4, ZH) | index.html:191 | ZH | Mal traducido: significa "garantía de cero ganancias". | "不保证收益：" | P1 | |
| 65 | "Web Application Safeguards (WAF)" | index.html:162 | EN | Error: WAF es *Web Application Firewall*. | "Web Application Firewall (WAF)" | P2 | |
| 66 | Transferencias con "Cláusulas Contractuales Tipo", consentimiento para "entrenar… modelos" y "cookies analíticas" | index.html:138, 145, 149 (y 164/171/175, 190/197/201) | ES/EN/ZH | Afirmaciones legales que no puedo verificar en el código: no hay pipeline de entrenamiento y lo que se usa es `localStorage`/`sessionStorage`, no cookies analíticas. | Revisión con asesor legal; mencionar "almacenamiento local del navegador" | P1 | |

## G. Homepage (`homepage/index.html` y `homepage/locales/*.json`)

La línea indicada es la misma en `es.json`, `en.json` y `zh.json`, porque los tres archivos tienen la misma estructura.

| # | Texto actual | Archivo y línea | Idioma | Problema | Texto propuesto | Prioridad | Decisión |
|---|---|---|---|---|---|---|---|
| 67 | "Top Portfolio — El top 3 de activos recomendados hoy, directo desde el motor analítico." / "Today's top 3 recommended assets…" / "今日推荐三大资产" | locales/*.json:43 | ES/EN/ZH | Recomendación explícita; además no corresponde a la lógica (#1). | "Radar de volatilidad: los 3 activos con mayor rango de movimiento estimado para mañana." / "Volatility radar: the 3 assets with the widest estimated move for tomorrow." / "波动雷达：明日预计波动幅度最大的三项资产。" | P0 | |
| 68 | block8: "…da el mejor top 3 de activos para invertir hoy" / "…the best top 3 assets to invest in today" / "…今日最值得投资的三大资产"; alt "Top Portfolio: mejores activos para invertir hoy" | locales/*.json:52; homepage/index.html:365-366 | ES/EN/ZH | Recomendación explícita ("invertir hoy"). | "…te muestra cada día los 3 activos que más podrían moverse. Información, no recomendación." (más EN y ZH) | P0 | |
| 69 | attr2: "Debates de IA conservadora y liberal que ponderan cada noticia dentro del cálculo de probabilidad" (EN "Conservative and liberal AI debates…", ZH "保守派与自由派 AI…") | locales/*.json:40 | ES/EN/ZH | Lenguaje político. Es falso que pondere el cálculo (#26). | "Cada noticia analizada en dos escenarios, de continuidad y de cambio, para entender su posible impacto." / "Every news item analyzed under two scenarios—continuity and change—to understand its possible impact." / "每条新闻从延续与变化两种情景分析，帮助你理解其潜在影响。" | P0 | |
| 70 | block6: "…un debate entre IA conservadores y liberales… la noticia se califica y pondera en los cálculos de probabilidad"; nodos "MARCO CONSERVADOR / MARCO LIBERAL / SÍNTESIS PONDERADA" (EN "CONSERVATIVE/LIBERAL FRAME", ZH "保守派框架/自由派框架"); aria-label "Debate entre IA conservadora y liberal" | locales/*.json:50; homepage/index.html:318, 340-345 | ES/EN/ZH | Igual que #69. | Nodos: "ESCENARIO DE CONTINUIDAD / ESCENARIO DE CAMBIO / SÍNTESIS" (EN "CONTINUITY / CHANGE / SYNTHESIS", ZH "延续情景 / 变化情景 / 综合") | P0 | |
| 71 | attr3: "Mapa de Correlaciones — Visualiza en tiempo real dónde en el mundo se mueven realmente tus activos." (EN "in real time", ZH "实时") | locales/*.json:41 | ES/EN/ZH | Falso: el mapa es temático y fijo por activo. "Correlaciones" no corresponde a lo que muestra el mapa. | "Mapa de influencia — Las regiones del mundo que más suelen influir en cada activo." (más EN y ZH) | P0 | |
| 72 | block4: "Realiza portafolios de inversión de los mejores activos… para invertir en un solo paso" (EN "best assets… single step", ZH "一步… 最优质资产") | locales/*.json:48 | ES/EN/ZH | Recomendación ("mejores activos") e invitación a invertir. | "Arma y compara portafolios con la teoría de Markowitz." (más EN y ZH) | P0 | |
| 73 | Modal "Qué es": "…flujos masivos de datos históricos y en tiempo real…", "…detectar oportunidades únicas…", "…respuestas inmediatas… listas para tu beneficio", "…el poder de la predicción financiera esté, por fin, de tu lado." | locales/*.json:29 | ES/EN/ZH | Los datos son cierres diarios (no hay tiempo real). "Oportunidades" y "predicción de tu lado" suenan a promesa de rendimiento. | Quitar "y en tiempo real", "oportunidades únicas" y la frase final. Proponer: "…para que entiendas mejor los escenarios posibles de tus activos." | P0 | |
| 74 | attr0: "Simulaciones tipo Markov y Monte Carlo para anticipar escenarios de precio con rigor científico" / attr1: "Portafolios óptimos calculados en segundos…" | locales/*.json:38-39 | ES/EN/ZH | Monte Carlo no se muestra al usuario. "Anticipar" y "óptimos" son promesas. | "Modelos estadísticos que estiman rangos de precio posibles." / "Calcula cómo repartir tu portafolio con la teoría de Markowitz." | P1 | |
| 75 | block7: "Conservador / Agresivo", "64 % Agresivo"; attr4: "sesgo conservador o abierto" | locales/*.json:42, 51 | ES/EN/ZH | Inconsistente con la terminal ("Conservador / Abierto") y se confunde con el debate político. | Alinear con #52: "Estándar / Amplio" | P2 | |
| 76 | block2: "Herramientas bancarias de primer nivel…" / "Acceso al mejor algoritmo matemático…"; misión: "banca inteligente" / "intelligent banking" / "智能银行"; meta description: "precisión de riesgo bancario" | locales/*.json:17, 46; homepage/index.html:7 | ES/EN/ZH | No es un banco. "El mejor algoritmo" es un superlativo que no se puede verificar. | "Herramientas de análisis cuantitativo, gratis" / "Matemáticas aplicadas al alcance de todos" | P1 | |
| 77 | block3: "Anticipa movimientos de los activos más populares…" / alt "Precio más probable para mañana" / alt "Gráfica de predicción de precios con bandas de Markov" | locales/*.json:47; homepage/index.html:291-292 | ES/EN/ZH | "Anticipa" y "más probable" son promesas (ver #8). | "Explora escenarios posibles para los activos más populares" / "Escenario de referencia para mañana" | P1 | |
| 78 | Valores: "…la rigor técnica…" | locales/es.json:25 | ES | Error de gramática. | "…el rigor técnico…" | P1 | |

## H. Metadatos, marca y otros

| # | Texto actual | Archivo y línea | Idioma | Problema | Texto propuesto | Prioridad | Decisión |
|---|---|---|---|---|---|---|---|
| 79 | `<title>ALGORITHM \| Intelligence Terminal</title>`, description "Algorithm, plataforma de inteligencia cuantitativa y geopolítica." / `<title>Thalgorithm \| In the name of Mankind</title>`; **sin** `og:*`, `twitter:*` ni `manifest.json` | index.html:6-7; homepage/index.html:6-7 | ES/EN | Marca inconsistente. Al compartir el enlace no aparece una vista previa con título, imagen y descripción. El título y la descripción de la homepage no cambian con el idioma. | Elegir un nombre canónico. Añadir `og:title`, `og:description`, `og:image`, `og:url`, `twitter:card`. Description: "The Algorithm: análisis cuantitativo gratuito para entender escenarios de mercado. No es asesoría de inversión." | P1 | |
| 80 | Marca escrita de 5 formas: "The Algorithm", "THALGORITHM", "Thalgorithm", "TH ALGORITHM", "ALGORITHM/Algorithm" | varios (index.html:65, 80, 85, 126; homepage/index.html:6, 211, 230, 237) | ES/EN/ZH | Inconsistencia de marca. | Decidir el nombre canónico (p. ej. "The Algorithm" para el producto y "thalgorithm.com" para el dominio) | P1 | |
| 81 | Capturas en `homepage/assets/*.png` ("prob tomorrow.png", "top portafolios.png", "grafica.png.png", etc.) | homepage/assets/ | — | Probablemente muestran "Más probable mañana", "Top Portfolio" o cifras de probabilidad. No se pueden revisar con grep. | Revisión visual y regenerar las capturas después de cambiar los textos | P1 | |
| 82 | Textos de solo administración: "Configura la política de lectura… en Supabase", "Sin datos suficientes en profiles todavía.", "…cierre real de Supabase (asset_historical_prices)", "MOTOR SOMBRA (v2)", filas demo "CarlosM_Trader / carlos.m@example.com"; errores de las Functions en inglés ("Pattern cache is unavailable.", "Not enough cached history.") | index.html:213, 509, 669-670; admin.html:122-124; functions/api/patterns.js:8, 35, 37 | ES/EN | Solo los ven los admins, o la UI los sustituye por un respaldo. Las filas demo pueden confundir. | Sin cambio para el lanzamiento. Quitar las filas demo del panel de admin. | P2 | |

> Nota de documentación (no es texto de la interfaz): `README.md:55` dice "GDELT se consulta desde el navegador", pero hoy la consulta pasa por `/api/news` en el servidor. Es P2 y se corrige solo en el README.

---

## Sección aparte: `NEWS_API_KEY`

**Conclusión: no está expuesta.** No hace falta detener la fase.

**Dónde aparece:**

| Ubicación | Qué hace |
|---|---|
| `functions/api/news.js:10-11` | Único uso real. Lee `context.env.NEWS_API_KEY` **en el servidor** (Cloudflare Pages Function) y la pone en la URL de `https://newsdata.io/api/1/latest` como `apikey`. Esa petición sale del edge de Cloudflare, no del navegador. |
| `functions/api/health.js:7` | Solo devuelve si la variable está configurada (`true`/`false`), nunca el valor. |
| `.dev.vars.example:5` | Plantilla vacía (`NEWS_API_KEY=`). |
| `README.md:84` | Documentación: el nombre de la variable, sin valor. |

**Si llega al navegador:**

| Canal | Resultado |
|---|---|
| **HTML/JS público** | No aparece en `index.html`, `admin.html`, `homepage/`, `sw.js` ni `supabase-config.js`. El navegador solo llama a `/api/news?q=…&symbol=…`. |
| **Respuesta de la Function `/api/news`** | Solo devuelve `{ articles: [...] }`, con los campos `title`, `url`, `domain`, `seendate` y las puntuaciones. No incluye la URL de la petición ni la clave. Si newsdata.io falla, devuelve `{ articles: [] }` con el status y sin reenviar el cuerpo del proveedor. En el `catch` tampoco se expone el error. |
| **`/api/public-config`** | Solo entrega `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `VAPID_PUBLIC_KEY`. |
| **Historial de git** | Revisé todas las ramas buscando valores con forma de clave de newsdata (`pub_…`) o asignaciones de `NEWS_API_KEY` con valor: **0 coincidencias**. |

**Observación menor, no es una exposición:** `/api/health` es público y revela qué secretos están configurados (también los de WhatsApp y META). No filtra valores, pero da información de la infraestructura. Conviene protegerlo con `checkAdminAuth` en una fase posterior.
