# Instrucciones para agentes

## Idioma y texto

- Comunícate con el usuario en español, salvo que solicite otro idioma.
- Mantén en español el texto visible de la interfaz, etiquetas, mensajes de error, `aria-label` y contenido de ayuda.
- Conserva en inglés los identificadores técnicos y nombres ya establecidos de APIs, campos de Supabase, símbolos de mercado y clases CSS; no traduzcas código existente de forma masiva.
- Respeta la codificación UTF-8 existente cuando edites textos con acentos o signos del español.

## Estructura del proyecto

- Es una aplicación estática sin framework ni paso de compilación: `index.html` contiene la terminal principal y `admin.html` el backoffice independiente.
- `supabase-config.js` contiene solo configuración pública del navegador; `schema.sql` define Supabase, triggers y RLS.
- `functions/api/market.js` es una función server-side de Cloudflare Pages para consultar FMP. Las claves privadas deben permanecer en secretos del despliegue.
- Consulta [README.md](README.md) para configuración de Supabase, datos reales, Cloudflare Pages y uso local.

## Trabajo y validación

- Para ejecutar localmente, usa `py -m http.server 8000` y prueba `http://localhost:8000`.
- No hay un comando de build ni una suite de pruebas declarada; valida manualmente los flujos afectados en el navegador y revisa la consola.
- Mantén los cambios pequeños y coherentes con el HTML/CSS/JavaScript vanilla existente. Evita introducir un framework o una dependencia sin necesidad clara.
- Si cambias autenticación, perfiles o consultas, revisa también las políticas RLS y el esquema en `schema.sql`.

## Seguridad

- No insertes API keys privadas, `service_role` de Supabase ni credenciales reales en HTML, JavaScript público o Git.
- Trata el login de administrador incluido como demo, no como control de acceso de producción.
- Conserva el escape de contenido externo antes de insertarlo con `innerHTML` y mantén `noopener noreferrer` en enlaces externos.