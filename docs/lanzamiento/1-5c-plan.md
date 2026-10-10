# Fase 1, punto 1.5c — Consentimiento y push: respuesta honesta ante fallas

- **Fecha:** 2026-10-09
- **Rama:** `lanzamiento-1-5c` (desde `main` en `f5ecc58`)
- **Contexto:** en la prueba del 9-oct en Producción la suscripción push y el consentimiento **ya se guardan**. La falla anterior era la llave `SUPABASE_SERVICE_ROLE_KEY` de Production, corregida el 5-oct. Este punto mejora cómo responde la app cuando algo falla.
- **Estado (2026-10-09):** A y B implementados en `4e11bc5` y probados en el Preview `d7209df1` (sección D). Pendientes en D.4.
- **Alcance:** A y B con cambios de código en `index.html` y `functions/api/privacy-consent.js`. C verificado, sin bug. **No se tocan esquemas ni tablas.**
- **Referencias:** [fase-1-persistencia.md](fase-1-persistencia.md) y [fase-2-plan.md](fase-2-plan.md) (pendientes del 1.5c).

---

## 0. Decisiones del usuario (2026-10-09)

| Punto | Decisión |
|---|---|
| A | Aprobado. Se ofrece "Continuar de todos modos" con la marca `algo_privacy_pending_v1` y reenvío automático. "Consentimiento de privacidad registrado." solo con respuesta OK del servidor; si no, "Consentimiento guardado en este dispositivo; pendiente de registro.". Incluye: try/catch del flujo con cuenta, revisión del error de `profiles.update` y respuesta 502 con JSON (no 500) del endpoint cuando falle el `fetch` a Supabase. |
| B | Aprobado tal cual: estados de `subscribeAssetPush` guardados en `algo_push_status_v1`, tabla de toasts, textos del Centro de Control y botón "Reintentar registro". `push-enable-btn` usa el mismo estado. `requestPermission` sigue siendo el primer `await`. |
| C | Verificado, sin bug. Se cierra sin cambios de código. No se agrega el resumen de la preferencia CCPA al toast. |
| Ejecución | Plan antes de editar. Sin commit ni push hasta que el usuario revise el diff. `git add` solo por ruta cuando lo pida. |

---

## A. Consentimiento (`privacy_consents`)

### A.1 Archivos y líneas (en `f5ecc58`)

- `index.html:633-638`: `ensurePrivacyConsent`.
- `index.html:639-661`: botón "Aceptar y continuar" (`privacy-modal-accept`).
- `index.html:229`: `reportActionError` (solo consola; toast únicamente si `adminSession`).
- `functions/api/privacy-consent.js:21` (`/auth/v1/user`) y `:38-43` (insert en `privacy_consents`).

### A.2 Comportamiento actual ante fallas

| Caso | Invitado (flujo principal) | Cuenta registrada |
|---|---|---|
| Respuesta no-OK (400/401/502/503) | `reportActionError` solo en consola (l. 654); guarda la aceptación local (l. 656), cierra el aviso y muestra **"Consentimiento de privacidad registrado."** (l. 659). | Error dentro del aviso (l. 647) y no deja pasar. |
| Error de red | Igual que arriba (l. 655): entra sin aviso. | `fetch` sin try (l. 646): rechazo no manejado; el botón **parece no hacer nada**. |
| Falla de Supabase | El endpoint responde 502 (l. 43) y pasa lo mismo que en la primera fila. Si el `fetch` a Supabase lanza excepción, el endpoint responde **500 sin JSON**. | Igual. Además, el error de `profiles.update` (l. 649) no se revisa. |

### A.3 Causa

En el flujo de invitado, una falla del servidor se trata como un aviso solo técnico: el mensaje de éxito sale siempre y la aceptación local hace que **nunca se reintente**.

### A.4 Cambio

1. Si el registro falla, el aviso **se queda abierto** con el mensaje *"No pudimos registrar tu consentimiento en el servidor. Puedes reintentar o continuar; lo volveremos a intentar automáticamente."*. El botón principal pasa a **"Reintentar"** y aparece **"Continuar de todos modos"**.
2. "Continuar de todos modos" guarda la aceptación en el dispositivo y la marca `algo_privacy_pending_v1` con `{ acceptedAt, stage, body }`, donde `body` lleva versión, idioma, CCPA, nombre y correo. Para invitados la marca usa el namespace del invitado (`guestScopedKey`); para cuentas, `algo_privacy_pending_v1::uid:<id>`. Toast: *"Consentimiento guardado en este dispositivo; pendiente de registro."*. En ese mismo momento se muestra el banner `privacy-pending-banner` con "Reintentar".
3. `ensurePrivacyConsent` reenvía la marca pendiente una vez por carga, en segundo plano. Si el reenvío vuelve a fallar, se muestra un banner discreto (`privacy-pending-banner`, mismo estilo que `trial-banner`) con el botón **"Reintentar"**. Si funciona, se borran la marca y el banner.
4. "Consentimiento de privacidad registrado." solo se muestra con respuesta OK del servidor.
5. Cuenta registrada: el `fetch` va dentro de try/catch y sigue el mismo flujo. Se revisa el `error` de `profiles.update`. Si el registro de auditoría se guardó pero el perfil no, se considera registrado (la fila de auditoría existe), pero queda una marca con `stage: 'profile'` que **solo** reintenta `profiles.update`, para no crear filas de auditoría duplicadas.
6. Endpoint: los `fetch` a Supabase (`/auth/v1/user` y el insert) van dentro de try/catch y responden **502 con JSON**.

### A.5 Riesgos

- Cada reintento del registro de auditoría crea una fila nueva (el hash incluye la hora). Para auditoría es aceptable.
- Con "Continuar de todos modos", el usuario entra con el consentimiento solo en su dispositivo hasta que el reenvío funcione. Es la decisión aprobada.
- **Pendiente para la Fase 7 (abogado):** si el consentimiento se registra en un reintento, `timestamp_aceptacion` en `privacy_consents` es la hora del reintento (cuando lo recibe el servidor, `functions/api/privacy-consent.js`), no la de la aceptación original en el dispositivo. La hora original (`acceptedAt`) solo queda en la marca local y, para cuentas, en `profiles.privacy_accepted_at`. Confirmar con el abogado si basta o si hay que guardar también la hora original.
- Si el usuario borra el `localStorage` antes del reenvío, la marca se pierde. En ese caso el aviso vuelve a aparecer: el invitado ya no tiene la aceptación local y la cuenta no tiene `privacy_accepted_at`. Falla del lado seguro.

### A.6 Cómo probar en Preview

> El Preview escribe en la base de **producción**. Usa nombre **"QA Prueba"** y correo **`jbrichard27+qa@gmail.com`**, en una ventana privada. Al final, lista las filas creadas con ese correo; la decisión de borrarlas es del usuario.

1. **Error de red:** DevTools → Network → *Block request URL* `/api/privacy-consent`. Aceptar → el aviso sigue abierto con el mensaje, "Reintentar" y "Continuar de todos modos". No se crea ninguna fila.
2. **Respuesta no-OK:** en la consola, antes de aceptar:
   ```js
   const realFetch = window.fetch; window.fetch = (url, opts) => String(url).includes('/api/privacy-consent') ? Promise.resolve(new Response('{"error":"QA"}', { status: 502 })) : realFetch(url, opts);
   ```
   Mismo resultado que en 1.
3. **Continuar de todos modos:** con la falla activa, pulsarlo → entra a la terminal con el toast "Consentimiento guardado en este dispositivo; pendiente de registro.", se ve el banner de pendiente con "Reintentar" y existe `algo_privacy_pending_v1::jbrichard27+qa@gmail.com` en `localStorage`.
4. **Reenvío fallido:** recargar con el bloqueo activo → no aparece el aviso; aparece el banner de pendiente con "Reintentar".
5. **Reenvío correcto:** quitar el bloqueo y pulsar "Reintentar" (o recargar) → el banner desaparece, se borra la marca y se crea **una** fila en `privacy_consents` con ese correo.
6. **Camino feliz:** otra ventana privada, sin bloqueo → toast "Consentimiento de privacidad registrado." y una fila.

---

## B. Suscripción push + meta

### B.1 Archivos y líneas (en `f5ecc58`)

- `index.html:432`: botón "Sí" del aviso de meta (`portfolio-alert-yes`).
- `index.html:450-458`: `updatePushPermissionStatus` (Centro de Control).
- `index.html:462-485`: `ensurePushSubscription` y `subscribeAssetPush`.
- `index.html:494`: `push-enable-btn`.
- `functions/api/push/subscribe.js` (sin cambios: ya responde 400/502/503 con JSON).

### B.2 Causa

- En la l. 432 se lanza `void subscribeAssetPush(...)` sin esperar y, en la misma línea, se muestra **enseguida** "Meta establecida. Si aceptas el permiso del navegador…": antes del permiso y sin importar la respuesta de `/api/push/subscribe`.
- `subscribeAssetPush` (l. 483-484) no revisa `response.ok` y descarta los errores.
- El Centro de Control (l. 455) dice "Notificaciones push activas en este dispositivo." **solo porque el permiso del navegador es `granted`**, aunque el servidor nunca haya guardado la suscripción.

### B.3 Cambio

`subscribeAssetPush` devuelve uno de estos estados: `saved | denied | dismissed | unsupported | not-configured | subscribe-failed | server-error`. El estado se guarda en `algo_push_status_v1` (namespace del invitado) como `{ status, symbol, at }`. La meta siempre se guarda en el dispositivo.

| Resultado | Toast | Centro de Control |
|---|---|---|
| `saved` | "Meta y alerta activas. Te avisamos cuando tu activo se acerque a la meta o la alcance. Revisamos una vez al día, después del cierre." | "Notificaciones push activas en este dispositivo." (botón desactivado) |
| `denied` | "Meta guardada, pero sin alertas: bloqueaste las notificaciones en este navegador." | Texto actual de "Bloqueaste…" |
| `dismissed` | "Meta guardada. Para recibir alertas, acepta el permiso de notificaciones." | "Sin permiso concedido todavía…" + "Activar notificaciones push" |
| `server-error` / `subscribe-failed` / `not-configured` | "Meta guardada, pero no pudimos activar la alerta. Reintenta desde el Centro de Control." | "Permiso concedido, pero la alerta no quedó registrada en el servidor." + botón activo **"Reintentar registro"** |
| `unsupported` | "Meta guardada. Este navegador no admite notificaciones push." | "Este navegador no soporta notificaciones push." |
| Permiso concedido sin metas | — | "Permiso concedido. Fija una meta para activar una alerta." |
| Permiso concedido, con meta, sin registro confirmado (p. ej. metas de antes de este cambio) | — | "Permiso concedido. Pulsa "Registrar alerta" para confirmar tu meta en el servidor." + botón "Registrar alerta" *(agregado en la implementación)* |

- `push-enable-btn` usa el mismo estado. Si el último estado es una falla, reintenta el registro del activo de esa falla (si sigue con meta); si no, el del activo actual con meta. Muestra el mismo toast.
- `requestPermission` sigue siendo el **primer `await`** desde el clic (requisito de iOS/Safari).

### B.4 Riesgos

- Si algún `await` queda antes de `requestPermission`, Safari/iOS puede rechazar el permiso. Se mantiene el orden actual.
- Hay un solo espacio para toasts: el toast final reemplaza a cualquier otro. Es lo que se busca.
- Los reintentos no duplican filas: `/api/push/subscribe` hace upsert sobre `endpoint,asset_symbol`.
- `algo_push_status_v1` guarda solo el último intento del dispositivo. Si después se quita el activo de esa falla, el Centro de Control puede seguir mostrando "Reintentar registro" hasta el siguiente intento, que lo corrige.

### B.5 Cómo probar en Preview

> Mismas condiciones que A.6 (**"QA Prueba"**, **`jbrichard27+qa@gmail.com`**, base de producción). Los casos 1 y 4b crean filas en `push_subscriptions` con ese correo; al final se listan para que el usuario decida si se borran.

En un activo con historial agregado al portafolio, fijar una meta con doble toque en la gráfica → "Sí":

1. **Aceptar el permiso** → toast `saved`; el Centro de Control dice "Notificaciones push activas en este dispositivo.".
2. **Bloquear el permiso** (otro perfil o restablecer el permiso del sitio) → toast `denied`; Centro con "Bloqueaste…".
3. **Cerrar el aviso de permiso sin elegir** → toast `dismissed`; Centro con "Sin permiso concedido todavía…".
4. **Falla del servidor:** con el permiso concedido, bloquear `/api/push/subscribe` (o simular un 502 con el mismo truco de A.6) y fijar la meta → toast de falla; Centro con "Reintentar registro".
   - 4b. Quitar el bloqueo y pulsar "Reintentar registro" → toast `saved`; Centro con "Notificaciones push activas en este dispositivo.".
5. Revisar que el toast **no** aparezca antes de responder al permiso.

---

## C. `ccpa_do_not_sell = true` — verificado, sin bug

**Rastreo en el código** (sin valor fijo ni lógica invertida):

1. `index.html:215`: la casilla `privacy-ccpa-optout` no tiene `checked` y ningún código la marca.
2. `index.html:643`: `const ccpaOptOut = $('privacy-ccpa-optout').checked;`.
3. `index.html:646` y `:653`: se envía como `ccpaOptOut` en ambos flujos.
4. `functions/api/privacy-consent.js:10`: `body.ccpaOptOut === true`.
5. `functions/api/privacy-consent.js:41`: `ccpa_do_not_sell: ccpaOptOut` se envía siempre.
6. `schema.sql:210`: valor por defecto `false`.

**Evidencia del usuario (2026-10-09):**

- En producción, `column_default` de `ccpa_do_not_sell` es `false` y no hay triggers en `privacy_consents`.
- En el video de la prueba, revisado cuadro por cuadro, **la casilla CCPA sí se marcó** (~1 s antes de "Aceptar y continuar"). El `true` de la fila QA es correcto.

**Decisión:** se cierra sin cambios de código. No se agrega el resumen CCPA al toast.

**Pendiente para la Fase 4 (móvil):** revisar el área táctil de `.privacy-consent-line` (12 px de relleno; toda la caja responde al toque), porque es fácil marcar la casilla CCPA sin querer.

---

## D. Resultados de las pruebas en Preview (2026-10-09)

- **Preview:** `d7209df1` (commit `4e11bc5`). Datos de prueba: "QA Prueba" / `jbrichard27+qa@gmail.com`. Escribe en la base de **producción**.
- **Probó:** el usuario, con los pasos de A.6 y B.5.

### D.1 A. Consentimiento

| Prueba | Resultado |
|---|---|
| `/api/privacy-consent` bloqueado → Aceptar | El aviso **no se cierra**; aparecen "Reintentar" y "Continuar de todos modos". ✅ |
| "Continuar de todos modos" | Entra a la terminal y aparece el banner de pendiente en ese momento. ✅ |
| Quitar el bloqueo → "Reintentar" del banner | Registra el consentimiento y el banner desaparece. ✅ |
| Payload con la casilla CCPA sin marcar | `ccpaOptOut: false`. ✅ (confirma C) |

### D.2 B. Push + meta

| Prueba | Resultado |
|---|---|
| Permiso concedido | Toast "Meta y alerta activas…"; Centro de Control "Notificaciones push activas en este dispositivo.". ✅ |
| Permiso bloqueado (incógnito) | Toast de bloqueado y Centro de Control "Bloqueaste…". ✅ |
| `/api/push/subscribe` simulando 502 | Toast de falla; Centro de Control "Permiso concedido, pero la alerta no quedó registrada en el servidor." con "Reintentar registro". ✅ |
| Quitar la simulación → "Reintentar registro" | Centro de Control "activas". ✅ |
| Cerrar el aviso de permiso con la X (`dismissed`) | **No probado.** Queda para la revisión en el celular. |

### D.3 Conteo en Supabase (después de las pruebas)

- `privacy_consents`: **7** filas. Es lo esperado.
- `push_subscriptions`: **4** filas. Es lo esperado: el reintento hizo upsert sobre `endpoint,asset_symbol`, sin duplicar.

### D.4 Pendientes

1. **Prueba de la X en el celular:** cerrar el aviso de permiso sin elegir → toast `dismissed` y Centro de Control "Sin permiso concedido todavía…".
2. **Push real al celular el lunes 12-oct:** confirmar que llega la notificación después de la corrida diaria.
3. **Limpieza de filas QA:** las filas con `jbrichard27+qa@gmail.com` en `privacy_consents` y `push_subscriptions` de producción. La decisión de borrarlas es del usuario; el agente no ejecuta SQL.
4. **Fase 4 (móvil):** área táctil de `.privacy-consent-line` (ver C).
5. **Fase 7 (abogado):** `timestamp_aceptacion` en reintentos (ver A.5).
