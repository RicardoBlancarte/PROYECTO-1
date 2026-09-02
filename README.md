# HORIZON V2

Terminal web de inteligencia cuantitativa y geopolítica con autenticación de Supabase, perfiles de usuario y registro de niveles `normal`, `premium` y `elite`.

## Estructura

- `index.html` — aplicación estática completa, incluye el explorador de activos
- `supabase-config.js` — URL y clave pública del proyecto Supabase
- `schema.sql` — tablas, trigger de perfiles, políticas RLS y la tabla `asset_history` (caché histórica)
- `logo_algorithm.svg` — isotipo geométrico de la plataforma
- `functions/api/market.js` — proxy server-side para históricos de FMP con caché dura en Supabase
- `functions/api/assets.js` — proxy server-side que agrega el catálogo completo de activos de FMP (acciones, ETFs, índices, futuros/commodities, forex, cripto)

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

## Explorador de activos e histórico con caché dura

La sección **Explorador de activos** de `index.html` consulta `/api/assets` para traer el catálogo completo de FMP (acciones, ETFs, índices, futuros/commodities, forex y cripto) con la bolsa y el tipo de cada instrumento. El catálogo se cachea 24h en `localStorage` del navegador para no repetir esa llamada pesada en cada visita, y además queda cacheado 12h en el borde (Cache-Control) para todos los visitantes.

Al elegir un activo se puede ver su histórico en tres resoluciones (Diario, Semanal, Anual · 5 años) desde `/api/market/SYMBOL?interval=daily|weekly|yearly`. Esa función persiste los datos como un hecho duro en la tabla `asset_history` de Supabase (usando la `service_role` key, nunca expuesta al navegador):

- Solo se llama a FMP cuando faltan barras nuevas (no en cada refresh ni cada vez que se consulta el mismo activo).
- Se conservan como máximo 500 barras diarias, 500 semanales y 5 anuales por símbolo.
- Cualquier símbolo sin consultas en los últimos 3 meses se elimina por completo de la caché y se refresca desde cero la próxima vez que se pida.

Para habilitar la caché dura, configura además estos secretos de Cloudflare Pages y ejecuta la sección de `asset_history` de `schema.sql` en Supabase:

```bash
npx wrangler pages secret put SUPABASE_URL --project-name <NOMBRE_DEL_PROYECTO>
npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name <NOMBRE_DEL_PROYECTO>
```

La `service_role` key nunca debe usarse en `supabase-config.js` ni en ningún archivo servido al navegador; solo vive como secreto de la función de Cloudflare Pages. Si estos secretos no están configurados, `/api/market` sigue funcionando igual que antes (sin persistencia, llamando a FMP directamente).

## Despliegue en Cloudflare Pages

En Cloudflare Pages crea un proyecto conectado al repositorio de GitHub. Usa estos valores:

- **Framework preset:** None
- **Build command:** `npm run build`
- **Build output directory:** `/`

Después de publicar, registra el dominio de Pages en Supabase Authentication.

Configura estos secretos o variables de entorno en **Settings > Environment variables** de Cloudflare Pages: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEWS_API_KEY` y `FMP_API_KEY`. Las Functions bajo `functions/api/` los leen mediante `context.env`; el navegador recibe exclusivamente `SUPABASE_URL` y `SUPABASE_ANON_KEY` desde `/api/public-config`. Comprueba bindings sin revelar valores con `/api/health`.

Para desarrollo local, copia `.dev.vars.example` como `.dev.vars`, completa las variables y ejecuta `npm install` seguido de `npm run dev`. El archivo `.dev.vars` está ignorado por Git.

## Subir a GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <URL_DEL_REPOSITORIO_GITHUB>
git push -u origin main
```
