# HORIZON V2

Terminal web de inteligencia cuantitativa y geopolítica con autenticación de Supabase, perfiles de usuario y registro de niveles `normal`, `premium` y `elite`.

## Estructura

- `index.html` — aplicación estática completa
- `supabase-config.js` — URL y clave pública del proyecto Supabase
- `schema.sql` — tablas, trigger de perfiles y políticas RLS
- `logo_algorithm.svg` — isotipo geométrico de la plataforma
- `functions/api/market.js` — proxy server-side para históricos de FMP

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

## Despliegue en Cloudflare Pages

En Cloudflare Pages crea un proyecto conectado al repositorio de GitHub. Usa estos valores:

- **Framework preset:** None
- **Build command:** dejar vacío
- **Build output directory:** `/`

Después de publicar, registra el dominio de Pages en Supabase Authentication.

## Subir a GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <URL_DEL_REPOSITORIO_GITHUB>
git push -u origin main
```
