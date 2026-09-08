# HORIZON V2

Terminal web de inteligencia cuantitativa y geopolítica con autenticación de Supabase, perfiles de usuario y registro de niveles `normal`, `premium` y `elite`.

## Estructura

- `index.html` — aplicación estática completa, incluye el explorador de activos
- `supabase-config.js` — URL y clave pública del proyecto Supabase
- `schema.sql` — tablas, trigger de perfiles, políticas RLS, `asset_historical_prices` (fuente de verdad OHLCV poblada por GitHub Actions) y `asset_history` (caché heredada por intervalo)
- `logo_algorithm.svg` — isotipo geométrico de la plataforma
- `functions/_shared/asset-catalog.js` — catálogo curado de alias ("apple", "oro", "petróleo") a tickers oficiales
- `functions/api/assets/resolve.js` — resuelve texto libre a `TICKER (Nombre)` usando el catálogo curado
- `functions/api/market/[symbol].js` — lee históricos exclusivamente de `asset_historical_prices`; solo usa FMP para una cotización puntual de "hoy"
- `functions/api/assets.js` — proxy server-side que agrega el catálogo de símbolos de FMP (acciones, ETFs, índices, futuros/commodities, forex, cripto)

## Uso local

Abrir directamente en el navegador o servir con:

```bash
py -m http.server 8000
```

Luego entrar a:

```text
http://localhost:8000
```

## Configurar Supabase

1. Crea un proyecto en [Supabase](https://supabase.com/).
2. Abre **SQL Editor** y ejecuta `schema.sql`.
3. Copia la URL del proyecto y la clave `anon` en `supabase-config.js`.
4. En **Authentication > URL Configuration**, añade la URL local y la URL final de Cloudflare Pages.

La clave `anon` puede estar en el frontend. Nunca publiques una `service_role` key. El espacio normal permite una entrada rápida local con nombre y correo; las funciones premium/elite y el registro de usuarios requieren una sesión autenticada. Las políticas RLS protegen la tabla.

El panel de control consulta los perfiles de todos los usuarios autenticados porque se solicitó un único rol de cuenta. Si el panel debe ser privado para el propietario, habrá que añadir una autorización administrativa separada mediante Edge Function o una política basada en una lista de correos.

## Acceso administrativo demo

El backoffice está oculto. Abre el modal con `Ctrl + Shift + A` y utiliza el usuario bloqueado `gov` y la contraseña demo `mode`. Estas credenciales están escritas en el JavaScript del navegador y, por tanto, no protegen producción. Antes de usar datos reales, reemplaza este flujo por Supabase Auth con una columna de rol protegida por RLS y una Edge Function para las operaciones administrativas.

El catálogo y las proyecciones actuales son una base visual demostrativa. Para precios y noticias en vivo se debe conectar un proveedor de datos mediante una función de servidor; no se deben colocar claves privadas de APIs en Cloudflare Pages.

## Datos reales con FMP y GDELT

El frontend consulta precios mediante `/api/market/SYMBOL`. La función de Cloudflare Pages lee el secreto `FMP_API_KEY` y entrega los últimos 250 registros. Configura el secreto en el proyecto de Pages, no en GitHub:

```bash
npx wrangler pages secret put FMP_API_KEY --project-name <NOMBRE_DEL_PROYECTO>
```

GDELT se consulta desde el navegador porque su endpoint es público. Si no se configura FMP, el frontend conserva los datos demostrativos y no se rompe.

## Explorador de activos e histórico (fuente Supabase, sin descargas masivas)

La sección **Explorador de activos** de `index.html` consulta `/api/assets` para traer el catálogo de símbolos de FMP (acciones, ETFs, índices, futuros/commodities, forex y cripto) con la bolsa y el tipo de cada instrumento. Es solo un directorio de símbolos, se cachea 24h en `localStorage` y 12h en el borde, y no descarga precios.

`/api/assets/resolve?q=texto` traduce nombres comunes ("apple", "oro", "petróleo") a su ticker oficial usando el catálogo curado de `functions/_shared/asset-catalog.js`, mostrando el formato `TICKER (Nombre)` en selectores y buscadores.

**La fuente de verdad de precios históricos es la tabla `public.asset_historical_prices` de Supabase** (`symbol`, `asset_type`, `date`, `open`, `high`, `low`, `close`, `volume`), poblada una vez al día por un pipeline externo de GitHub Actions. Queda **prohibido** que las Cloudflare Functions hagan descargas masivas/históricas al proveedor de mercado; `/api/market/SYMBOL?interval=daily|weekly|yearly|monthly` lee siempre `asset_historical_prices` y agrega semanas/meses/años en el propio Function. La API externa (`FMP_API_KEY`) se reserva exclusivamente para una cotización puntual de "hoy" cuando el pipeline diario aún no corrió — nunca para historia completa.

Para operar el histórico, configura estos secretos de Cloudflare Pages y ejecuta `schema.sql` en Supabase:

```bash
npx wrangler pages secret put SUPABASE_URL --project-name <NOMBRE_DEL_PROYECTO>
npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name <NOMBRE_DEL_PROYECTO>
```

La `service_role` key nunca debe usarse en `supabase-config.js` ni en ningún archivo servido al navegador; solo vive como secreto de la función de Cloudflare Pages. Si `asset_historical_prices` aún no tiene filas para un símbolo (pipeline no ha corrido), `/api/market` responde 404 en vez de intentar poblarla con una descarga masiva.

## Despliegue en Cloudflare Pages

En Cloudflare Pages crea un proyecto conectado al repositorio de GitHub. Usa estos valores:

- **Framework preset:** None
- **Build command:** `npm run build`
- **Build output directory:** `/`

Después de publicar, registra el dominio de Pages en Supabase Authentication.

Configura estos secretos o variables de entorno en **Settings > Environment variables** de Cloudflare Pages: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEWS_API_KEY` y `FMP_API_KEY`. Las Functions bajo `functions/api/` los leen mediante `context.env`; el navegador recibe exclusivamente `SUPABASE_URL` y `SUPABASE_ANON_KEY` desde `/api/public-config`. Comprueba bindings sin revelar valores con `/api/health`.

Para desarrollo local, copia `.dev.vars.example` como `.dev.vars`, completa las variables y ejecuta `npm install` seguido de `npm run dev`. El archivo `.dev.vars` está ignorado por Git.

## WhatsApp Cloud API

Configura en Cloudflare Pages los secretos `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`, `WHATSAPP_TEST_RECIPIENT` y `WHATSAPP_TEST_TRIGGER_TOKEN`. En Meta configura el webhook como `https://algorithm-global-engine.pages.dev/api/whatsapp/webhook` y suscribe el campo `messages`. La Function valida la firma de Meta, busca `clients.phone` en formato E.164 sin `+`, evita duplicados por `meta_message_id` y registra eventos en `whatsapp_events`.

Para enviar una prueba al destinatario sandbox configurado, ejecuta una petición `POST` a `/api/whatsapp/test` con el encabezado `X-WhatsApp-Test-Token`. Nunca coloques ese token, números de prueba ni el token de Meta en el navegador o Git.

## Subir a GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <URL_DEL_REPOSITORIO_GITHUB>
git push -u origin main
```
