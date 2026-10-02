# Fase 1 — Diagnóstico de persistencia (paso 1.5b)

- **Rama:** `lanzamiento-f1-textos` @ `3627414`
- **Fecha:** 2026-10-02
- **Alcance:** solo diagnóstico por lectura de código. No se editó código ni se tocó ninguna tabla. Las consultas SQL de este documento son de **solo lectura**; las de prueba que escriben datos están marcadas y requieren tu aprobación.
- **Tablas:** `privacy_consents`, `push_subscriptions`, `user_suggestions`, `profiles`.
- **Números de línea:** corresponden a `3627414`. `index.html` se desplazó +11 líneas respecto a la auditoría por el bloque CSS de 1.7.

## Resumen

| Tabla | ¿Debería tener filas hoy? | Causa más probable de que esté vacía | ¿Falla en silencio? |
|---|---|---|---|
| `profiles` | **No.** Vacía por diseño. | Solo la llena el trigger `on_auth_user_created` al crear un usuario en Supabase Auth. El registro está desactivado: `setAuthMode` fuerza siempre `'guest'` (index.html:229). | No aplica |
| `privacy_consents` | **Sí.** Debería haber una fila por cada invitado nuevo que acepta el aviso. | No se puede confirmar sin SQL. Hipótesis principal (H1): la migración "FASE 2" de schema.sql:201-218 no está aplicada, porque sin ella el insert de un invitado viola `user_id NOT NULL` o usa columnas que no existen. Alternativas: faltan variables en el entorno (H2) o `SUPABASE_URL` mal formada (H3). | **Sí.** El invitado ve "Consentimiento de privacidad registrado." aunque el servidor falle. |
| `push_subscriptions` | Solo si alguien completó toda la cadena: fijó una meta, concedió permiso y `VAPID_PUBLIC_KEY` está configurada. | Puede ser falta de uso real, falta de `VAPID_PUBLIC_KEY`, tabla o migración ausente, o filas borradas por la cascada (404/410). | **Sí.** No se revisa la respuesta del POST. |
| `user_suggestions` | Solo si alguien envió una sugerencia. | Lo más probable es que nadie haya enviado una. Si la Function fallara, el usuario vería un error (este flujo sí revisa la respuesta). | No |

**Hallazgo transversal: el panel del superadmin no puede ver estas tablas aunque tengan filas.** `loadUsers` y `loadSuggestions` (index.html:680-681) leen con la clave anon sin sesión de Supabase, porque el superadmin no es usuario de Supabase Auth. Las políticas solo permiten `select` a `authenticated`. Con RLS, eso devuelve **una lista vacía sin error**, así que el panel muestra la tabla vacía. **Antes de concluir que una tabla está vacía, confírmalo con el SQL de la sección 4** (o en el Table Editor de Supabase), no con el panel.

**Recomendación:** corre primero las consultas de solo lectura de la sección 4. Con sus resultados se confirma o descarta cada hipótesis. El arreglo propuesto (sección 8) conviene hacerlo como **mini-fase 1.5c**; ver la sección 9.

---

## 1. Qué acción escribe en cada tabla y en qué función

| Tabla | Acción del usuario | Función del navegador | Function / servidor |
|---|---|---|---|
| `privacy_consents` | Marcar la casilla del aviso y pulsar "Aceptar y continuar". El modal aparece al entrar si no hay consentimiento local (invitado) o `privacy_accepted_at` (cuenta). | `ensurePrivacyConsent` (index.html:554), handler de `#privacy-modal-accept` (index.html:560-582) | `onRequestPost` en functions/api/privacy-consent.js:4-45 |
| `push_subscriptions` | (1) Agregar un activo al portafolio. (2) Doble clic o doble toque en la gráfica y "Sí, establecer". (3) Conceder permiso de notificaciones. También el botón "Activar notificaciones push" si ya hay una meta. Al quitar el activo se borra la suscripción. | `proposePortfolioGoal` (352), `#portfolio-alert-yes` (353), `ensurePushSubscription` (383-396), `subscribeAssetPush` (397-406), `#push-enable-btn` (415), `removePortfolioAsset` → `unsubscribeAssetPush` (357, 407-414) | `onRequestPost` / `onRequestDelete` en functions/api/push/subscribe.js:6-27 / 29-43. Lectura, actualización y borrado diarios en actualizar_automatico.py:198-274 |
| `user_suggestions` | Menú de cuenta → "Sugerencias" → escribir → "Enviar sugerencia" | `#suggestion-button` (269), `#suggestion-submit` (271) | `onRequestPost` en functions/api/suggestions.js:7-38 |
| `profiles` | Crear una cuenta en Supabase Auth (`signUp`). Las actualizaciones (`last_login`, `privacy_accepted_at`, onboarding, nombre y comentarios) solo ocurren con una cuenta autenticada. | `#auth-form` onsubmit (262), `boot` (692), `loadProfile` (679), consentimiento (570), onboarding (670), `#profile-form` (688) | Trigger `handle_new_user` / `on_auth_user_created` (schema.sql:45-60), con `security definer` |

---

## 2. Ruta completa: navegador → Function → Supabase

### `privacy_consents`

**Invitado:**
1. index.html:690 `bootGuest` → `ensurePrivacyConsent()` → el modal se abre si `getGuestItem('algo_privacy_accepted_v1')` está vacío (index.html:555-557).
2. index.html:572-574: lee `horizon_guest` de `localStorage` y hace `fetch('/api/privacy-consent', POST)` **sin `Authorization`**, con `{version: '2026-10-01', language, ccpaOptOut, name, email}`.
3. functions/api/privacy-consent.js:6: si falta `SUPABASE_URL` o `SUPABASE_SERVICE_ROLE_KEY`, responde **503**.
4. privacy-consent.js:27-31: rama de invitado; valida el correo (400 si no es válido).
5. privacy-consent.js:34-36: calcula `hash_consentimiento` = SHA-256 de `email|timestamp|versión|IP`.
6. privacy-consent.js:38-42: `POST ${SUPABASE_URL}/rest/v1/privacy_consents` con `user_id: null`, `email`, `full_name`, `idioma`, `ccpa_do_not_sell`, `ip_origen` y `hash_consentimiento`.
7. privacy-consent.js:43: si Supabase no responde OK, devuelve **502** "Could not persist consent." sin registrar el motivo.

**Cuenta autenticada** (hoy no se puede alcanzar):
- index.html:566-567: envía `Authorization: Bearer <access_token>`.
- privacy-consent.js:19-25: valida el token con `GET /auth/v1/user` e inserta con `user_id`.
- index.html:570: además actualiza `profiles.privacy_accepted_at` con el cliente anon y la sesión del usuario.

### `push_subscriptions`

1. index.html:352-353: el usuario fija una meta → `writePortfolio(...)` (localStorage) → `void subscribeAssetPush(currentAssetKey, meta)` → toast "Meta establecida…".
2. index.html:383-396 `ensurePushSubscription`:
   - Pide permiso.
   - `registerServiceWorker` (index.html:380, `/sw.js`).
   - `getVapidPublicKey` (index.html:382) → `initializeSupabaseConfig` → `GET /api/public-config` → `VAPID_PUBLIC_KEY`. Si falta, muestra el toast "Las notificaciones push todavía no están configuradas en el servidor."
   - `pushManager.subscribe(...)`.
3. index.html:404: `fetch('/api/push/subscribe', POST)` con `{endpoint, keys, assetSymbol, goal, email}`.
4. functions/api/push/subscribe.js:8: 503 si faltan variables. Líneas 16-18: 400 si faltan campos.
5. subscribe.js:20-24: `POST ${SUPABASE_URL}/rest/v1/push_subscriptions?on_conflict=endpoint,asset_symbol` (upsert). Línea 25: 502 si falla.
6. Envío (GitHub Actions, de lunes a viernes a las 22:00 UTC):
   - actualizar_automatico.py:203 lee todas las filas.
   - Líneas 246-258: `webpush(...)`.
   - Líneas 262-264: **borra la fila si el servicio de push responde 404/410** (suscripción expirada).
   - Líneas 268-272: actualiza `last_phase`.
7. Baja: index.html:357 `removePortfolioAsset` → index.html:407-414 → `fetch('/api/push/subscribe', DELETE)` → subscribe.js:29-43 → `DELETE …?endpoint=eq.…&asset_symbol=eq.…`.

### `user_suggestions`

1. index.html:271: arma `{message, name, email}`. Si hubiera cuenta, también `Authorization`.
2. `fetch('/api/suggestions', POST)`. **Sí revisa `response.ok`**: si falla, muestra "No se pudo enviar la sugerencia. Intenta de nuevo.".
3. functions/api/suggestions.js:9: 503 si faltan variables. Línea 12: 400 si falta el texto.
4. suggestions.js:31-35: `POST ${SUPABASE_URL}/rest/v1/user_suggestions`. Línea 36: 502 si falla.
5. Lectura (panel superadmin): index.html:681 `loadSuggestions` → `supabaseClient.from('user_suggestions').select(...)` con la clave anon y **sin sesión**, así que devuelve `[]`.

### `profiles`

1. **Inserción:** solo por el trigger `on_auth_user_created` cuando se crea una fila en `auth.users` (schema.sql:45-60). Desde el navegador, el único camino es `supabaseClient.auth.signUp` (index.html:262, rama `authMode === 'register'`).
2. **Ese camino no se puede alcanzar:**
   - `authMode` empieza en `'guest'` (index.html:227).
   - `setAuthMode(mode)` ignora su argumento y asigna `authMode = 'guest'` (index.html:229).
   - El botón `#auth-toggle` está oculto y deshabilitado (index.html:86, 229-230).
   - Con `'guest'`, el formulario guarda `horizon_guest` en `localStorage` y llama `bootGuest` (index.html:262) **sin tocar Supabase**.
3. **Actualizaciones** (index.html:570, 670, 688, 692): usan el cliente anon con la sesión del usuario y solo se ejecutan si `currentUser` existe, cosa que nunca pasa con invitados.
4. **Lectura del panel** (index.html:680 `loadUsers`): misma situación que `loadSuggestions`, devuelve `[]` sin sesión.

---

## 3. Llave y variables de entorno (solo nombres)

| Paso | Llave | Variables que necesita |
|---|---|---|
| `/api/privacy-consent` | `service_role` (`apikey` y `Authorization: Bearer`) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Cloudflare Pages) |
| `/api/suggestions` | `service_role` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `/api/push/subscribe` (POST/DELETE) | `service_role` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `/api/public-config` (necesario para push y para el cliente anon) | Entrega la anon al navegador | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VAPID_PUBLIC_KEY` |
| Escrituras a `profiles` desde el navegador | anon + JWT del usuario (RLS "users can update their own profile") | Lo que entregue `/api/public-config` |
| Trigger `handle_new_user` | `security definer` (dueño de la función) | — |
| Cascada push (GitHub Actions) | La que esté en `SUPABASE_KEY`. Debe ser `service_role`, porque la tabla no tiene políticas. | Secrets de GitHub: `SUPABASE_URL`, `SUPABASE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y, opcional, `VAPID_CLAIM_EMAIL` (actualizar_automatico.py:13-22) |
| Control `/api/track-view` POST (`page_views`) | `service_role` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

**Diferencia importante en la URL:**
- `public-config.js:14-15` y `market/[symbol].js:29-30` **no usan `SUPABASE_URL` tal cual**. La reconstruyen como `https://{ref}.supabase.co` a partir del `ref` del JWT de `SUPABASE_ANON_KEY` (commit `ad92e4a`, "Normalize Supabase URL from anon JWT", 2026-09-09).
- Las Functions de escritura (privacy-consent, suggestions, push/subscribe, track-view, news, patterns…) **usan `env.SUPABASE_URL` directo**.
- Si esa variable tuviera una barra final, una ruta extra o fuera la URL del dashboard, **las lecturas de precios funcionarían y las escrituras fallarían**. Esa es la hipótesis H3.
- El control `page_views` (sección 4.4) la confirma o la descarta: escribe con la misma variable sin normalizar y se dispara en cada carga de página.

---

## 4. Políticas RLS y estructura real

### 4.1 Lo que dice `schema.sql`

No hay carpeta de migraciones; `schema.sql` es el único archivo SQL del repo.

| Tabla | RLS | Políticas en schema.sql | Efecto |
|---|---|---|---|
| `profiles` | Activada (l. 16) | `select` para `authenticated` con `using (true)` (l. 80-81); `update` propio para `authenticated` (l. 83-86). Sin `insert` ni `delete`. | Anon no lee nada, sin error. El insert solo lo hace el trigger `security definer`. |
| `privacy_consents` | Activada (l. 29) | **Ninguna** | Solo `service_role`, que ignora RLS, puede leer o escribir. |
| `push_subscriptions` | Activada (l. 302) | **Ninguna** | Solo `service_role`. |
| `user_suggestions` | Activada (l. 332) | `select` para `authenticated` con `using (true)` (l. 338-339). Sin `insert`. | Insert solo con `service_role`. Lectura: anon nada, `authenticated` todo. |

**Migraciones incrementales que podrían no estar aplicadas** (schema.sql se aplica a mano en el SQL Editor):
- **FASE 2** (l. 201-218) en `privacy_consents`:
  - `user_id` deja de ser `NOT NULL`.
  - Se agregan `email`, `full_name`, `idioma` y `ccpa_do_not_sell`.
  - Se agrega el check `privacy_consents_identity_check`.
  - **Si no se corrió, todos los inserts de invitados fallan.**
- **FASE 5** (l. 287-303): crea `push_subscriptions`.
- **FASE 6** (l. 306): agrega `profiles.has_completed_onboarding`.
- **FASE 7** (l. 323-339): crea `user_suggestions` y su política.

Nota: las líneas 80 y 83 usan `create policy` sin `drop policy if exists`. Si alguien volvió a correr el archivo completo, falla en ese punto y **todo lo que sigue no se aplica**, incluidas las FASES 2 a 7. Es una causa plausible de H1.

### 4.2 Consulta: existencia de tablas y RLS (solo lectura)

Corre esto primero; no falla aunque alguna tabla no exista.

```sql
select t.tabla,
       to_regclass('public.' || t.tabla) is not null as existe,
       c.relrowsecurity      as rls_activo,
       c.relforcerowsecurity as rls_forzado
from unnest(array['privacy_consents','push_subscriptions','user_suggestions','profiles']) as t(tabla)
left join pg_class c on c.oid = to_regclass('public.' || t.tabla)
order by t.tabla;
```

### 4.3 Consulta: políticas, columnas, restricciones, permisos y trigger (solo lectura)

```sql
-- Políticas reales
select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('privacy_consents','push_subscriptions','user_suggestions','profiles')
order by tablename, policyname;

-- Columnas reales (verifica la FASE 2: user_id nullable, email, full_name, idioma, ccpa_do_not_sell)
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('privacy_consents','push_subscriptions','user_suggestions','profiles')
order by table_name, ordinal_position;

-- Restricciones (checks, unique, FK)
select conrelid::regclass as tabla, conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = any (array[
  to_regclass('public.privacy_consents'), to_regclass('public.push_subscriptions'),
  to_regclass('public.user_suggestions'), to_regclass('public.profiles')])
order by 1, 2;

-- Permisos de tabla por rol (service_role debe tener INSERT/SELECT/UPDATE/DELETE)
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privilegios
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('privacy_consents','push_subscriptions','user_suggestions','profiles')
  and grantee in ('anon','authenticated','service_role')
group by table_name, grantee
order by table_name, grantee;

-- Triggers de auth.users que llenan profiles
select tgname, tgrelid::regclass as tabla, tgenabled
from pg_trigger
where tgname in ('on_auth_user_created','on_auth_user_updated');
```

### 4.4 Consulta: conteos y control de que las Functions escriben (solo lectura)

Corre cada `select` por separado; si una tabla no existe, ese `select` dará error y los demás no se afectan.

```sql
select count(*) as filas, max(timestamp_aceptacion) as ultima from public.privacy_consents;
select count(*) as filas, max(created_at) as ultima from public.push_subscriptions;
select count(*) as filas, max(created_at) as ultima from public.user_suggestions;
select count(*) as filas, max(created_at) as ultima from public.profiles;
select count(*) as usuarios_auth from auth.users;

-- CONTROL: tablas que escriben las Functions con la MISMA env.SUPABASE_URL sin normalizar y service_role
select page, count(*) as filas, max(created_at) as ultima from public.page_views group by page;
select count(*) as filas, max(created_at) as ultima from public.asset_news_scores;
select count(*) as filas, max(created_at) as ultima from public.asset_prediction_audit;
```

### 4.5 Cómo leer los resultados

| Resultado | Conclusión |
|---|---|
| `page_views` tiene filas recientes de `platform` | En ese entorno, `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` funcionan para escribir. Se descartan H2 y H3 para Production. |
| `page_views` con filas, `privacy_consents` vacía y `privacy_consents.user_id` aparece `is_nullable = NO` o faltan `email`/`idioma` | **H1 confirmada:** falta la migración FASE 2. |
| `page_views` vacía | Problema de variables o de URL (H2/H3) en ese entorno; afecta a todas las Functions de escritura. |
| `push_subscriptions` o `user_suggestions` no existen | Faltan las migraciones FASE 5/7 (el usuario vería error en sugerencias; en push no vería nada). |
| `usuarios_auth = 0` y `profiles = 0` | Confirma que `profiles` está vacía por diseño. |

---

## 5. Errores silenciosos

| # | Dónde | Qué pasa | Efecto |
|---|---|---|---|
| S1 | index.html:574-577, 580 (consentimiento de invitado) | Si `/api/privacy-consent` responde no-OK o lanza excepción, solo llama `reportActionError`, que escribe en la consola y **solo muestra un toast si `adminSession`** (index.html:228). Luego guarda el flag en `localStorage` (`setGuestItem`) y muestra "Consentimiento de privacidad registrado." | **Parece guardado y no lo está.** No vuelve a intentarlo: el modal ya no aparece para ese correo en ese navegador. |
| S2 | index.html:570 (cuenta) | `update profiles.privacy_accepted_at` sin revisar `error`. | Inalcanzable hoy (no hay cuentas). |
| S3 | index.html:404-405 (`subscribeAssetPush`) | No revisa `response.ok`; `catch { /* best-effort */ }`. El toast "Meta establecida…" (l. 353) sale antes y siempre. | El usuario cree que tendrá alertas aunque la fila no exista. |
| S4 | index.html:380 (`registerServiceWorker`) y 386 | Si falla el registro del service worker, devuelve `null` y `ensurePushSubscription` termina sin ningún mensaje. | La alerta no se activa y nadie lo sabe. |
| S5 | index.html:413 (`unsubscribeAssetPush`) | `catch` vacío, sin revisar la respuesta. | Pueden quedar filas huérfanas; la cascada notificaría por un activo ya retirado. |
| S6 | index.html:670, 692 (`profiles`) | `catch` vacío / `update` sin revisar el resultado. | Inalcanzable hoy. |
| S7 | index.html:680-681 (panel superadmin) | Lee con anon sin sesión; RLS devuelve `[]` **sin error**, así que no aparece el mensaje "protegido" y la tabla se ve vacía. | **Falso "vacío"** al revisar desde la plataforma. |
| S8 | index.html:226 (`initializeSupabaseConfig`) | Si falla `/api/public-config`, solo `reportActionError` (consola). Push queda sin VAPID. | El usuario ve "no están configuradas en el servidor" solo al intentar push. |
| S9 | privacy-consent.js:43, suggestions.js:36, subscribe.js:25 y 41 | Responden 502 con un mensaje genérico y **no registran el status ni el cuerpo de error de Supabase**. | No hay rastro en los logs de Cloudflare para saber por qué falló (columna inexistente, constraint, 401…). |
| S10 | actualizar_automatico.py:203-205 | `.data or []`: si `SUPABASE_KEY` no fuera `service_role`, RLS devolvería 0 filas sin error y la cascada terminaría sin enviar nada. | Riesgo bajo: la misma llave escribe precios a diario, así que casi seguro es `service_role`. |
| S11 | actualizar_automatico.py:262-264 | Borra la fila cuando el servicio de push responde 404/410. | Es correcto, pero una tabla vacía **puede** ser una tabla cuyos usuarios revocaron el permiso o expiraron. |

Fallbacks a almacenamiento local que hacen parecer que se guardó:
- **S1:** `algo_privacy_accepted_v1` en `localStorage`.
- **Metas:** viven solo en `localStorage` (`writePortfolio`). La UI las muestra aunque la fila de push no exista (S3).
- **Perfil de invitado:** index.html:688 dice honestamente "Perfil actualizado en este dispositivo.", así que no es engañoso.

---

## 6. ¿Vacía por diseño?

| Tabla | Veredicto |
|---|---|
| `profiles` | **Sí, por diseño.** Mientras solo existan invitados (registro desactivado en index.html:229), no hay filas en `auth.users` y el trigger nunca se dispara. Los invitados existen solo en `localStorage` (`horizon_guest`) y, si el consentimiento funciona, como `email`/`full_name` en `privacy_consents`. |
| `user_suggestions` | **Posiblemente vacía por falta de uso.** El flujo avisa si falla. |
| `push_subscriptions` | **Puede estar vacía legítimamente:** requiere permiso del navegador, meta fijada y VAPID configurado, y la cascada borra suscripciones expiradas. No es concluyente sin SQL. |
| `privacy_consents` | **No debería estar vacía** si hubo al menos un invitado nuevo después de la FASE 2. Es la tabla con más indicios de falla real. |

---

## 7. Production vs. Preview

| Tema | Riesgo para la prueba |
|---|---|
| **Variables por entorno** | Cloudflare Pages tiene conjuntos de variables separados para Production y Preview. Si `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` o `VAPID_PUBLIC_KEY` solo están en Production, en Preview: privacy-consent/suggestions/push responden **503** (y el consentimiento de invitado falla en silencio, S1), `/api/public-config` responde 503 y no hay VAPID. |
| **`/api/health` no muestra todo** | Su lista (functions/api/health.js:7) no incluye `VAPID_PUBLIC_KEY`, `ANTHROPIC_API_KEY` ni `ADMIN_API_SECRET`. Que responda 200 no garantiza que push funcione. |
| **Misma base de datos** | Si Preview usa los mismos valores, **las pruebas desde Preview escriben en la base de producción**. Usa correos de prueba identificables (p. ej. `qa+f1-…@thalgorithm.com`) para poder borrarlos después. |
| **Envío de push** | Lo hace GitHub Actions desde la rama por defecto (`main`), no la rama de Preview. Con `workflow_dispatch` corre el código de `main`; `actualizar_automatico.py` no cambió en esta rama. Las suscripciones hechas desde Preview (origen `*.pages.dev`) se guardan igual, pero al hacer clic en la notificación se abre `https://thalgorithm.com/` (actualizar_automatico.py:254). |
| **Llaves VAPID** | La pública está en Cloudflare (`VAPID_PUBLIC_KEY`) y la privada en GitHub (`VAPID_PRIVATE_KEY`). Si no son del mismo par, el envío falla (403) **sin borrar** la fila. Hay que comprobar que ambos secrets sean del mismo par. |
| **Horario** | La cascada corre de lunes a viernes a las 22:00 UTC. Para probar sin esperar, usa `workflow_dispatch` con `only_montecarlo = false`. |
| **`SUPABASE_URL`** | Si su valor difiere entre entornos (barra final, ruta), H3 puede afectar a uno solo. El control de `page_views` hay que mirarlo por entorno. Las filas no indican de dónde vienen, así que haz una visita de prueba y mira si aparece una fila nueva. |

---

## 8. Propuesta de corrección y prueba de punta a punta

### 8.1 Correcciones propuestas (no aplicadas)

Por orden de prioridad:

1. **Esquema (solo si el SQL de la sección 4 lo confirma, y con tu aprobación).** Aplicar únicamente los bloques faltantes de schema.sql (FASE 2, 5, 6 o 7), no el archivo completo, porque las líneas 80 y 83 fallan al repetirse. Son `alter table … add column if not exists` y `create table if not exists`, que no tocan los datos existentes.
2. **Functions de escritura** (privacy-consent, suggestions, push/subscribe):
   - Usar la misma URL normalizada que `public-config.js` y `market/[symbol].js`, en un helper compartido `functions/_shared/supabase.js` con `supabaseUrl(env)`.
   - Registrar en `console.error` el status y el código de error de Supabase cuando falle, sin datos personales ni llaves.
   - Siguen usando `service_role`, sin cambiar las políticas.
3. **Consentimiento de invitado (S1):**
   - Si el servidor falla, no mostrar "registrado".
   - Guardar el consentimiento como **pendiente** en `localStorage` y reintentar el POST en la siguiente carga, hasta recibir 200.
   - Mensaje honesto: "Tu consentimiento quedó guardado en este dispositivo; lo registraremos en cuanto el servidor responda."
   - Decide tú si prefieres bloquear el acceso hasta que el servidor confirme. Es una decisión legal; conviene revisarla en la Fase 7.
4. **Push (S3-S5):** revisar `response.ok` en el alta y la baja. Mostrar "Meta establecida" solo para la meta, y un segundo mensaje claro sobre la alerta ("Alerta activada" / "No se pudo activar la alerta"). Avisar si falla el service worker.
5. **Lectura del panel superadmin (S7):** reemplazar las lecturas anon de `profiles`/`user_suggestions` por un endpoint admin con `checkAdminAuth` y `service_role`. Corresponde a la **Fase 5** (panel admin), pero conviene saberlo ya para no confundir "vacío".
6. **`profiles`:** sin cambio mientras no haya cuentas. Si quieres un registro de invitados, sería una tabla nueva (cambio de esquema, requiere aprobación) o aprovechar `privacy_consents` como registro de invitados, que ya guarda nombre y correo.

### 8.2 Pruebas de punta a punta

Todas **escriben datos de prueba**: requieren tu aprobación y conviene hacerlas en Preview con correos `qa+…`. Sustituye `<HOST>` por la URL de Preview o por `thalgorithm.com`.

**Paso 0, sin escribir nada:** `curl -s https://<HOST>/api/health` y `curl -s https://<HOST>/api/public-config | jq '{url: (.url != null), anon: (.anonKey != null), vapid: (.vapidPublicKey != null)}'`. Así compruebas que las variables existen sin mostrar sus valores.

| Tabla | Prueba directa (aísla la Function) | Prueba por la UI | Verificación SQL (solo lectura) | Limpieza (escribe; con aprobación) |
|---|---|---|---|---|
| `privacy_consents` | `curl -i -X POST https://<HOST>/api/privacy-consent -H "Content-Type: application/json" -d '{"version":"2026-10-01","language":"es","name":"QA F1","email":"qa+consent-f1@thalgorithm.com"}'`. Esperado: 200 con `acceptedAt`. Si responde 503, faltan variables; 502, falla en Supabase (esquema, URL o llave); 400, el correo no es válido. | Ventana privada → entrar como invitado con `qa+consent-ui@…` → aceptar → en DevTools > Network, `privacy-consent` debe dar 200 | `select email, idioma, version_aviso_privacidad, ip_origen, timestamp_aceptacion from public.privacy_consents where email like 'qa+%' order by timestamp_aceptacion desc;` | `delete from public.privacy_consents where email like 'qa+%';` |
| `user_suggestions` | `curl -i -X POST https://<HOST>/api/suggestions -H "Content-Type: application/json" -d '{"message":"QA F1 prueba","name":"QA F1","email":"qa+sug-f1@thalgorithm.com"}'`. Esperado: 200 `{"saved":true}`. | Menú de cuenta → Sugerencias → enviar → debe aparecer "Sugerencia enviada." | `select id, email, message, created_at from public.user_suggestions where email like 'qa+%';` | `delete from public.user_suggestions where email like 'qa+%';` |
| `push_subscriptions` (alta y baja) | Alta: `curl -i -X POST https://<HOST>/api/push/subscribe -H "Content-Type: application/json" -d '{"endpoint":"https://example.invalid/qa-f1","keys":{"p256dh":"qa","auth":"qa"},"assetSymbol":"GC=F","goal":1,"email":"qa+push-f1@thalgorithm.com"}'`. Esperado: 200. Baja: el mismo `curl` con `-X DELETE` y `-d '{"endpoint":"https://example.invalid/qa-f1","assetSymbol":"GC=F"}'`. Esperado: 200 y la fila desaparece. | Navegador real con permiso: agregar un activo → fijar una meta cerca del precio actual → aceptar permiso → Network: `push/subscribe` 200 → `workflow_dispatch` de "Actualizacion Diaria de Activos" → debe llegar la notificación si la fase cambia a amarilla o roja. | `select asset_symbol, goal, last_phase, email, updated_at from public.push_subscriptions where email like 'qa+%';` | `delete from public.push_subscriptions where email like 'qa+%';` (si la baja del `curl` no lo hizo) |
| `profiles` | No aplica mientras el registro esté desactivado. | Cuando se active el registro (premium/elite): `signUp` → verificar la fila creada por el trigger. | `select count(*) from auth.users; select count(*) from public.profiles;` | — |

**Advertencia sobre la prueba de push con endpoint falso:** si la cascada corre mientras existe esa fila, `webpush` fallará con un error que no es 404/410, así que la fila **no se borra sola**. Hay que hacer la baja o la limpieza antes de la siguiente ejecución.

---

## 9. ¿Cabe en la Fase 1?

| Parte | ¿Dónde? | Motivo |
|---|---|---|
| Correr el SQL de solo lectura (sección 4) | **Ahora (1.5b)**, lo corres tú | Sin esto no se puede confirmar H1/H2/H3 |
| Aplicar migraciones faltantes (8.1 punto 1) | **1.5c**, con tu aprobación explícita | Toca el esquema; tu regla es preguntar antes |
| Helper de URL y logs en las 3 Functions, más reintento del consentimiento y avisos honestos en push (8.1 puntos 2-4) | **Mini-fase 1.5c "persistencia"**, en su propia rama (p. ej. `lanzamiento-f1-persist`, 23 caracteres) | Es lógica, no texto. Son unos 4 archivos y cambios pequeños, pero necesita pruebas de punta a punta con datos (8.2). No conviene mezclarlo con el commit de textos. |
| Lectura admin vía Function (8.1 punto 5) | **Fase 5** | Es parte del rediseño del panel admin |
| Registro de invitados / `profiles` (8.1 punto 6) | **Decisión de producto**; Fase 5 o la de cuentas premium | Requiere una tabla nueva o un cambio de flujo |
| Probar #35 (tour: "te avisamos…") y desbloquear #40 (textos push) | Después de 1.5c | Dependen de que push funcione de punta a punta |

**Recomendación:** la mini-fase 1.5c es corta y se puede cerrar antes del lanzamiento. El consentimiento (S1) es lo más urgente, porque hoy puede haber invitados que creen haber aceptado un aviso que no quedó registrado en ningún lado auditable.

---

## Observación fuera de alcance (seguridad, para registrar)

- **Credencial demo en el JS público.** El acceso al backoffice compara contra una contraseña escrita en el JS público (index.html:261, `admin-password` y su valor de demo).
- **El secreto admin depende de esa contraseña.** Ese mismo valor se guarda como `adminApiSecret` y se envía como cabecera `X-Admin-Secret` a los endpoints admin. Para que esos endpoints respondan, el secreto `ADMIN_API_SECRET` de Cloudflare tendría que ser igual a una contraseña que cualquiera puede leer en el código fuente.
- AGENTS.md ya trata ese login como demo. Aun así, conviene revisar en la Fase 5 que `ADMIN_API_SECRET` **no** coincida con ese valor, y mover el acceso admin a una autenticación real.
- No se hizo ningún cambio.
