# Novedades — DCDG Finanzas

Registro de lo que el sistema va ganando. Las entradas marcadas 🤖 las construyó
**Autobuild** (ver [AUTOBUILD.md](AUTOBUILD.md)) de forma autónoma; las demás son
cambios hechos en sesión.

El formato: fecha · qué se añadió · PR · estado (✅ en firme / 🔎 en revisión).

---

## 2026-07-25
- **Fix captura por correo: leer "Todos los correos" (All Mail), no solo INBOX**. Los filtros de Gmail archivan/etiquetan los avisos del banco y los sacan del INBOX, así que el cron no los veía (movimientos del correo no aparecían en la PWA). `gmail-imap.js`: `resolverMailbox()` ahora auto-detecta la carpeta `\All` de Gmail por su flag de uso especial (nombre localizado: "[Gmail]/All Mail" / "[Gmail]/Todos los mensajes"), e incluye archivados/etiquetados. Respeta `GMAIL_IMAP_MAILBOX` si se define; cae a INBOX si no encuentra `\All`. 5 tests. ✅

## 2026-07-24
- **Captura por correo (4/4, lado DCDG): pregunta por WhatsApp lo no identificado**. `_lib/silvia-preguntar.js`: cuando el cron encuentra un pendiente que no puede clasificar solo (v1: **transferencias**), le pregunta por WhatsApp —vía SilvIA— a la **persona dueña de la cuenta** (cuentas 5688/4550/3164/9354 → Carolina; el resto → Luis), con `preguntarSilvia()` (POST a `SILVIA_FINANZAS_PREGUNTA_URL` con secreto) e idempotencia por message-id (no re-pregunta aunque el cron corra cada hora). La respuesta de la persona la registra SilvIA con sus tools existentes (`registrar_gasto`/`registrar_transferencia`). Enganchado en `captura-cron.js` (best-effort, no tumba la corrida). Ingresos (carril Ahinoa) y gastos por QR sin comercio (recategorizar) quedan como fast-follows. 6 tests nuevos. Requiere el endpoint gemelo en `sl-crm-live`. ✅
- **Captura por correo (3/4): cron en el servidor (IMAP) + backfill on-demand**. La captura se movió a la **capa correcta**: en vez de una rutina de Claude (sesión sin salida a internet y con el token de Gmail que expira), ahora corre como **Netlify Scheduled Function** (`captura-cron.js`, `@hourly`) que sí tiene egress. `_lib/gmail-imap.js` lee las notificaciones bancarias por **IMAP en solo-lectura** con una App Password (`GMAIL_IMAP_USER`/`GMAIL_IMAP_PASSWORD` en el env), y `_lib/captura-scan.js` orquesta el barrido: trae los correos → `capturarCorreo` (registra el gasto) → contabiliza → arma un **digest** (registrados + pendientes de confirmar + ya-existían/excluidos/errores) que avisa por SilvIA. Todo idempotente por message-id (ventana rodante de ~2 días, releer no duplica). Endpoint manual `POST /api/capturar-scan` (`{desde:'YYYY-MM-DD'}`, carril token) para el **backfill** de julio y corridas on-demand, y variable `CAPTURA_BACKFILL_DESDE` para que el propio cron haga el barrido amplio una vez (útil cuando el egress externo está bloqueado). Deps: `imapflow` + `mailparser`. 8 tests nuevos (agregación del digest, contabilización best-effort, formato, ventana del cron). ✅
- **Captura por correo (2/4): orquestador + endpoint de captura**. `_lib/captura-correo.js`: `capturarCorreo({message_id, from, subject, body})` parsea la notificación y, si es un **gasto** reconocido, lo registra vía `registrarMovimiento` (que autoclasifica por comercio y ya deduplica) con **idempotencia por `message_id`** (`email:<id>` → un mismo correo nunca duplica); ingresos y transferencias vuelven como `pendiente` para que la rutina los rutee (Ahinoa, colapso de transferencias, préstamos, bolsillo educación). Endpoint token `POST /api/capturar-correo` (`makeCapturarCorreoHandler`, mismo carril que SilvIA) para que la rutina reenvíe cada correo. 8 tests nuevos. ✅
- **Captura por correo (1/4): parser de notificaciones bancarias + taxonomía nueva**. Primera pieza del sistema que leerá las notificaciones bancarias del correo y registrará los movimientos solo (el asiento sale automático). `_lib/email-parse.js` (función pura, 16 tests con correos reales): convierte una notificación de **Bancolombia** ("Compraste/Pagaste/Transferiste/Recibiste…") o **DolarApp/ARQ** ("Enviaste COP / Recibiste USD") en una transacción estructurada (clase gasto/ingreso/transferencia, monto en los dos formatos COP + US, cuenta por últimos 4 → dueño Luis/Carolina/Hijo, comercio/remitente/destino, fecha ISO), y **descarta** el ruido de seguridad (OTP, cambios de clave, "sospechosa") y las operaciones de **iWin** (PSE/proveedores/cuentas 5401/2997). Taxonomía: **Apoyo familiar** (Papás de Carolina / Papás de Luis / Otros familiares) y **Vivienda / Adecuaciones y mejoras**. Próximas piezas: endpoint de captura (dedup por message-id + contra SilvIA), rutina horaria, backfill de julio y hand-off a SilvIA para preguntar por WhatsApp lo no identificado. Solo `config` + `_lib` nuevo. ✅

## 2026-07-13 (autobuild, corrida nueva)
- 🔎 **Decimoquinta revisión del día, sin item elegible — mismo estado exacto,
  cero novedad de Luis**: reconfirmé todo lo de las catorce corridas
  anteriores de hoy. Los 4 issues `autobuild` abiertos siguen igual —
  `#40`/`#41`/`#92` con `autobuild-espera` y PR borrador `#58`/`#55`/`#96`
  (revisé comentarios de los tres: solo el bot de deploy preview de Netlify,
  cero comentario nuevo de Luis) y `#52` sigue siendo el issue "padre" ya
  dividido (`#91` fusionado, `#92` en espera con PR abierto — tomarlo
  directo duplicaría ese trabajo). Cero issues `propuesta` abiertos, así que
  no propongo una decimoquinta funcionalidad mientras ya hay 3 construidas
  esperando tu OK. El PR de Autofix `#211` sigue en borrador sin comentario
  nuevo. No repito notificación por WhatsApp porque no hay novedad alguna
  desde la corrida anterior (ya avisada) — este registro es la constancia.
  La rama designada (`claude/zealous-brown-xwddnv`) volvía a traer el mismo
  commit suelto ya fusionado del acceso completo del equipo (`5b93f81`,
  árbol idéntico al ya fusionado en PR #193/`301a06c`) — la recreé limpia
  desde `main`, igual que en las corridas anteriores con el mismo problema.

## 2026-07-13 (autobuild, corrida nueva)
- 🔎 **Decimocuarta revisión del día, sin item elegible — mismo estado exacto,
  cero novedad de Luis**: reconfirmé todo lo de las trece corridas anteriores
  de hoy. Los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92`
  con `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé comentarios
  de los tres: solo el bot de deploy preview de Netlify, cero comentario
  nuevo de Luis) y `#52` sigue siendo el issue "padre" ya dividido (`#91`
  fusionado, `#92` en espera con PR abierto — tomarlo directo duplicaría ese
  trabajo). Cero issues `propuesta` abiertos, así que no propongo una
  decimocuarta funcionalidad mientras ya hay 3 construidas esperando tu OK.
  El PR de Autofix `#211` sigue en borrador sin comentario nuevo. Ya avisé
  por WhatsApp en la corrida anterior sobre la antigüedad de la revisión
  pendiente (6 días en los PR de features) y la cadencia de disparo muy por
  encima de las ~3h previstas — no repito el aviso porque no hay novedad
  adicional que justifique otra notificación; este registro es la
  constancia.

## 2026-07-13 (autobuild, corrida nueva)
- 🔎 **Decimotercera revisión del día, sin item elegible — mismo estado exacto,
  cero novedad de Luis**: reconfirmé todo lo de las doce corridas anteriores de
  hoy. Los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92` con
  `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé comentarios de
  los tres: solo el bot de deploy preview de Netlify, cero comentario nuevo
  de Luis) y `#52` sigue siendo el issue "padre" ya dividido (`#91`
  fusionado, `#92` en espera con PR abierto — tomarlo directo duplicaría ese
  trabajo). Cero issues `propuesta` abiertos, así que no propongo una
  decimotercera funcionalidad mientras ya hay 3 construidas esperando tu OK.
  El PR de Autofix `#211` sigue en borrador sin comentario nuevo.
  **Nota de proceso**: los tres PR de features llevan **6 días** esperando
  revisión (creados el 07/07-07/08) y el de Autofix **1 día** (creado el
  07/12) — ninguno se moverá solo, necesitan tu decisión. Además, esta es ya
  la 13ª corrida de Autobuild **hoy**, muy por encima de la cadencia de
  ~3 horas prevista en AUTOBUILD.md — vale la pena revisar el cron que la
  dispara. No repito notificación por WhatsApp por el estado del backlog en
  sí (ya avisado en corridas previas), pero sí aviso aparte sobre la cadencia
  y la antigüedad de la revisión pendiente.

## 2026-07-13 (autobuild, corrida nueva)
- 🔎 **Duodécima revisión del día, sin item elegible — mismo estado exacto,
  cero novedad de Luis**: reconfirmé todo lo de las once corridas anteriores
  de hoy. Los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92`
  con `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé comentarios
  de los tres: solo el bot de deploy preview de Netlify, cero comentario
  nuevo de Luis) y `#52` sigue siendo el issue "padre" ya dividido (`#91`
  fusionado, `#92` en espera con PR abierto — tomarlo directo duplicaría ese
  trabajo). Confirmé también que la dependencia de `#52` (T5 `#48`) sigue
  fusionada en `main` (`_lib/mayor.js` existe desde antes de hoy). Cero
  issues `propuesta` abiertos, así que no propongo una duodécima
  funcionalidad mientras ya hay 3 construidas esperando tu OK. También
  revisé los issues de Autofix (`#210`, `#31`, PR borrador `#211`): ninguno
  lleva label `autobuild`, así que quedan fuera de este procedimiento, y
  `#211` sigue sin comentario nuevo. Como el estado de fondo es idéntico al
  de las corridas anteriores (que ya avisaron por WhatsApp), no repito
  notificación — este registro es la constancia. La rama designada
  (`claude/zealous-brown-31qtii`) volvía a traer el mismo commit suelto ya
  fusionado del acceso completo del equipo (`5b93f81`, árbol idéntico al ya
  fusionado en PR #193/`301a06c`) — la recreé limpia desde `main`, igual que
  en las corridas anteriores con el mismo problema.

## 2026-07-13 (autobuild, corrida nueva)
- 🔎 **Undécima revisión del día, sin item elegible — mismo estado exacto, cero
  novedad de Luis**: reconfirmé todo lo de las diez corridas anteriores de hoy.
  Los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92` con
  `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé comentarios de
  los tres: solo el bot de deploy preview de Netlify, cero comentario nuevo
  de Luis) y `#52` sigue siendo el issue "padre" ya dividido (`#91`
  fusionado, `#92` en espera con PR abierto — tomarlo directo duplicaría ese
  trabajo). Cero issues `propuesta` abiertos, así que no propongo una
  undécima funcionalidad mientras ya hay 3 construidas esperando tu OK.
  También revisé los issues de Autofix (`#210`, `#31`) y la épica `#111`:
  ninguno lleva label `autobuild`, así que quedan fuera de este
  procedimiento. Como el estado de fondo es idéntico al de las corridas
  anteriores (que ya avisaron por WhatsApp), no repito notificación — este
  registro es la constancia. La rama designada (`claude/zealous-brown-a9c1pf`)
  volvía a traer el mismo commit suelto ya fusionado del acceso completo del
  equipo (`5b93f81`, árbol idéntico al ya fusionado en PR #193/`301a06c`) —
  la recreé limpia desde `main`, igual que en las corridas anteriores con el
  mismo problema.

## 2026-07-13 (autobuild, corrida nueva)
- 🔎 **Décima revisión del día, sin item elegible — mismo estado exacto, cero
  novedad de Luis**: reconfirmé todo lo de las nueve corridas anteriores de
  hoy. Los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92` con
  `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé comentarios de
  los tres: solo el bot de deploy preview de Netlify, cero comentario nuevo
  de Luis) y `#52` sigue siendo el issue "padre" ya dividido (`#91`
  fusionado, `#92` en espera con PR abierto — tomarlo directo duplicaría ese
  trabajo). Cero issues `propuesta` abiertos, así que no propongo una décima
  funcionalidad mientras ya hay 3 construidas esperando tu OK. También revisé
  los issues de Autofix (`#210`, `#31`) y la épica `#111`: ninguno lleva
  label `autobuild`, así que quedan fuera de este procedimiento. Como el
  estado de fondo es idéntico al de las corridas anteriores (que ya
  avisaron por WhatsApp), no repito notificación — este registro es la
  constancia. La rama designada (`claude/zealous-brown-vohkop`) volvía a
  traer el mismo commit suelto ya fusionado del acceso completo del equipo
  (`5b93f81`, árbol idéntico al ya fusionado en PR #193/`301a06c`) — la
  recreé limpia desde `main`, igual que en las corridas anteriores con el
  mismo problema.

## 2026-07-13 (autobuild, corrida nueva)
- 🔎 **Novena revisión del día, sin item elegible — mismo estado exacto, cero
  novedad de Luis**: reconfirmé todo lo de las ocho corridas anteriores de
  hoy. Los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92` con
  `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé comentarios de
  los tres: solo el bot de deploy preview de Netlify, cero comentario nuevo
  de Luis) y `#52` sigue siendo el issue "padre" ya dividido (`#91`
  fusionado, `#92` en espera con PR abierto — tomarlo directo duplicaría ese
  trabajo). Cero issues `propuesta` abiertos, así que no propongo una novena
  funcionalidad mientras ya hay 3 construidas esperando tu OK. Revisé también
  la épica `#111`: sus 7 sub-issues (`#112`-`#118`) siguen fusionados desde
  el 2026-07-09, sin trabajo nuevo que sembrar. El PR `#211` (Autofix, no
  Autobuild) sigue en borrador esperando tu OK, sin cambios ni comentario
  nuevo. Como el estado de fondo es idéntico al de las corridas anteriores
  (que ya avisaron por WhatsApp), no repito notificación — este registro es
  la constancia. La rama designada (`claude/zealous-brown-oocq46`) volvía a
  traer el mismo commit suelto ya fusionado del acceso completo del equipo
  (`5b93f81`, árbol idéntico al ya fusionado en PR #193/`301a06c`) — la
  recreé limpia desde `main`, igual que en las corridas anteriores con el
  mismo problema.

## 2026-07-13 (autobuild, corrida nueva)
- 🔎 **Octava revisión del día, sin item elegible — mismo estado exacto, cero
  novedad de Luis**: los 4 issues `autobuild` abiertos siguen igual —
  `#40`/`#41`/`#92` con `autobuild-espera` y PR borrador `#58`/`#55`/`#96`
  (revisé comentarios: solo el bot de deploy preview de Netlify, cero
  comentario nuevo) y `#52` sigue siendo el issue "padre" ya dividido (`#91`
  fusionado, `#92` en espera con PR abierto). Cero issues `propuesta`
  abiertos, así que no propongo una octava funcionalidad mientras ya hay 3
  construidas esperando tu OK. El PR de Autofix `#211` sigue en borrador
  esperando tu OK, sin cambios. **Corrección de proceso**: el PR de la
  séptima revisión (`#220`) había quedado creado en **borrador** por error
  (rompiendo el patrón de auto-merge de estas entradas solo-CHANGELOG,
  sin riesgo) — lo pasé a listo para revisión y lo fusioné (CI verde,
  `Tests y build` ✅) antes de esta corrida. Como el estado de fondo es
  idéntico al de las corridas anteriores (que ya avisaron por WhatsApp), no
  repito notificación — este registro es la constancia.

## 2026-07-13 (autobuild, corrida nueva)
- 🔎 **Séptima revisión del día, sin item elegible — mismo estado exacto, cero
  novedad de Luis**: reconfirmé todo lo de las seis corridas anteriores de
  hoy. Los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92` con
  `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé los comentarios
  de los tres: solo el automático de deploy preview de Netlify, cero
  comentario nuevo de Luis) y `#52` sigue siendo el issue "padre" ya dividido
  (`#91` fusionado, `#92` en espera con PR abierto). Cero issues `propuesta`
  abiertos, así que no propongo una séptima funcionalidad mientras ya hay 3
  construidas esperando tu OK. El PR `#211` (Autofix, no Autobuild — fix de
  la regla `mercado-ara`) sigue en borrador esperando tu OK, sin cambios ni
  comentario nuevo. Como el estado es idéntico al de las seis corridas
  anteriores de hoy (que ya avisaron), no repito notificación — este
  registro es la constancia. La rama designada (`claude/zealous-brown-98c7jv`)
  volvía a traer el mismo commit suelto ya fusionado del acceso completo del
  equipo (`5b93f81`, árbol idéntico al ya fusionado en PR #193/`301a06c`) —
  la recreé limpia desde `main`, igual que en las corridas anteriores con el
  mismo problema.

## 2026-07-13 (autobuild, corrida nueva)
- 🔎 **Sexta revisión del día, sin item elegible — mismo estado exacto, cero
  novedad de Luis**: reconfirmé todo lo de las cinco corridas anteriores de
  hoy. Los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92` con
  `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé los comentarios
  de los tres: solo el automático de deploy preview de Netlify, cero
  comentario nuevo de Luis) y `#52` sigue siendo el issue "padre" ya dividido
  (`#91` fusionado, `#92` en espera con PR abierto). Cero issues `propuesta`
  abiertos, así que no propongo una sexta funcionalidad mientras ya hay 3
  construidas esperando tu OK. El PR `#211` (Autofix, no Autobuild — fix de
  la regla `mercado-ara`) sigue en borrador esperando tu OK, sin cambios ni
  comentario nuevo desde que preguntó "¿Aprobás el merge de #211?". Como el
  estado es idéntico al de las cinco corridas anteriores de hoy (que ya
  avisaron), no repito notificación — este registro es la constancia. La
  rama designada (`claude/zealous-brown-899pqb`) volvía a traer el mismo
  commit suelto ya fusionado del acceso completo del equipo (`5b93f81`,
  árbol idéntico al ya fusionado en PR #193/`301a06c`) — la recreé limpia
  desde `main`, igual que en las corridas anteriores con el mismo problema.

## 2026-07-13 (autobuild, corrida nueva)
- 🔎 **Quinta revisión del día, sin item elegible — mismo estado exacto, cero
  novedad de Luis**: reconfirmé todo lo de las cuatro corridas anteriores de
  hoy. Los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92` con
  `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé los comentarios
  de los tres: solo el automático de deploy preview de Netlify, cero
  comentario nuevo de Luis) y `#52` sigue siendo el issue "padre" ya dividido
  (`#91` fusionado, `#92` en espera con PR abierto). Cero issues `propuesta`
  abiertos y cero issues `autofix` abiertos, así que no propongo una quinta
  funcionalidad. El PR `#211` (Autofix, no Autobuild — fix de la regla
  `mercado-ara`) sigue en borrador esperando tu OK, sin cambios ni comentario
  nuevo. Como el estado es idéntico al de las cuatro corridas anteriores de
  hoy (que ya avisaron), no repito notificación — este registro es la
  constancia. La rama designada (`claude/zealous-brown-fkjo2l`) volvía a
  traer el mismo commit suelto ya fusionado del acceso completo del equipo
  (`5b93f81`, árbol idéntico al ya fusionado en PR #193/`301a06c`) — la
  recreé limpia desde `main`, igual que en las corridas anteriores con el
  mismo problema.

## 2026-07-13 (autobuild, corrida nueva)
- 🔎 **Cuarta revisión del día, sin item elegible — mismo estado exacto, cero
  novedad de Luis**: reconfirmé todo lo de las tres corridas anteriores de
  hoy. Los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92` con
  `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé los comentarios
  de los tres: solo el automático de deploy preview de Netlify, cero
  comentario nuevo de Luis) y `#52` sigue siendo el issue "padre" ya dividido
  (`#91` fusionado, `#92` en espera con PR abierto). Cero issues `propuesta`
  abiertos, así que no propongo una quinta funcionalidad. El PR `#211`
  (Autofix, no Autobuild — fix de la regla `mercado-ara`) sigue en borrador
  esperando tu OK, sin cambios ni comentario nuevo. Como el estado es
  idéntico al de las tres corridas anteriores de hoy (que ya avisaron), no
  repito notificación — este registro es la constancia. La rama designada
  (`claude/zealous-brown-sh0wku`) volvía a traer el mismo commit suelto ya
  fusionado del acceso completo del equipo (`5b93f81`, árbol idéntico al ya
  fusionado en PR #193/`301a06c`) — la recreé limpia desde `main`, igual que
  en las corridas anteriores con el mismo problema.

## 2026-07-13 (autobuild, corrida nueva)
- 🔎 **Tercera revisión del día, sin item elegible — mismo estado exacto,
  cero novedad de Luis**: reconfirmé todo lo de las dos corridas anteriores
  de hoy. Los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92`
  con `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé los
  comentarios de los tres: solo el automático de deploy preview de Netlify,
  cero comentario nuevo de Luis) y `#52` sigue siendo el issue "padre" ya
  dividido (`#91` fusionado, `#92` en espera con PR abierto). Cero issues
  `propuesta` abiertos, así que no propongo una quinta funcionalidad. El PR
  `#211` (Autofix, no Autobuild — fix de la regla `mercado-ara`) sigue en
  borrador esperando tu OK, sin cambios. Como el estado es idéntico al de
  las dos corridas anteriores de hoy (que ya avisaron), no repito
  notificación — este registro es la constancia. La rama designada
  (`claude/zealous-brown-zongvv`) volvía a traer el mismo commit suelto ya
  fusionado del acceso completo del equipo (`5b93f81`, árbol idéntico al ya
  fusionado en PR #193/`301a06c`) — la recreé limpia desde `main`, igual que
  en las corridas anteriores con el mismo problema.

## 2026-07-13 (autobuild, corrida nueva)
- 🔎 **Segunda revisión del día, sin item elegible — mismo estado, sin novedad
  de Luis**: reconfirmé todo lo de la corrida anterior de hoy. Los 4 issues
  `autobuild` abiertos siguen igual — `#40`/`#41`/`#92` con `autobuild-espera`
  y PR borrador `#58`/`#55`/`#96` (sin comentario nuevo de Luis) y `#52` sigue
  siendo el issue "padre" ya dividido (`#91` fusionado, `#92` en espera con PR
  abierto — tomarlo directo duplicaría ese trabajo). Cero issues `propuesta`
  abiertos; los 7 sub-issues de la épica `#111` (`#112`-`#118`) siguen todos
  fusionados, sin trabajo nuevo que sembrar de ahí. No propongo una quinta
  funcionalidad mientras las tres sensibles siguen sin tu OK. El PR `#211`
  (Autofix, fix de la regla `mercado-ara`) sigue en borrador esperando tu OK,
  sin cambios. Como el estado es idéntico al de la corrida anterior de hoy
  (que ya avisó), no repito notificación. La rama designada
  (`claude/zealous-brown-ybvr1n`) volvía a traer el mismo commit suelto no
  fusionado del acceso completo del equipo (`5b93f81`, árbol idéntico al ya
  fusionado en PR #193/`301a06c`) — la recreé limpia desde `main`, igual que
  en corridas anteriores con el mismo problema.

## 2026-07-13 (autobuild, corrida nueva)
- 🔎 **Cola revisada, sin item elegible — mismo estado desde hace 6 días
  (2026-07-08 → 2026-07-13), sin novedad de Luis**: los 4 issues `autobuild`
  abiertos siguen igual — `#40`/`#41`/`#92` con `autobuild-espera` y PR
  borrador `#58`/`#55`/`#96` (revisé los comentarios de los tres de nuevo:
  solo el automático de deploy preview de Netlify, cero comentario nuevo de
  Luis) y `#52` sigue siendo el issue "padre" ya dividido (`#91` fusionado,
  `#92` en espera con PR abierto — tomarlo directo duplicaría ese trabajo).
  Cero issues `propuesta` abiertos. **Revisé también la épica `#111`**
  ("nuestro/tuyo/mío") por si tenía sub-issues sin crear que alimentaran la
  cola (sus propios términos dicen que sus sub-issues llevan `autobuild` +
  `auto-ok` y se ejecutan solos) — pero sus 7 sub-issues (`#112`-`#118`,
  incluida la Fundación de dueño/bolsillo por cuenta) ya están **fusionados**
  desde el 2026-07-09, así que ahí tampoco hay trabajo nuevo que sembrar. No
  propongo una quinta funcionalidad mientras las tres sensibles siguen sin tu
  OK. El PR `#211` (Autofix, no Autobuild — fix de la regla `mercado-ara`)
  sigue en borrador esperando tu OK, sin cambios. Como el estado de la cola de
  features es idéntico al de las corridas anteriores (que ya avisaron por este
  mismo motivo varias veces), no repito notificación para no duplicar el
  aviso; este registro es la constancia de la re-verificación. La rama
  designada (`claude/zealous-brown-cgsakz`) volvía a traer el mismo commit
  suelto no fusionado del acceso completo del equipo (`5b93f81`, árbol
  idéntico al ya fusionado en PR #193/`301a06c`) — la recreé limpia desde
  `main`, igual que en corridas anteriores con el mismo problema.

## 2026-07-12 (autobuild, corrida nueva)
- 🔎 **Cola revisada otra vez, sin item elegible — mismo estado, sin novedad de
  Luis**: los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92`
  con `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé los
  comentarios de los tres de nuevo: solo el automático de deploy preview de
  Netlify, cero comentario nuevo de Luis) y `#52` sigue siendo el issue
  "padre" ya dividido (`#91` fusionado, `#92` en espera con PR abierto —
  tomarlo directo duplicaría ese trabajo). Cero issues `propuesta` abiertos,
  así que no propongo una quinta funcionalidad mientras las tres sensibles
  siguen sin tu OK. Noté de paso el PR `#211` (Autofix, no Autobuild — fix de
  la regla `mercado-ara` en borrador esperando tu OK), que no cambia nada en
  esta cola. Como el estado de la cola de features es idéntico al de las
  corridas anteriores de hoy (que ya avisaron por este mismo motivo), no
  repito notificación para no duplicar el aviso; este registro es la
  constancia de la re-verificación. La rama designada
  (`claude/zealous-brown-rwmmxr`) volvía a traer el mismo commit suelto no
  fusionado del acceso completo del equipo (`5b93f81`, árbol idéntico al ya
  fusionado en PR #193/`301a06c`) — la recreé limpia desde `main`, igual que
  en corridas anteriores con el mismo problema.

## 2026-07-12 (autobuild, corrida nueva)
- 🔎 **Cola revisada otra vez, sin item elegible — mismo estado, sin novedad de
  Luis**: los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92`
  con `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé los
  comentarios de los tres: sin nada nuevo de Luis) y `#52` sigue bloqueado
  como issue "padre" ya dividido (`#91` fusionado, `#92` en espera con PR
  abierto — tomarlo directo duplicaría ese trabajo). Cero issues `propuesta`
  abiertos y cero issues `autobuild` sin `autobuild-espera`/PR, así que no
  propongo una quinta funcionalidad mientras las tres sensibles siguen sin tu
  OK. Lo único nuevo desde la última corrida es el PR `#211` (Autofix, no
  Autobuild — fix de la regla `mercado-ara` en borrador esperando tu OK, no
  afecta esta cola). Como el estado de la cola de features es idéntico al de
  las corridas anteriores de hoy (que ya avisaron por este mismo motivo), no
  repito notificación para no duplicar el aviso; este registro es la
  constancia de la re-verificación. La rama designada
  (`claude/zealous-brown-l8fgr5`) volvía a traer el mismo commit suelto no
  fusionado del acceso completo del equipo (`5b93f81`, árbol idéntico al ya
  fusionado en PR #193/`301a06c`) — la recreé limpia desde `main`, igual que
  en corridas anteriores con el mismo problema.

## 2026-07-12 (autobuild, corrida nueva)
- 🔎 **Cola revisada otra vez, sin item elegible — mismo estado, sin novedad de
  Luis**: los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92`
  con `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé de nuevo los
  comentarios de los tres: nada nuevo de Luis) y `#52` sigue siendo el issue
  "padre" ya dividido en sub-issues (`#91` fusionado, `#92` en espera con PR
  abierto — tomarlo directo duplicaría ese trabajo). Cero issues `propuesta`
  abiertos y cero `autofix` abiertos, así que no propongo una quinta
  funcionalidad mientras las tres sensibles siguen sin tu OK. Como el estado
  es idéntico al de las corridas anteriores de hoy (que ya avisaron por este
  mismo motivo), no repito notificación para no duplicar el aviso; este
  registro es la constancia de la re-verificación. La rama designada
  (`claude/zealous-brown-7mq227`) volvía a traer el mismo commit suelto no
  fusionado del acceso completo del equipo (`5b93f81`, árbol idéntico al ya
  fusionado en PR #193/`301a06c`) — la recreé limpia desde `main`, igual que
  en corridas anteriores con el mismo problema.

## 2026-07-12 (autobuild, corrida nueva)
- 🔎 **Cola revisada otra vez, sin item elegible — mismo estado, sin novedad de
  Luis**: los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92`
  con `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé de nuevo los
  comentarios de los tres: solo el automático de deploy preview de Netlify,
  cero comentario nuevo de Luis) y `#52` sigue siendo el issue "padre" ya
  dividido en sub-issues (`#91` fusionado, `#92` es el que sigue en espera).
  Confirmé `#48` (T5, la dependencia bloqueante de `#52`) sigue fusionado
  desde hace días — no cambia nada. Cero issues `propuesta` abiertos y cero
  `autofix` abiertos, así que no propongo una quinta funcionalidad mientras
  las tres sensibles siguen sin tu OK. Como el estado es idéntico al de las
  corridas anteriores de hoy (que ya avisaron por este mismo motivo), no
  repito notificación para no duplicar el aviso; este registro es la
  constancia de la re-verificación. La rama designada
  (`claude/zealous-brown-hqamm7`) volvía a traer el mismo commit suelto no
  fusionado del acceso completo del equipo (`5b93f81`, idéntico al ya
  fusionado en PR #193) — la recreé limpia desde `main`, igual que en
  corridas anteriores con el mismo problema.

## 2026-07-12 (autobuild, corrida nueva)
- 🔎 **Cola revisada otra vez, sin item elegible — mismo estado, sin novedad de
  Luis**: los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92`
  con `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé de nuevo los
  comentarios de los tres PRs: solo el automático de deploy preview de
  Netlify, cero comentario nuevo de Luis) y `#52` sigue siendo el issue
  "padre" ya dividido en sub-issues (`#91` fusionado, `#92` es el que sigue en
  espera con PR abierto). Confirmé que la épica `#111` (contabilidad familiar)
  no tiene sub-issues pendientes: los 7 splits (`#112`-`#118`) y los 7
  "Nocturno" (`#72`-`#78`) ya están todos fusionados. Cero issues `propuesta`
  abiertos (ya no llevan esa etiqueta, pero siguen fuera de la cola por tener
  PR abierto) y cero `autofix` abiertos, así que no propongo una quinta
  funcionalidad mientras las tres sensibles siguen sin tu OK. No repito el
  aviso de WhatsApp/push para no duplicar — el estado es idéntico al de las
  corridas anteriores de hoy, que ya avisaron por este mismo motivo. La rama
  designada (`claude/zealous-brown-rcfpec`) volvía a traer el mismo commit
  suelto no fusionado del acceso completo del equipo (`5b93f81`, idéntico al
  ya fusionado en PR #193) — la recreé limpia desde `main`, igual que en
  corridas anteriores con el mismo problema.

## 2026-07-12 (autobuild, corrida nueva)
- 🔎 **Cola revisada otra vez, sin item elegible — mismo estado, sin novedad de
  Luis**: los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92`
  con `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé de nuevo los
  comentarios de los tres: solo el automático de deploy preview de Netlify,
  cero comentario nuevo de Luis) y `#52` sigue siendo el issue "padre" ya
  dividido en sub-issues (`#91` fusionado, `#92` es el que sigue en espera).
  Cero issues `propuesta` abiertos y cero `autofix` abiertos, así que no
  propongo una quinta funcionalidad mientras las tres sensibles siguen sin tu
  OK. Como el estado es idéntico al de las corridas anteriores de hoy (que ya
  avisaron por este mismo motivo), no repito notificación para no duplicar el
  aviso; este registro es la constancia de la re-verificación. La rama
  designada (`claude/zealous-brown-6jylis`) traía otra vez el mismo commit
  suelto no fusionado del acceso completo del equipo (`5b93f81`, idéntico al
  ya fusionado en PR #193) — la recreé limpia desde `main`, igual que en
  corridas anteriores con el mismo problema.

## 2026-07-12 (autobuild, corrida nueva)
- 🔎 **Cola revisada otra vez, sin item elegible — mismo estado, sin novedad de
  Luis**: los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92`
  con `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé de nuevo los
  comentarios de los tres: solo el automático de deploy preview de Netlify,
  cero comentario nuevo de Luis) y `#52` sigue siendo el issue "padre" ya
  dividido en sub-issues (`#91` fusionado, `#92` es el que sigue en espera).
  Cero issues `propuesta` abiertos y cero `autofix` abiertos, así que no
  propongo una quinta funcionalidad mientras las tres sensibles siguen sin tu
  OK. Como el estado es idéntico al de las corridas anteriores de hoy (que ya
  avisaron por este mismo motivo), no repito notificación para no duplicar el
  aviso; este registro es la constancia de la re-verificación. La rama
  designada (`claude/zealous-brown-aej1cu`) traía otra vez el mismo commit
  suelto no fusionado del acceso completo del equipo (`5b93f81`, idéntico al
  ya fusionado en PR #193) — la recreé limpia desde `main`, igual que en
  corridas anteriores con el mismo problema.

## 2026-07-12 (autobuild, corrida nueva)
- 🔎 **Cola revisada otra vez, sin item elegible — mismo estado, sin novedad de
  Luis**: los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92`
  con `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé de nuevo los
  comentarios de los tres: solo el automático de deploy preview de Netlify,
  cero comentario nuevo de Luis) y `#52` sigue siendo el issue "padre" ya
  dividido en sub-issues (`#91` fusionado, `#92` es el que sigue en espera).
  Cero issues `propuesta` abiertos y cero `autofix` abiertos, así que no
  propongo una quinta funcionalidad mientras las tres sensibles siguen sin tu
  OK. Como el estado es idéntico al de la corrida anterior de hoy (que ya
  avisó por este mismo motivo), no repito notificación para no duplicar el
  aviso; este registro es la constancia de la re-verificación. La rama
  designada (`claude/zealous-brown-my4l3n`) no existía todavía en el remoto —
  la creé limpia desde `main`.

## 2026-07-12 (autobuild, corrida nueva)
- 🔎 **Cola revisada otra vez, sin item elegible — mismo estado, sin novedad de
  Luis**: los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92`
  con `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé de nuevo los
  comentarios de los tres: solo el automático de deploy preview de Netlify,
  cero comentario nuevo de Luis) y `#52` sigue siendo el issue "padre" ya
  dividido en sub-issues (`#91` fusionado, `#92` es el que sigue en espera).
  Cero issues `propuesta` abiertos y cero `autofix` abiertos, así que no
  propongo una quinta funcionalidad mientras las tres sensibles siguen sin tu
  OK. Como el estado es idéntico al de las corridas anteriores de hoy (que ya
  avisaron por este mismo motivo), no repito notificación para no duplicar el
  aviso; este registro es la constancia de la re-verificación. La rama
  designada (`claude/zealous-brown-ut9oc4`) volvía a traer el mismo commit
  suelto no fusionado del acceso completo del equipo (`5b93f81`, idéntico al
  ya fusionado en PR #193) — la recreé limpia desde `main`, igual que en
  corridas anteriores con el mismo problema.

## 2026-07-12 (autobuild, corrida nueva)
- 🔎 **Cola revisada otra vez, sin item elegible — mismo estado, sin novedad de
  Luis**: los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92`
  con `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé de nuevo los
  comentarios de los tres: solo el automático de deploy preview de Netlify,
  cero comentario nuevo de Luis desde 2026-07-07/08) y `#52` sigue siendo el
  issue "padre" ya dividido en sub-issues (`#91` fusionado, `#92` es el que
  sigue en espera). Cero issues `propuesta` abiertos y cero `autofix`
  abiertos, así que no propongo una quinta funcionalidad mientras las tres
  sensibles siguen sin tu OK. Como el estado es idéntico al de las corridas
  anteriores de hoy (que ya avisaron por este mismo motivo), no repito
  notificación para no duplicar el aviso; este registro es la constancia de
  la re-verificación. La rama designada (`claude/zealous-brown-baoa05`) traía
  otra vez el mismo commit suelto no fusionado del acceso completo del equipo
  (`5b93f81`, idéntico al ya fusionado en PR #193) — la recreé limpia desde
  `main`, igual que en corridas anteriores con el mismo problema.

## 2026-07-12 (autobuild, corrida nueva)
- 🔎 **Cola revisada otra vez, sin item elegible — mismo estado, sin novedad de
  Luis**: los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92`
  con `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé de nuevo los
  comentarios de los tres: solo el automático de deploy preview de Netlify,
  cero comentario nuevo de Luis) y `#52` sigue siendo el issue "padre" ya
  dividido en sub-issues (`#91` fusionado, `#92` es el que sigue en espera).
  Cero issues `propuesta` abiertos y cero `autofix` abiertos, así que no
  propongo una quinta funcionalidad mientras las tres sensibles siguen sin tu
  OK. Como el estado es idéntico al de la corrida anterior de hoy (que ya
  avisó por este mismo motivo), no repito notificación para no duplicar el
  aviso; este registro es la constancia de la re-verificación. La rama
  designada (`claude/zealous-brown-ejgx4n`) volvía a traer el commit suelto no
  fusionado del acceso completo del equipo (`5b93f81`, idéntico al ya
  fusionado en PR #193) — la recreé limpia desde `main`, igual que en corridas
  anteriores con el mismo problema.

## 2026-07-12 (autobuild, corrida nueva)
- 🔎 **Cola revisada otra vez, sin item elegible — mismo estado, sin novedad de
  Luis**: los 4 issues `autobuild` abiertos siguen igual — `#40`/`#41`/`#92`
  con `autobuild-espera` y PR borrador `#58`/`#55`/`#96` (revisé los
  comentarios de los tres: solo el automático de deploy preview de Netlify,
  cero actividad nueva de Luis desde 2026-07-07/08, ya van 5 días esperando
  revisión) y `#52` sigue siendo el issue "padre" ya dividido en sub-issues
  (`#91` fusionado, `#92` es el que sigue en espera). Cero issues `propuesta`
  abiertos y cero `autofix` abiertos, así que no propongo una quinta
  funcionalidad mientras las tres sensibles siguen sin tu OK. Como el estado
  es idéntico al de las corridas anteriores de hoy (que ya avisaron por este
  mismo motivo), no repito notificación para no duplicar el aviso; este
  registro es la constancia de la re-verificación. La rama designada
  (`claude/zealous-brown-zoo792`) volvía a traer el commit suelto no
  fusionado del acceso completo del equipo (`5b93f81`, idéntico al ya
  fusionado en PR #193) — la recreé limpia desde `main`, igual que en
  corridas anteriores con el mismo problema.

## 2026-07-13
- **Acceso completo para el equipo financiero/contable**: los roles del equipo (`admin_financiero`, `tesoreria`, `contador` — Angela, María Isabel, Santiago, ya sembrados en `usuarios`) tenían acceso de **solo lectura** porque el gate de escritura (`esOwner`) solo aceptaba `owner`. Luis pidió que el equipo pueda **ingresar datos manualmente y consultarlos** (red de seguridad ante errores del proceso automático). Ahora hay un conjunto `ROLES_ESCRITURA = {owner, admin_financiero, tesoreria, contador}` que habilita captura/edición/correcciones/pagos tanto en el backend (`handlers.js`) como en el frontend (`dashboard.js` — botón "Corregir"). Solo `solo_lectura` (y roles desconocidos) queda restringido a consulta. Los mensajes 403 pasan de "Solo Luis o Carolina…" a "Tu rol no tiene permiso…". `handlers.js` + `dashboard.js` (+ textos en varias pantallas). ✅

## 2026-07-12 (autobuild, corrida nueva)
- 🔎 **Cola revisada otra vez, sin item elegible — sin novedad desde la corrida
  anterior**: los 3 issues `autobuild` abiertos con PR borrador siguen igual —
  `#40`/`#41`/`#92` con `autobuild-espera` y PR `#58`/`#55`/`#96` (revisé los
  comentarios de los tres: solo el automático de deploy preview de Netlify,
  cero actividad nueva de Luis desde 2026-07-07/08). `#52` sigue de tracking
  (padre ya dividido: `#91` fusionado, `#92` es el que sigue en espera). Cero
  `propuesta` nueva, cero `autofix` abierto — no propongo una quinta
  funcionalidad mientras las tres sensibles siguen sin tu OK. Como el estado
  es idéntico al de la corrida anterior (que ya avisó por este mismo motivo),
  no repito notificación para no duplicar el aviso; este registro es la
  constancia de la re-verificación. La rama designada
  (`claude/zealous-brown-l3sqfq`) traía un commit suelto no fusionado
  (acceso completo del equipo, ya integrado a `main` vía PR #193) y venía
  atrás en el CHANGELOG — la recreé limpia desde `main`.

## 2026-07-12 (autobuild, corrida nueva)
- 🧹 **Limpieza: cerré #98 y #51 (obsoletos)** — el PR #193 (acceso completo del
  equipo financiero/contable, fusionado en la corrida interactiva de anoche)
  hizo explícito que el portal solo-lectura ya no se quiere: Luis mismo cerró
  el PR #103 (que construía #98) con el comentario "cerrado por decisión de
  Luis... este portal solo-lectura queda descartado". Cerré **#98** (T8b,
  portal solo-lectura) con `not_planned` referenciando esa decisión, y cerré
  **#51** (el padre, T8/roles+portal) como `completed` — su otra mitad (T8a,
  roles de backend, #97) ya estaba fusionada desde el PR #99. Con esto la cola
  de `autobuild` baja de 6 a 4 issues abiertos.
- 🔎 **Cola revisada, sin item elegible nuevo — quedan 4 issues, todos
  esperando revisión**: `#40`/`#41`/`#92` con `autobuild-espera` y PR borrador
  `#58`/`#55`/`#96` (revisé los comentarios de los tres: solo el automático de
  deploy preview de Netlify, cero actividad nueva de Luis desde 2026-07-07/08)
  y `#52` sigue siendo el issue "padre" ya dividido en sub-issues (`#91`
  fusionado, `#92` es el que sigue en espera). Cero `propuesta` nueva, cero
  `autofix` abierto — sigo sin proponer una quinta funcionalidad mientras las
  tres sensibles (`#58`/`#55`/`#96`) siguen sin tu OK. La rama designada
  (`claude/zealous-brown-mec7te`) no existía todavía en el remoto — la creé
  limpia desde `main` (sin commits sueltos que arrastrar esta vez).
- 🔎 **Cola revisada otra vez, sin item elegible — sin cambios desde la corrida
  anterior de hoy**: los 6 issues `autobuild` abiertos siguen igual —
  `#40`/`#41`/`#92`/`#98` con `autobuild-espera` y PR borrador
  `#58`/`#55`/`#96`/`#103` (revisé los comentarios de los cuatro: solo el
  automático de deploy preview de Netlify, cero actividad nueva de Luis) y
  `#51`/`#52` siguen siendo los issues "padre" ya divididos en sub-issues.
  Cero `propuesta` nueva, cero `autofix` abierto, así que sigo sin proponer
  una quinta funcionalidad. El PR #193 (acceso completo del equipo
  financiero/contable, de la sesión interactiva aparte) sigue abierto en
  borrador sin cambios — tampoco lo toco desde aquí. Como el estado es
  idéntico al de la corrida anterior de hoy (que ya avisó por este mismo
  motivo), no repito notificación para no duplicar el aviso; este registro es
  la constancia de la re-verificación. La rama designada
  (`claude/zealous-brown-39whkz`) volvía a traer el commit suelto no
  fusionado de PR #193 (`69f95d7`) — la recreé limpia desde `main`, igual que
  en corridas anteriores con el mismo problema.

## 2026-07-12 (autobuild, corrida nueva)
- 🔎 **Cola revisada otra vez, sin item elegible — mismo estado que la corrida
  anterior de hoy, sin novedad de Luis en los 4 PR borrador**: los 6 issues
  `autobuild` abiertos siguen igual — `#40`/`#41`/`#92`/`#98` con
  `autobuild-espera` y PR borrador `#58`/`#55`/`#96`/`#103` (revisé los
  comentarios de los cuatro: solo el automático de deploy preview de Netlify,
  nada de Luis) y `#51`/`#52` siguen siendo los issues "padre" ya divididos en
  sub-issues. Cero `propuesta` nueva, cero `autofix` abierto, así que sigo sin
  proponer una quinta funcionalidad. **Novedad que sí vale registrar**: apareció
  el PR #193 (`claude/silvia-whatsapp-financial-module-k20fu6`, de una sesión
  interactiva aparte, no de esta rutina), que le da acceso de escritura
  completo a Angela/María Isabel/Santiago y dice explícitamente que "el
  portal solo-lectura de #103 queda descartado" (decisión de Luis tomada
  fuera de este proceso) — pero el propio PR aclara "puedo cerrar #103 cuando
  me confirmes", así que todavía no está cerrado. No toco #98/#103 ni ese PR
  desde aquí (no es parte de la cola de Autobuild ni de mi mandato en esta
  corrida), lo dejo anotado para que se resuelva en esa conversación. Como ya
  se mandó el aviso nativo de esta sesión más temprano hoy por este mismo
  estado (4 PR sin revisar), no repito notificación ahora para no duplicar el
  aviso — este registro es la constancia de la re-verificación.
- 🔎 **Cola revisada, sin item elegible — mismo estado, ahora van 5 días
  (2026-07-08 → 2026-07-12) sin que Luis toque los 4 PR borrador**: verifiqué
  de nuevo los 6 issues `autobuild` abiertos — `#40`/`#41`/`#92`/`#98` siguen
  `autobuild-espera` con PR borrador abierto (`#58`/`#55`/`#96`/`#103`, todos
  `SENSIBLE`/candado) y sin ningún comentario nuevo de Luis (solo el
  automático de deploy preview de Netlify en los cuatro). `#51`/`#52` siguen
  siendo los issues "padre" ya divididos en sub-issues (`#91`/`#97`
  fusionados, `#92`/`#98` son justo los PR en espera de arriba). Cero issues
  con label `propuesta` abiertos y cero `autofix` abiertos, así que no
  propongo una quinta funcionalidad mientras cuatro siguen sin revisar.
  `AUTOBUILD_NOTIFY_URL`/`AUTOBUILD_NOTIFY_SECRET` siguen sin estar en el
  entorno de esta sesión, así que el WhatsApp de SilvIA no se puede mandar
  desde aquí; este registro y una notificación por el canal nativo de esta
  sesión son el aviso real que le llega a Luis esta vez. La rama designada
  (`claude/zealous-brown-ncs8yr`) traía un commit suelto no fusionado de otra
  rama (`69f95d7`, el de PR #193 en curso) — la recreé limpia desde `main`
  para no arrastrarlo a un PR ajeno a esta corrida.

## 2026-07-11 (autobuild, corrida nueva)
- 🔎 **Cola revisada, sin item elegible — mismo estado, ahora van 4 días
  (2026-07-08 → 2026-07-11) sin que Luis toque los 4 PR borrador**: verifiqué
  de nuevo los 6 issues `autobuild` abiertos — `#40`/`#41`/`#92`/`#98` siguen
  `autobuild-espera` con PR borrador abierto (`#58`/`#55`/`#96`/`#103`, todos
  `SENSIBLE`/candado, esperando OK explícito) y `#51`/`#52` siguen siendo los
  issues "padre" ya divididos (sus sub-issues son justo `#92`/`#98`, ya en
  la cola). Cero issues con label `propuesta` abiertos — no hay nada que
  proponer una quinta vez. Todos los 18 issues `auto-ok` de la épica #111 y
  de los "Nocturnos" ya están `CLOSED`/fusionados, así que tampoco hay
  trabajo `auto-ok` pendiente. **Nota para Luis**: esta es, contando las de
  hoy, la corrida número quince que encuentra exactamente esta misma pila —
  el proceso está funcionando bien (verifica, no rehace, no inventa trabajo
  fuera de la cola), pero está genuinamente parado hasta que revises al
  menos uno de los 4 PR: [#58](https://github.com/luchodelcast/finanzas_dcdg/pull/58) config-como-datos,
  [#55](https://github.com/luchodelcast/finanzas_dcdg/pull/55) backup DB→Sheet,
  [#96](https://github.com/luchodelcast/finanzas_dcdg/pull/96) cierre mensual,
  [#103](https://github.com/luchodelcast/finanzas_dcdg/pull/103) portal solo-lectura.
  `AUTOBUILD_NOTIFY_URL`/`AUTOBUILD_NOTIFY_SECRET` no están en el entorno de
  esta sesión, así que el WhatsApp de SilvIA no se puede mandar desde aquí
  (igual que en corridas anteriores) — este registro y una notificación por
  el canal nativo de esta sesión son el único aviso real que le llega a Luis
  esta vez. La rama designada (`claude/zealous-brown-q08kdo`) no existía
  todavía en el remoto — la creé desde `main`.

## 2026-07-11 (autobuild, corrida nueva)
- 🔎 **Cola revisada, sin item elegible — misma pila desde el 2026-07-08,
  ahora bloqueada por revisión pendiente, no por trabajo faltante**: los 6
  issues `autobuild` abiertos siguen siendo `#40`/`#41`/`#92`/`#98`
  (`autobuild-espera`, PR borrador `#58`/`#55`/`#96`/`#103` sin ningún
  comentario de Luis, solo el automático de deploy preview de Netlify) y
  `#51`/`#52` (issues "padre" ya divididos en sub-issues fusionados o en
  espera vía sus PR). Sin `propuesta` abierta ni issue `autobuild`/`autofix`
  nuevo, así que no propongo una quinta funcionalidad (ya hay cuatro
  esperando el visto bueno de Luis). **Nota para Luis**: esta es la novena
  corrida seguida (todas hoy, 2026-07-11) que encuentra exactamente este
  mismo estado — los 4 PR borrador llevan 3 días sin ningún movimiento tuyo.
  Autobuild no puede avanzar más hasta que revises/apruebes al menos uno;
  esta vez sí se manda el aviso (las corridas anteriores de hoy decidieron
  callar por ser "lo mismo de siempre", pero acumular silencio no ayuda).
  La rama designada de esta sesión volvía a traer el mismo commit suelto ya
  fusionado en `main` ("Pagos: reporte histórico", PR #148, commit
  `9758a23`) — la reseteé de nuevo a `main`.

## 2026-07-11 (autobuild, corrida nueva)
- 🔎 **Cola revisada, sin item elegible — mismo estado que las corridas
  anteriores**: los 8 issues abiertos son los mismos de las últimas corridas —
  `#40`/`#41`/`#92`/`#98` (`autobuild-espera`, PR borrador ya abierto
  `#58`/`#55`/`#96`/`#103`, `updated_at` idéntico desde el 2026-07-08, sin
  ningún comentario ni actividad nueva de Luis) y `#51`/`#52` siguen siendo
  los issues "padre" ya divididos en sub-issues (`#91`/`#97` fusionados,
  `#92`/`#98` en espera vía sus PR). La épica `#111` sigue sin label
  `autobuild` (plan de referencia). `#31` es de `dcdg-autofix`
  (`autofix-espera`), fuera del alcance de este procedimiento. No hay ninguna
  `propuesta` nueva ni issues `autobuild`/`autofix` sin atender, así que no
  propongo una quinta propuesta (ya hay cuatro esperando el visto bueno de
  Luis). La rama designada de esta sesión (`claude/zealous-brown-dqcw8g`)
  volvía a traer el commit suelto ya fusionado ("Pagos: reporte histórico",
  PR #148) y **50+ commits detrás de `main`** (le faltaban Costos Ahinoa,
  Renta anual y varias corridas más ya fusionadas) — la recreé de nuevo
  desde `main`. Sin nada nuevo que avisar a Luis, no se manda notificación
  esta corrida; este registro es la constancia.

## 2026-07-11 (autobuild, corrida nueva)
- 🔎 **Cola revisada, sin item elegible — mismo estado que las corridas
  anteriores**: los 6 issues `autobuild` abiertos siguen siendo los mismos —
  `#40`/`#41`/`#92`/`#98` (`autobuild-espera`, PR borrador `#58`/`#55`/`#96`/
  `#103` ya abierto, sin ningún comentario ni actividad nueva de Luis desde la
  última revisión — revisé los comentarios de los 4 PR y solo está el
  automático de deploy preview de Netlify), y `#51`/`#52` siguen siendo los
  issues "padre" ya divididos en sub-issues (`#91`/`#97` fusionados, `#92`/
  `#98` en espera vía sus PR — confirmé que T5/T6/T7 (`#48`/`#49`/`#50`) están
  fusionados en `main`, pero eso no cambia nada porque ambos padres ya se
  dividieron en sub-issues que son los que están en la cola). No hay ninguna
  `propuesta` nueva ni issues `autobuild`/`autofix` sin atender, así que no
  propongo una quinta propuesta (ya hay cuatro esperando el visto bueno de
  Luis). La rama designada de esta sesión ya no existía en el remoto (se había
  limpiado/borrado tras la fusión de la corrida anterior, #188) y la copia
  local seguía trayendo el commit suelto `dab21e6` ("Pagos: reporte
  histórico"), ya fusionado en `main` como `9758a23` (PR #148, contenido
  idéntico) — la recreé de nuevo desde `main`. Sin nada nuevo que avisar a
  Luis, no se manda notificación esta corrida; este registro es la constancia.

## 2026-07-11 (autobuild, corrida nueva)
- 🔎 **Cola revisada, sin item elegible — mismo estado que las corridas
  anteriores**: los 6 issues `autobuild` abiertos siguen siendo los mismos —
  `#40`/`#41`/`#92`/`#98` (`autobuild-espera`, PR borrador `#58`/`#55`/`#96`/
  `#103` ya abierto) sin ningún comentario ni actividad nueva de Luis desde
  la última revisión (solo los comentarios automáticos de deploy preview de
  Netlify en los cuatro), y `#51`/`#52` siguen siendo los issues "padre" ya
  divididos en sub-issues (`#91`/`#97` fusionados, `#92`/`#98` en espera vía
  sus PR). No hay ninguna `propuesta` nueva ni issues `autobuild`/`autofix`
  sin atender, así que no propongo una quinta propuesta (ya hay cuatro
  esperando el visto bueno de Luis). La rama designada de esta sesión ya no
  existía en el remoto (se había limpiado/borrado tras una fusión anterior)
  y la copia local seguía trayendo el mismo commit suelto ya fusionado en
  `main` ("Pagos: reporte histórico", PR #148, commit `9758a23` — diff vacío
  contra `dab21e6`) — la reseteé de nuevo a `main`. Sin nada nuevo que avisar
  a Luis, no se manda notificación esta corrida; este registro es la
  constancia.

## 2026-07-11 (autobuild, corrida nueva)
- 🔎 **Cola revisada, sin item elegible — mismo estado que las corridas
  anteriores**: los 8 issues abiertos son los mismos de las últimas corridas —
  `#40`/`#41` (`propuesta` + `autobuild-espera`, PR borrador `#58`/`#55`) y
  `#92`/`#98` (`autobuild-espera`, PR borrador `#96`/`#103`) siguen sin
  actividad nueva de Luis; `#51`/`#52` siguen siendo los issues "padre" ya
  divididos en sub-issues (fusionados o en espera vía sus PR); la épica
  `#111` sigue sin label `autobuild` (plan de referencia); `#31` es de
  `dcdg-autofix`, fuera de este procedimiento. Ninguna `propuesta` ni issue
  `autobuild`/`autofix` nuevo, así que no propongo una quinta propuesta (ya
  hay cuatro esperando el visto bueno de Luis). La rama designada de esta
  sesión volvía a traer el mismo commit suelto ya fusionado en `main`
  ("Pagos: reporte histórico", PR #148, commit `9758a23`) — la reseteé de
  nuevo a `main`. Sin nada nuevo que avisar a Luis, no se manda notificación
  esta corrida; este registro es la constancia.

## 2026-07-11 (autobuild, corrida nueva)
- 🔎 **Cola revisada, sin item elegible — mismo estado que las corridas
  anteriores**: de los 8 issues abiertos, `#40`/`#41` (`propuesta` +
  `autobuild-espera`, con PR borrador ya abierto — `#58`/`#55`) y
  `#92`/`#98` (`autobuild-espera`, con PR borrador ya abierto — `#96`/`#103`)
  siguen sin actividad nueva de Luis (solo el comentario automático de
  deploy preview de Netlify en los cuatro). `#51`/`#52` siguen siendo los
  issues "padre" ya divididos en sub-issues (fusionados o en espera vía sus
  PR). La épica `#111` no lleva label `autobuild` (es el plan de
  referencia, no se construye directo) y sus 7 sub-issues ya están todos
  fusionados. El único issue restante (`#31`) es de `dcdg-autofix`, fuera
  del alcance de este procedimiento. No hay ninguna `propuesta` nueva ni
  issues `autobuild`/`autofix` sin atender, así que no propongo una quinta
  propuesta (ya hay cuatro esperando el visto bueno de Luis). La rama
  designada de esta sesión volvía a traer el mismo commit suelto de una
  corrida vieja ("Pagos: reporte histórico") — confirmé que su contenido ya
  está en `main` desde el PR #148 (commit `9758a23`) y reseteé la rama.
  Sin nada nuevo que avisar a Luis, no se manda notificación esta corrida;
  este registro es la constancia.

## 2026-07-11 (autobuild, corrida nueva)
- 🔎 **Cola revisada, sin item elegible — mismo estado que la corrida anterior**:
  los 6 issues `autobuild` abiertos siguen siendo `#40`/`#41`/`#92`/`#98` (con
  `autobuild-espera` y PR borrador ya abierto — `#58`/`#55`/`#96`/`#103`, sin
  actividad nueva de Luis) y `#51`/`#52` (issues "padre" ya divididos en
  sub-issues fusionados o en espera vía sus PR). No hay ninguna `propuesta`
  nueva ni issues `autobuild`/`autofix` nuevos que atender. Verifiqué también
  la épica `#111` ("nuestro/tuyo/mío") que abrió Luis: sus 7 sub-issues
  (`#112`–`#118`, incluida la Fundación de dueño/bolsillo por cuenta) ya
  estaban **todos fusionados** desde el 2026-07-09 — no queda trabajo ahí. No
  propongo otra funcionalidad nueva (ya hay cuatro esperando el visto bueno de
  Luis; sumar una quinta sería ruido). La rama designada de esta sesión traía
  otra vez el mismo commit suelto de una corrida vieja ("Pagos: reporte
  histórico", ya fusionado vía PR #148) — la reseteé a `main` antes de este
  cambio. Sin nada nuevo que avisar a Luis, no se manda notificación esta
  corrida; este registro es la constancia.

## 2026-07-11 (autobuild, corrida nueva)
- 🔎 **Cola revisada tras la consolidación de Ahinoa (issue #154, PR #183) —
  sin item nuevo elegible**: con #154 ya cerrada, los 6 issues `autobuild`
  abiertos siguen siendo los mismos de la corrida anterior — `#40`/`#41`/
  `#92`/`#98` con `autobuild-espera` y PR borrador ya abierto (`#58`/`#55`/
  `#96`/`#103`) sin actividad nueva de Luis, y `#51`/`#52` siguen siendo los
  issues "padre" ya divididos en sub-issues (`#97`/`#91` fusionados, `#98`/
  `#92` en espera vía sus PR). No hay ninguna `propuesta` abierta ni issues
  `autobuild`/`autofix` nuevos, así que no propongo otra funcionalidad
  (ya hay cuatro esperando el visto bueno de Luis). Además, la rama
  designada de esta sesión traía un commit suelto ("Pagos: reporte
  histórico") idéntico al ya fusionado en PR #148 (`9758a23`) — la reseteé
  a `main`. Sin nada nuevo que avisar a Luis, no se manda notificación esta
  corrida; este registro es la constancia.

## 2026-07-11 (autobuild, corrida nueva)
- ✅ **Consolidación automática del neto de Ahinoa en la base IBC de Carolina**
  (issue #154, reabierta y aprobada por Luis — decisión 1 confirmada:
  "el neto de Ahinoa SÍ se suma automáticamente a la base del IBC de
  Carolina, no como línea aparte"): la captura de costos de Ahinoa (PR #162)
  ya existía, pero `reporteAportes()` explícitamente no consolidaba el
  negocio en su dueña — quedaba pendiente de esta decisión de metodología.
  `entidades.propietario_id` (columna ya existente en `sql/contable.sql`,
  Ahinoa ya sembrada con `propietario_id` → Carolina) ahora se usa en
  `_lib/aportes.js`: cada persona suma los ingresos y costos deducibles de
  los negocios de los que es propietaria a los suyos propios *antes* de
  calcular el IBC (equivale a sumar el neto del negocio a la base). El
  desglose por negocio queda expuesto en `consolida_negocios` (por persona)
  para trazabilidad, y la tarjeta de "Aportes IBC" en la PWA muestra una
  línea "Incluye Ahinoa: ingresos − costos = neto" cuando aplica.
  `_lib/costos.js` (mini-P&L informativo por negocio) no cambia su cálculo,
  solo su nota, ya que ahora sí hay consolidación en el reporte de IBC.
  Sin esquema nuevo (la columna ya existía) y sin tocar ninguna fila
  existente — puramente cambio de código de agregación. Riesgo bajo:
  aditivo sobre datos ya existentes, sin migraciones ni cambios de auth;
  auto-merge con CI verde. Las preguntas 2 y 3 del issue (categorías de
  costo separadas; esperar la metodología "costos reales vs. presunción
  DIAN" de Santiago) siguen sin resolver — no bloquean esta consolidación,
  que ya estaba aprobada explícitamente.
- 🔎 Repasé el resto de la cola: `#40`/`#41`/`#92`/`#98` siguen con
  `autobuild-espera` y PR borrador abierto (`#58`/`#55`/`#96`/`#103`) sin
  actividad nueva de Luis, y `#51`/`#52` siguen siendo los issues "padre" ya
  divididos en sub-issues. Una funcionalidad por corrida (AUTOBUILD.md §10) —
  esta es la de hoy.

## 2026-07-11 (autobuild, corrida nueva)
- 🔎 **Cola revisada, sin item elegible — mismo estado, PRs borrador
  redundantes cerrados**: los 6 issues `autobuild` abiertos siguen igual —
  #40/#41/#92/#98 con `autobuild-espera` y PR borrador ya abierto
  (#58/#55/#96/#103, sin actividad nueva de Luis desde el 2026-07-08) y
  #51/#52 siguen como issues "padre" ya divididos en sub-issues (#91/#97
  fusionados, #92/#98 en espera vía sus PR). No hay ninguna `propuesta`
  abierta ni issues `autobuild`/`autofix` nuevos. La propia rama de esta
  sesión (`claude/zealous-brown-nlqsfy`) traía el mismo commit suelto
  ("Pagos: reporte histórico") que corridas anteriores ya habían visto en
  otras ramas — confirmé que el diff contra el commit ya fusionado (PR
  #148, `9758a23`) es vacío, y reseteé la rama a `main`. Además, encontré
  **cinco PR borrador consecutivos (#177–#181) con este mismo mensaje de
  "sin item elegible"** que quedaron abiertos sin fusionar (se crearon como
  borrador por error de corridas previas, así que no auto-mergearon) — los
  cerré por ser puro ruido duplicado del mismo estado que registra esta
  entrada; este PR va **listo para auto-merge** (no borrador) para que la
  cola de PRs no se siga acumulando. Sin nada nuevo que avisar a Luis, no
  se manda notificación esta corrida; este registro es la constancia.

## 2026-07-11 (autobuild, corrida nueva)
- 🔎 **Cola revisada, sin item elegible — mismo estado que la corrida anterior
  (#175), sin proponer una undécima**: los 6 issues `autobuild` abiertos siguen
  igual — #40/#41/#92/#98 con `autobuild-espera` y PR borrador ya abierto
  (#58/#55/#96/#103, `updated_at` sin cambios desde el 2026-07-08, cero
  actividad nueva de Luis en ninguno de los 4) y #51/#52 siguen como issues
  "padre" ya divididos en sub-issues (#91/#97 fusionados, #92/#98 en espera
  vía sus PR). No hay ninguna `propuesta` abierta ni issues `autobuild`
  nuevos. Tampoco hay issues `autofix` abiertos. De paso encontré, otra vez,
  la propia rama de esta sesión (`claude/zealous-brown-uhfs39`) con el mismo
  commit suelto ("Pagos: reporte histórico") que corridas anteriores ya
  habían visto en otras ramas — confirmé que el diff contra el commit ya
  fusionado (PR #148, `9758a23`) es vacío, así que no era trabajo perdido:
  reseteé la rama a `main`. Sin nada nuevo que avisar a Luis (los 4 PR
  borrador ya se reportaron varias veces, sin actividad nueva de su parte),
  no se manda notificación esta corrida; este registro es la constancia.

## 2026-07-11 (autobuild, corrida nueva)
- 🔎 **Cola revisada, sin item elegible — mismo estado que la corrida anterior
  (#174), sin proponer una décima**: los 6 issues `autobuild` abiertos siguen
  igual — #40/#41/#92/#98 con `autobuild-espera` y PR borrador ya abierto
  (#58/#55/#96/#103, `updated_at` sin cambios desde el 2026-07-08, cero
  actividad nueva de Luis) y #51/#52 siguen como issues "padre" ya divididos
  en sub-issues (#91/#97 fusionados, #92/#98 en espera vía sus PR). No hay
  ninguna `propuesta` abierta ni issues `autobuild` nuevos. Tampoco hay
  issues `autofix` abiertos. De paso encontré, otra vez, la propia rama de
  esta sesión (`claude/zealous-brown-dvzzt2`) con el mismo commit suelto
  ("Pagos: reporte histórico") que corridas anteriores ya habían visto en
  otras ramas — confirmé que el diff contra el commit ya fusionado (PR #148,
  `9758a23`) es vacío, así que no era trabajo perdido: reseteé la rama a
  `main`. Sin nada nuevo que avisar a Luis (los 4 PR borrador ya se
  reportaron varias veces, sin actividad nueva de su parte), no se manda
  notificación esta corrida; este registro es la constancia.

## 2026-07-11 (autobuild, corrida nueva)
- 🔎 **Cola revisada, sin item elegible — mismo estado que la corrida anterior
  (#173), sin proponer una novena**: los 6 issues `autobuild` abiertos siguen
  igual — #40/#41/#92/#98 con `autobuild-espera` y PR borrador ya abierto
  (#58/#55/#96/#103), revisé los comentarios de los 4 y siguen con solo el
  deploy preview automático de Netlify, cero actividad nueva de Luis — y
  #51/#52 siguen como issues "padre" ya divididos en sub-issues (#91/#97
  fusionados, #92/#98 en espera vía sus PR). No hay ninguna `propuesta`
  abierta ni issues `autobuild` nuevos. Tampoco hay issues `autofix` abiertos.
  De paso encontré, otra vez, la propia rama de esta sesión
  (`claude/zealous-brown-p7n4dz`) con el mismo commit suelto ("Pagos: reporte
  histórico") que corridas anteriores ya habían visto en otras ramas —
  confirmé que el diff contra el commit ya fusionado (PR #148, `9758a23`) es
  vacío, así que no era trabajo perdido: reseteé la rama a `main`. Sin nada
  nuevo que avisar a Luis (los 4 PR borrador ya se reportaron varias veces,
  sin actividad nueva de su parte), no se manda notificación esta corrida;
  este registro es la constancia.

## 2026-07-11 (autobuild, corrida nueva)
- 🔎 **Cola revisada, sin item elegible — mismo estado que la corrida anterior
  (#172), sin proponer una octava**: los 6 issues `autobuild` abiertos siguen
  igual — #40/#41/#92/#98 con `autobuild-espera` y PR borrador ya abierto
  (#58/#55/#96/#103), cada uno con solo el comentario automático de deploy de
  Netlify desde que se abrió — cero comentarios o revisión de Luis — y
  #51/#52 siguen como issues "padre" ya divididos en sub-issues (#91/#97
  fusionados, #92/#98 en espera vía sus PR). No hay ninguna `propuesta`
  abierta (#100 ya se aprobó, construyó y cerró) ni issues `autobuild` nuevos.
  Tampoco hay issues `autofix` abiertos. De paso encontré, otra vez, la propia
  rama de esta sesión (`claude/zealous-brown-732tk7`) con el mismo commit
  suelto ("Pagos: reporte histórico") que corridas anteriores ya habían visto
  en otras ramas — confirmé que el diff contra el commit ya fusionado (PR
  #148, `9758a23`) es vacío, así que no era trabajo perdido: reseteé la rama a
  `main`. `npm test` → 378/378 ✅ · `npm run build` → ✅ (sin cambios de
  comportamiento). Sin nada nuevo que avisar a Luis (los 4 PR borrador ya se
  reportaron varias veces, sin actividad nueva de su parte), no se manda
  notificación esta corrida; este registro es la constancia.

## 2026-07-11 (autobuild)
- 🔎 **Cola revisada, sin item elegible — mismo estado que la corrida anterior
  (#171)**: los 6 issues `autobuild` abiertos siguen igual — #40/#41/#92/#98
  con `autobuild-espera` y PR borrador ya abierto (#58/#55/#96/#103,
  `updated_at` idéntico a la corrida anterior, cero actividad de Luis) y
  #51/#52 siguen como issues "padre" ya divididos en sub-issues (#91 fusionado,
  #92 en espera de revisión). No hay ninguna `propuesta` abierta ni issues
  `autobuild` nuevos. De paso encontré mi propia rama de desarrollo
  (`claude/zealous-brown-y2xzsp`, la de esta sesión) con el mismo commit suelto
  ("Pagos: reporte histórico") que corridas anteriores ya habían visto en otras
  ramas — confirmé que el diff contra el commit ya fusionado (PR #148,
  `9758a23`) es vacío, así que no era trabajo perdido: reseteé la rama a
  `main`. Sin nada nuevo que avisar a Luis (los 4 PR borrador ya se reportaron
  varias veces en corridas anteriores, sin actividad nueva de su parte), no se
  manda notificación esta corrida; este registro es la constancia.

## 2026-07-10 (autobuild)
- 🔎 **Cola revisada otra vez, sin item elegible — mismo estado que la corrida
  anterior (#170), sin proponer una séptima**: los 6 issues `autobuild`
  abiertos siguen igual — #40/#41/#92/#98 con `autobuild-espera` y PR
  borrador ya abierto (#58/#55/#96/#103, `updated_at` idéntico a la corrida
  anterior, cero actividad de Luis) y #51/#52 siguen como issues "padre" ya
  divididos en sub-issues. No hay ninguna `propuesta` abierta ni issues
  `autobuild` nuevos. Estas últimas corridas se han sucedido en minutos, no
  en las ~3 horas de cadencia habitual, así que no hay ángulo nuevo que
  investigar respecto a la corrida inmediatamente anterior. Sin nada nuevo
  que avisar, no se manda notificación esta corrida; este registro es la
  constancia.

## 2026-07-10 (autobuild)
- 🔎 **Cola revisada otra vez, sin item elegible — mismo estado que la corrida
  anterior (#169)**: los 6 issues `autobuild` abiertos siguen igual —
  #40/#41/#92/#98 con `autobuild-espera` y PR borrador ya abierto
  (#58/#55/#96/#103, sin ningún cambio en `updated_at` desde la corrida
  anterior — cero actividad de Luis) y #51/#52 siguen como issues "padre" ya
  divididos en sub-issues. No hay ninguna `propuesta` abierta y no aparecieron
  issues `autobuild` nuevos. Sin nada nuevo que avisar (los 4 PR borrador ya
  se reportaron varias veces), no se manda notificación esta corrida; este
  registro es la constancia.

## 2026-07-10 (autobuild)
- 🔎 **Cola revisada otra vez, sin item elegible — mismo estado que la corrida
  anterior (#168)**: los 6 issues `autobuild` abiertos siguen sin ninguno
  elegible — #40/#41/#92/#98 con `autobuild-espera` y PR borrador ya abierto
  (#58/#55/#96/#103, solo el comentario automático de Netlify desde que se
  abrieron, sin actividad de Luis) y #51/#52 siguen como issues "padre" ya
  divididos en sub-issues (fusionados o en espera). No hay ninguna
  `propuesta` abierta. De paso encontré, otra vez, mi propia rama de
  desarrollo (`claude/zealous-brown-jos6i6`, la de esta sesión) con el mismo
  commit suelto ("Pagos: reporte histórico") que las corridas anteriores ya
  habían visto en otras ramas — confirmé que el diff contra el commit ya
  fusionado (PR #148, `9758a23`) es vacío, así que no era trabajo perdido:
  reseteé la rama a `main`. Sin nada nuevo que avisar a Luis (los 4 PR
  borrador ya se reportaron varias veces en corridas anteriores, sin
  actividad nueva de su parte), no se manda notificación esta corrida; este
  registro es la constancia.

## 2026-07-10 (autobuild)
- 🔎 **Cola revisada otra vez, sin item elegible — mismo estado que la corrida
  anterior (#167)**: los 6 issues `autobuild` abiertos siguen sin ninguno
  elegible — #40/#41/#92/#98 con `autobuild-espera` y PR borrador ya abierto
  (#58/#55/#96/#103, solo el comentario automático de Netlify desde que se
  abrieron, sin actividad de Luis) y #51/#52 siguen como issues "padre" ya
  divididos en sub-issues (fusionados o en espera). No hay ninguna
  `propuesta` abierta. De paso encontré mi propia rama de desarrollo
  (`claude/zealous-brown-e49m0o`) con un commit suelto ("Pagos: reporte
  histórico") sin PR, basada en un `main` desactualizado — verifiqué que su
  contenido es idéntico al ya fusionado en PR #148, así que no era trabajo
  perdido: reseteé la rama a `main` (mismo patrón que se hizo con
  `claude/zealous-brown-w8b78b` en la corrida anterior). Sin nada nuevo que
  avisar a Luis (los 4 PR borrador ya se reportaron en corridas anteriores),
  no se manda notificación esta corrida; este registro es la constancia.

## 2026-07-10 (autobuild)
- 🔎 **Cola revisada otra vez, sin item elegible — mismo estado que la corrida
  anterior (#166)**: los 6 issues `autobuild` abiertos siguen sin ninguno
  elegible — #40/#41/#92/#98 con `autobuild-espera` y PR borrador ya abierto
  (#58/#55/#96/#103, sin comentarios ni actividad nueva en ninguno desde la
  corrida anterior) y #51/#52 siguen como issues "padre" ya divididos en
  sub-issues (fusionados o en espera de revisión). Sin issues `autobuild`
  nuevos y sin ninguna `propuesta` abierta, así que no se fuerza una
  construcción ni una propuesta de relleno. De paso, encontré la rama de
  desarrollo `claude/zealous-brown-w8b78b` con un commit suelto ("Pagos:
  reporte histórico") que nunca tuvo PR — verifiqué que es idéntico byte a
  byte al que ya se fusionó como PR #148 (mismo `Claude-Session`, diff vacío
  contra `9758a23`), así que no es trabajo perdido: reseteé la rama a
  `main` para que la próxima corrida parta limpia. Sin nada nuevo que avisar
  a Luis, no se manda notificación esta corrida (ya se avisó en corridas
  anteriores); este registro es la constancia.

## 2026-07-10 (autobuild)
- 🔎 **Cola revisada otra vez, mismo estado que la corrida anterior (#165)**:
  los 6 issues `autobuild` abiertos siguen sin ninguno elegible —
  #40/#41/#92/#98 con `autobuild-espera` y PR borrador ya abierto
  (#58/#55/#96/#103, sin comentarios ni actividad nueva en ninguno) y
  #51/#52 siguen como issues "padre" ya divididos en sub-issues. Sin issues
  `autobuild` nuevos y sin ninguna `propuesta` abierta, así que no se fuerza
  una construcción ni una propuesta de relleno. Sin nada nuevo que avisar, no
  se manda notificación esta corrida (ya se avisó en corridas anteriores);
  este registro es la constancia.

## 2026-07-10 (autobuild)
- 🔎 **Cola revisada de nuevo, sin cambios desde la corrida anterior (hace ~52
  min)**: mismo estado exacto — los 6 issues `autobuild` abiertos siguen sin
  ninguno elegible (#40/#41/#92/#98 con `autobuild-espera` y PR borrador ya
  abierto; #51/#52 son los "padre" ya divididos en sub-issues), no hay
  ninguna `propuesta` abierta, y los 4 PR borrador bajo el candado no
  tuvieron actividad ni comentarios nuevos: 🔒 #55, 🔒 #58, 🔒 #96, 🔒 #103.
  Sin nada nuevo que avisar, no se manda notificación esta corrida (ya se
  avisó en las anteriores); este registro es la constancia.

## 2026-07-10 (autobuild)
- 🔎 **Cola revisada otra vez, sin item elegible — mismo estado que la corrida
  anterior**: repasé los 6 issues `autobuild` abiertos, sin cambios desde la
  última corrida (#163) — #40/#41/#92/#98 siguen con `autobuild-espera` y PR
  borrador abierto (#58/#55/#96/#103), y #51/#52 siguen como issues "padre"
  ya divididos en sub-issues (fusionados o en espera). Sin issues nuevos, sin
  `propuesta` abierta y sin ningún doc modificado desde la corrida anterior
  — no fuerzo una séptima propuesta de relleno. Los mismos 4 PR borrador
  siguen esperando revisión bajo el candado: 🔒 #55 (backup DB, issue #41),
  🔒 #58 (config-como-datos, issue #40), 🔒 #96 (cierre mensual, issue #92) y
  🔒 #103 (portal solo-lectura, issue #98) — sin actividad ni comentarios
  nuevos desde la corrida anterior, así que no se repite el aviso.
  `AUTOBUILD_NOTIFY_URL`/`AUTOBUILD_NOTIFY_SECRET` siguen sin configurar en
  este entorno; este registro es la red de seguridad.

## 2026-07-10 (autobuild)
- 🔎 **Cola revisada, sin item elegible — sin proponer una séptima**: de los 6
  issues `autobuild` abiertos, ninguno es tomable directo — #40/#41/#92/#98
  llevan `autobuild-espera` con PR borrador ya abierto (#58/#55/#96/#103) y
  #51/#52 son los "padre" ya divididos en sub-issues (fusionados o en
  espera). Las 4 propuestas que estaban pendientes (#100, #130, #145, #154)
  ya fueron aprobadas y construidas en corridas anteriores de hoy — no queda
  ninguna `propuesta` abierta. Repasé los docs que ninguna corrida había
  mirado todavía: `docs/arquitectura.md`, `docs/despliegue.md` y
  `docs/design-brief-pwa.md` no dejan ninguna fase pendiente sin construir —
  el último es explícitamente un brief para un rediseño de UI/UX dirigido a
  un agente/diseñador dedicado ("Para: Claude Design"), de alcance mucho
  mayor que una funcionalidad por corrida, así que no lo tomo como propuesta
  de autobuild. Sin ángulo genuino distinto, no fuerzo una séptima propuesta.
  **Lo que sí necesita a Luis ahora**: 4 PR borrador siguen esperando
  revisión bajo el candado, sin ningún comentario ni actividad desde que se
  abrieron — 🔒 #55 (backup DB, issue #41, desde 07-07), 🔒 #58
  (config-como-datos, issue #40, desde 07-07), 🔒 #96 (cierre mensual, issue
  #92, desde 07-08) y 🔒 #103 (portal solo-lectura, issue #98, desde 07-08).
  `AUTOBUILD_NOTIFY_URL`/`AUTOBUILD_NOTIFY_SECRET` siguen sin configurar en
  este entorno, así que el aviso de WhatsApp no puede salir; se avisa por
  notificación directa dado que ya llevan 2-3 días sin decisión.

## 2026-07-10 (autobuild)
- ✅ **Captura de costos de actividad económica (Ahinoa)** (issue #154,
  aprobada por Luis): `costos_actividad` ya existía en `sql/contable.sql` y ya
  se leía de forma agregada en el reporte de aportes IBC, pero no tenía
  ningún camino de escritura — Carolina no tenía forma de registrar un costo
  de Ahinoa (pago a tejedora, compra a proveedor). Se agrega `POST
  /api/pwa-costo-actividad` (solo `owner`) + `_lib/costos.js` (mini-P&L de
  solo lectura: ingresos − costos deducibles por negocio) + pantalla "🧵
  Costos Ahinoa" en la PWA, con el mismo patrón de captura que ya usa
  `ingresos.js`. `idempotency_key` se agrega a la tabla en runtime con DDL
  idempotente (`ensureCostosActividadSchema`, mismo patrón que
  `ensureAportesHogarSchema`) — aditivo, no toca filas existentes. **Alcance
  de esta primera versión, según lo que dejó abierto la propuesta:** el neto
  de Ahinoa **no se consolida automáticamente** en la base IBC de Carolina
  (queda como mini-P&L informativo aparte) — la metodología de consolidación
  sigue pendiente de confirmar. Riesgo bajo — aditivo (tabla existente, sin
  alterar columnas ni datos), auto-merge con CI verde (PR pendiente, `Closes
  #154`).

## 2026-07-10 (autobuild)
- ✅ **Reporte de discrepancias de conciliación** (issue #145, aprobada por
  Luis): nueva función pura `detectarDiscrepancias(propuestas, movimientos,
  ingresos)` en `_lib/conciliacion.js` — detecta el caso inverso al motor de
  cruce existente (issue #39): un movimiento/ingreso `provisional` de la
  ventana del extracto que **nunca fue candidato de ninguna propuesta** (ni
  `match` ni `ambiguo`), es decir, algo capturado que el banco no corrobora
  en absoluto. Se expone como `discrepancias: [...]` junto al `resumen` de
  `GET /api/pwa-conciliacion` y se muestra en la pantalla 🔗 Conciliación bajo
  "Capturado que el extracto no corrobora" — solo informativo (puede ser
  timing o un error de captura), sin acción asociada, igual que hoy se
  informa `solo_extracto`. Alcance elegido de las decisiones abiertas del
  issue: misma ventana ±4 días y mismo criterio laxo (sin filtrar por cuenta)
  que ya usa el motor de cruce. Puramente de lectura: no escribe nada, no
  cambia el flujo de confirmación existente. Riesgo bajo — auto-merge con CI
  verde (PR #161).

## 2026-07-10 (autobuild)
- ✅ **Hoja de trabajo de renta por cédulas + patrimonio fiscal a 31-dic**
  (issue #130, Fase 3.3 del roadmap contable, aprobada hoy por Luis): reporte
  anual de solo lectura por persona (Luis/Carolina) — agrupa `ingresos` del
  año por cédula y los `costos_actividad` deducibles (mismo dato que ya usa
  el reporte de IBC), y reutiliza `patrimonioPorPersona` (#115) a 31-dic sin
  duplicar su lógica. `GET /api/pwa-renta-anual?anio=&entidad_id=&formato=csv`
  (equipo, sin gate `owner`) + pantalla 📋 "Renta anual" en la PWA con
  descarga CSV. Es un borrador/insumo para que Santiago prepare la
  declaración real, no la reemplaza — mismas salvedades que el IBC (costos
  reales, Ahinoa sin consolidar). Riesgo bajo — solo lectura, sin escritura ni
  esquema nuevo; auto-merge con CI verde (PR #159).

  **Nota de bookkeeping**: al revisar la cola encontré que #130, #145 y #154
  llevaban la aprobación de Luis registrada (label `propuesta` retirado +
  comentario "Aprobado por Luis" en cada issue, consistente con el formato
  "aprueba la <n>" que este mismo CHANGELOG venía sugiriendo en corridas
  anteriores) pero **solo #130 se construye en esta corrida** — una
  funcionalidad por corrida (AUTOBUILD.md §10). #145 (reporte de
  discrepancias de conciliación) y #154 (costos de Ahinoa + consolidación
  IBC) quedan aprobadas y en cola para una corrida futura.

## 2026-07-10 (autobuild)
- ✅ **Cuadre de saldos del extracto** (issue #100, aprobada hoy por Luis):
  nueva función pura `cuadreExtracto()` en `_lib/conciliacion.js` que valida
  `saldo_inicial + Σ monto(extracto_lineas) ≈ saldo_final` (tolerancia ±1 por
  redondeo, mismo margen que ya usa el motor de cruce) usando **todas** las
  líneas del extracto, no solo las `sin_conciliar`. Se expone como
  `resumen.cuadre` en `GET /api/pwa-conciliacion` (`null` si el extracto
  nunca tuvo `saldo_inicial`/`saldo_final` cargado — no es un error) y se
  muestra en la pantalla 🔗 Conciliación de la PWA junto al resto del
  resumen. Puramente de lectura: no escribe nada, no cambia ningún flujo
  existente. Riesgo bajo — auto-merge con CI verde.

## 2026-07-10 (autobuild)
- 🔎 **Cola revisada otra vez, sin item elegible — mismo resultado, sin
  proponer una séptima**: repasé los mismos 10 issues `autobuild` abiertos;
  estado idéntico al de la corrida anterior — #40/#41/#92/#98 con PR borrador
  esperando revisión (#58/#55/#96/#103), #51/#52 son los "padre" ya divididos
  en sub-issues (fusionados o en espera), y #100/#130/#145/#154 siguen como
  `propuesta` sin que Luis les haya quitado la etiqueta. Sin commits nuevos en
  `docs/` desde la corrida anterior (último cambio en docs sigue siendo #107)
  y sin issues nuevos en la cola, así que no hay ángulo genuino distinto que
  buscar esta vez — forzar una séptima propuesta sería relleno. `npm ci`
  corrió limpio (29 paquetes). `AUTOBUILD_NOTIFY_URL`/`AUTOBUILD_NOTIFY_SECRET`
  siguen sin estar configurados en este entorno — van ya **ocho corridas**
  de hoy sin poder salir el aviso de WhatsApp, con 4 propuestas y 2 PR
  borrador acumulados desde el 8-9 de julio sin decisión. Dado que el canal
  automático sigue caído y el backlog de aprobaciones ya lleva varios días
  repitiéndose sin que Luis lo vea, esta corrida además avisa por notificación
  directa (fuera del canal de WhatsApp de SilvIA) — este registro sigue
  siendo la red de seguridad garantizada.
  **Recordatorio: 4 propuestas esperan tu OK** — 🔎 #100 (cuadre de saldos del
  extracto, desde 07-08), 🔎 #130 (hoja de trabajo de renta por cédulas +
  patrimonio fiscal, desde 07-09), 🔎 #145 (reporte de discrepancias de
  conciliación, desde 07-09) y 🔎 #154 (costos de Ahinoa + consolidación IBC,
  desde 07-10) — y **2 PR borrador esperando revisión bajo candado** — 🔒 #96
  (cierre mensual, issue #92, desde 07-08) y 🔒 #103 (portal solo-lectura,
  issue #98, desde 07-08). Dime "aprueba la 100/130/145/154" o revísalas en
  https://github.com/luchodelcast/finanzas_dcdg/issues?q=is:issue+is:open+label:propuesta.

## 2026-07-10 (autobuild)
- 🔎 **Cola revisada otra vez, sin item elegible — sin proponer una sexta**:
  repasé los 10 issues `autobuild` abiertos, mismo estado que la corrida
  anterior de hoy (la que abrió #154) — #40/#41/#92/#98 con PR borrador
  esperando revisión (#58/#55/#96/#103), #51/#52 son los "padre" ya divididos
  en sub-issues (fusionados o en espera), y #100/#130/#145/#154 siguen como
  `propuesta` sin que Luis les haya quitado la etiqueta (ninguna nueva desde
  la corrida anterior). No hay issues nuevos en la cola ni documentación
  modificada desde entonces (`git log` sin commits en `docs/` desde antes de
  las 08:00 UTC de hoy). Repasé los tres docs que ninguna corrida anterior
  había mirado todavía —
  [`docs/auth-pwa-sesion.md`](docs/auth-pwa-sesion.md),
  [`docs/cuentas-bancarias.md`](docs/cuentas-bancarias.md) y
  [`docs/reglas-clasificacion.md`](docs/reglas-clasificacion.md)— buscando un
  quinto ángulo genuino: no mencionan ninguna fase pendiente sin construir,
  así que no fuerzo una quinta propuesta de relleno (sería el "trabajo
  silencioso" que las barandas de `AUTOBUILD.md` buscan evitar).
  `AUTOBUILD_NOTIFY_URL` sigue sin estar configurado en este entorno (van ya
  siete corridas de hoy sin poder salir el aviso de WhatsApp) — este registro
  es la red de seguridad, y aviso a Luis por otra vía dado que ya son varios
  días de propuestas/PRs acumulados sin decisión.
  **Recordatorio: 4 propuestas esperan tu OK** — 🔎 #100 (cuadre de saldos del
  extracto, desde 07-08), 🔎 #130 (hoja de trabajo de renta por cédulas +
  patrimonio fiscal, desde 07-09), 🔎 #145 (reporte de discrepancias de
  conciliación, desde 07-09) y 🔎 #154 (costos de Ahinoa + consolidación IBC,
  desde hoy) — y **2 PR borrador esperando revisión bajo candado** — 🔒 #96
  (cierre mensual, issue #92, desde 07-08) y 🔒 #103 (portal solo-lectura,
  issue #98, desde 07-08). Dime "aprueba la 100/130/145/154" o revísalas en
  https://github.com/luchodelcast/finanzas_dcdg/issues?q=is:issue+is:open+label:propuesta.

## 2026-07-10 (autobuild)
- 🔎 **Propuesta nueva #154 — captura de costos de actividad (Ahinoa) +
  consolidación en el reporte IBC de Carolina**: repasé los 9 issues
  `autobuild` abiertos, mismo estado que las cinco corridas anteriores de
  hoy — #40/#41/#92/#98 con PR borrador esperando revisión
  (#58/#55/#96/#103), #51/#52 son los "padre" ya divididos en sub-issues
  (fusionados o en espera), y #100/#130/#145 siguen como `propuesta` sin que
  Luis les haya quitado la etiqueta (ninguna nueva desde la corrida
  anterior). Esta vez encontré un ángulo genuino y verificado en **código**
  (no solo mencionado en un doc): [`docs/roadmap-contable.md`](docs/roadmap-contable.md)
  §8.b documenta que los costos de Ahinoa (tejedoras/proveedores) van en la
  tabla `costos_actividad` para depurar su base de IBC/renta, y que las
  entidades tipo `negocio` "aún no se consolidan automáticamente en su
  dueño". Confirmé con `grep` sobre `netlify/functions/` y `app/src/ui/` que
  `costos_actividad` **ya está en el esquema y ya se lee/agrega en
  `_lib/aportes.js`, pero ningún endpoint ni pantalla escribe en ella** —
  Carolina no tiene hoy forma de registrar un costo de Ahinoa aunque el
  reporte de IBC ya está armado esperando esos datos. Abrí
  [#154](https://github.com/luchodelcast/finanzas_dcdg/issues/154) con el
  alcance propuesto (endpoint + pantalla de captura + consolidación opcional
  en la base IBC) y las preguntas de metodología para Luis. No es una
  variante de #100/#130/#145 — es el paso previo (la captura) que ninguna de
  esas tres toca. `AUTOBUILD_NOTIFY_URL` no está configurado en este
  entorno, así que no salió aviso de WhatsApp; este registro es la red de
  seguridad.
  **Recordatorio: 4 propuestas esperan tu OK** — 🔎 #100 (cuadre de saldos
  del extracto), 🔎 #130 (hoja de trabajo de renta por cédulas + patrimonio
  fiscal), 🔎 #145 (reporte de discrepancias de conciliación) y 🔎 #154
  (costos de Ahinoa + consolidación IBC, nueva) — y **2 PR borrador
  esperando revisión bajo candado** — 🔒 #96 (cierre mensual, issue #92) y
  🔒 #103 (portal solo-lectura, issue #98). Dime "aprueba la 100/130/145/154"
  o revísalas en
  https://github.com/luchodelcast/finanzas_dcdg/issues?q=is:issue+is:open+label:propuesta.

## 2026-07-10 (autobuild)
- 🔎 **Cola revisada otra vez, sin item elegible — quinta corrida seguida con el
  mismo resultado**: repasé los 9 issues `autobuild` abiertos, mismo estado que
  las cuatro corridas anteriores de hoy — #40/#41/#92/#98 con PR borrador
  esperando revisión (#58/#55/#96/#103), #51/#52 son los "padre" ya divididos
  en sub-issues (fusionados o en espera), y #100/#130/#145 siguen como
  `propuesta` sin que Luis les haya quitado la etiqueta. No hay issues nuevos
  en la cola ni docs modificados desde la corrida anterior (`docs/*.md` sin
  cambios). Repasé además `docs/plan-partida-doble-jul2026.md`,
  `docs/design-brief-pwa.md`, `docs/arquitectura.md` y `docs/despliegue.md`
  buscando un ángulo genuino distinto de las tres propuestas ya abiertas: lo
  único pendiente que mencionan son validaciones que le tocan a Santiago
  (contador) y bloques de despliegue que solo puede hacer Luis (dueño de la
  cuenta) — no son funcionalidades a construir. No fuerzo una cuarta propuesta
  de relleno. `AUTOBUILD_NOTIFY_URL` no está configurado en este entorno, así
  que no sale aviso de WhatsApp; este registro es la red de seguridad.
  **Recordatorio: 3 propuestas siguen esperando tu OK** — 🔎 #100 (cuadre de
  saldos del extracto), 🔎 #130 (hoja de trabajo de renta por cédulas +
  patrimonio fiscal) y 🔎 #145 (reporte de discrepancias de conciliación) — y
  **2 PR borrador esperando revisión bajo candado** — 🔒 #96 (cierre mensual,
  issue #92) y 🔒 #103 (portal solo-lectura, issue #98). Dime "aprueba la
  100/130/145" o revísalas en
  https://github.com/luchodelcast/finanzas_dcdg/issues?q=is:issue+is:open+label:propuesta.

## 2026-07-10 (autobuild)
- 🔎 **Cola revisada otra vez, sin item elegible — cuarta corrida seguida con el
  mismo resultado**: repasé los 9 issues `autobuild` abiertos, mismo estado que
  las tres corridas anteriores de hoy — #40/#41/#92/#98 con PR borrador
  esperando revisión (#58/#55/#96/#103), #51/#52 son los "padre" ya divididos
  en sub-issues (fusionados o en espera; confirmé además que #48, la
  dependencia bloqueante de #51/#52, ya está cerrado — no cambia su
  elegibilidad porque igual están cubiertos por sus splits), y #100/#130/#145
  siguen como `propuesta` sin que Luis les haya quitado la etiqueta. No fuerzo
  una cuarta propuesta de relleno — sin ángulo nuevo genuino desde la corrida
  anterior. `AUTOBUILD_NOTIFY_URL` no está configurado en este entorno, así que
  no sale aviso de WhatsApp; este registro es la red de seguridad.
  **Recordatorio: 3 propuestas siguen esperando tu OK** — 🔎 #100 (cuadre de
  saldos del extracto), 🔎 #130 (hoja de trabajo de renta por cédulas +
  patrimonio fiscal) y 🔎 #145 (reporte de discrepancias de conciliación) — y
  **2 PR borrador esperando revisión bajo candado** — 🔒 #96 (cierre mensual,
  issue #92) y 🔒 #103 (portal solo-lectura, issue #98). Dime "aprueba la
  100/130/145" o revísalas en
  https://github.com/luchodelcast/finanzas_dcdg/issues?q=is:issue+is:open+label:propuesta.

## 2026-07-10 (autobuild)
- 🔎 **Cola revisada de nuevo, sin item elegible — mismo estado que la corrida
  anterior**: repasé los 9 issues `autobuild` abiertos: #40/#41/#92/#98 con PR
  borrador esperando revisión (#58/#55/#96/#103), #51/#52 son los "padre" ya
  divididos en sub-issues (fusionados o en espera), y #100/#130/#145 siguen
  como `propuesta` sin decisión de Luis (ninguna perdió la etiqueta desde la
  corrida anterior). No encontré un ángulo nuevo genuino en los docs
  (`docs/migracion-db.md`, `docs/conciliacion.md`, `docs/roadmap-contable.md`)
  distinto de esas tres propuestas ya abiertas, así que no fuerzo una cuarta
  de relleno — sería el "trabajo silencioso" que las barandas de
  `AUTOBUILD.md` buscan evitar. `AUTOBUILD_NOTIFY_URL` no está configurado en
  este entorno, así que no sale aviso de WhatsApp; este registro es la red de
  seguridad.
  **Recordatorio: 3 propuestas siguen esperando tu OK** — 🔎 #100 (cuadre de
  saldos del extracto), 🔎 #130 (hoja de trabajo de renta por cédulas +
  patrimonio fiscal) y 🔎 #145 (reporte de discrepancias de conciliación).
  Dime "aprueba la 100/130/145" o revísalas en
  https://github.com/luchodelcast/finanzas_dcdg/issues?q=is:issue+is:open+label:propuesta.

## 2026-07-10 (autobuild)
- 🔎 **Cola revisada otra vez, sin item elegible — corregí un bug de etiquetado
  en #145**: repasé los 9 issues `autobuild` abiertos, mismo resultado que la
  corrida anterior de hoy — #40/#41/#92/#98 con PR borrador esperando revisión
  (#58/#55/#96/#103), #51/#52 son los "padre" ya divididos en sub-issues
  (fusionados o en espera), y #100/#130/#145 son `propuesta` sin decisión de
  Luis. Al revisar #145 encontré que le faltaba la etiqueta **`propuesta`**:
  el título y el cuerpo del issue (generados por la corrida que lo abrió,
  2026-07-09) dicen explícitamente "tiene la etiqueta `propuesta`", pero nunca
  se aplicó — quedó solo con `autobuild`, lo que técnicamente lo hacía
  "elegible" para construir directo. Eso es un bug de la corrida que lo creó,
  no una aprobación de Luis: se lo agregué para que la compuerta funcione
  como se documentó, sin construir nada de #145 ni tocar su alcance. Con la
  cola confirmada vacía otra vez y sin un ángulo nuevo genuino desde ayer
  (mismo repaso de `docs/migracion-db.md` §"Siguientes fases" que ya hizo la
  corrida anterior), no fuerzo una cuarta propuesta de relleno.
  `AUTOBUILD_NOTIFY_URL` no está configurado en este entorno, así que no salió
  aviso de WhatsApp; este registro es la red de seguridad.
  **Recordatorio: 3 propuestas siguen esperando tu OK** — 🔎 #100 (cuadre de
  saldos del extracto), 🔎 #130 (hoja de trabajo de renta por cédulas +
  patrimonio fiscal) y 🔎 #145 (reporte de discrepancias de conciliación).
  Dime "aprueba la 100/130/145" o revísalas en
  https://github.com/luchodelcast/finanzas_dcdg/issues?q=is:issue+is:open+label:propuesta.

## 2026-07-10 (autobuild)
- 🔎 **Cola de `autobuild` revisada de nuevo, sin item elegible para construir
  directo — sin proponer una cuarta**: repasé los 9 issues abiertos con label
  `autobuild`. #40/#41/#92/#98 siguen con PR borrador esperando revisión
  (#58/#55/#96/#103); #51/#52 siguen siendo los issues "padre" ya divididos en
  sub-issues (fusionados o en espera de revisión); y #100/#130/#145 siguen
  como `propuesta` sin decisión de Luis. Repasé de nuevo `docs/migracion-db.md`
  §"Siguientes fases" en busca de un cuarto ángulo genuino (no una variante de
  #100/#130/#145): la única fase de esa lista sin issue propio, "Fase 2 —
  dashboard online", ya está construida (pantalla 📊 Dashboard existente); las
  otras dos ya son #40/#41. Sin un hueco nuevo real que valga la pena, no
  fuerzo una propuesta de relleno — inventar alcance solo para cumplir el
  paso 3 sería el "trabajo silencioso" que las barandas de `AUTOBUILD.md`
  buscan evitar. `AUTOBUILD_NOTIFY_URL` no está configurado en este entorno,
  así que no salió aviso de WhatsApp; este registro es la red de seguridad.
  **Recordatorio: 3 propuestas siguen esperando tu OK** — 🔎 #100 (cuadre de
  saldos del extracto), 🔎 #130 (hoja de trabajo de renta por cédulas +
  patrimonio fiscal) y 🔎 #145 (reporte de discrepancias de conciliación).
  Dime "aprueba la 100/130/145" o revísalas en
  https://github.com/luchodelcast/finanzas_dcdg/issues?q=is:issue+is:open+label:propuesta.

## 2026-07-09 (autobuild)
- 🔎 **Cola de `autobuild` revisada de nuevo, sin item elegible para construir
  directo**: #40/#41/#92/#98 siguen con PR borrador esperando revisión
  (#58/#55/#96/#103), #51/#52 siguen divididos en sub-issues fusionados o en
  espera, y #100/#130 siguen como `propuesta` sin decisión de Luis. Con la cola
  de trabajo directo vacía y sin repetir #100/#130, releí
  `docs/conciliacion.md` y confirmé en el código que dos de sus cuatro
  pendientes de "Siguiente" ya están construidos (creación guiada = backfill
  #72/PR #79; soporte de PDF del extracto = `_lib/extracto-pdf.js`, el doc
  quedó desactualizado) — el cuadre de saldos ya es #100. Quedaba sin issue el
  **reporte de discrepancias**: el motor de cruce (#39) nunca surge los
  movimientos/ingresos capturados que siguen `provisional` sin haber sido
  candidato de NINGUNA línea del extracto (ni siquiera `ambiguo`) — el tercer
  caso que el propio doc describe ("capturado sin línea... o un error → se
  revisa"), hoy invisible para el usuario. Propuse **issue #145** (función
  pura + solo lectura, expuesta en `/api/pwa-conciliacion` y en la pantalla 🔗
  Conciliación). Queda como `propuesta` esperando el OK de Luis; no se
  construyó nada esta corrida. `AUTOBUILD_NOTIFY_URL` no estaba configurado en
  el entorno de esta corrida, así que el aviso de WhatsApp no salió — este
  registro es la red de seguridad. 🔎 Propuesta #145 por aprobar: reporte de
  discrepancias de conciliación (capturado que el extracto no corrobora) —
  ayuda a detectar duplicados/errores de captura antes de cerrar el mes. Dime
  "aprueba la 145" o revísala en
  https://github.com/luchodelcast/finanzas_dcdg/issues/145.

## 2026-07-09 (autobuild)
- 🤖 **Presupuesto mensual por categoría + ejecutado y variación** (issue #135,
  `auto-ok`, PR #138): nueva pantalla **📊 Presupuesto** (Más → Presupuesto)
  con el reporte PTTO · Ejecutado · Variación de cada categoría del mes —
  barra + indicador verde/rojo (dentro/sobre presupuesto) — y un formulario
  para fijar el presupuesto de una categoría (solo owners; lectura para el
  equipo). Tabla nueva `presupuestos` (categoría/año/mes/monto), DDL
  idempotente en runtime (`ensurePresupuestosSchema`, mismo patrón que
  Metas #117). El "ejecutado" reusa el mismo agregado por categoría que ya
  usa el Dashboard (`queryResumen`) — sin consulta nueva ahí, solo se cruza
  contra el PTTO. Aditivo puro, no toca datos existentes. `npm test`
  (337/337) + `npm run build` en verde → auto-merge. ✅

## 2026-07-09
- **Pagos: reporte histórico (últimos meses + acumulado por quién asume)**: nueva sección **"Historial de pagos"** en la pantalla de Pagos que cruza varios meses a partir de `pagos_estado`. Muestra, por cada uno de los últimos 6 meses, **Pagado / Presupuestado / %** (con barra verde/roja) y un **acumulado** del periodo con el total pagado y el desglose **por quién asume** (LADCC/CMDG/Común). Backend: `queryPagosEstadoRango` (consulta de rango) + funciones puras `historialPagos`/`ultimosMeses`, expuestos en `GET /api/pwa-pagos?historial=1&meses=N`. Solo lectura, aditivo. `repo.js` + `pagos.js` (lib) + `handlers.js` + `pagos.js` (UI) + `index.html`. ✅
- **Pagos: navegación entre meses (marcar pagos de meses anteriores / atrasos de varios meses)**: la vista de Pagos estaba clavada en el mes actual, así que un pago que corresponde a la factura de un mes pasado (p. ej. la luz que llega vencida) se registraba como del mes en curso, y no había forma de saldar atrasos de **varios** meses. Ahora el encabezado tiene **◀ / mes / ▶ / Hoy**: navegas a cualquier mes y marcas el pago con su periodo real (cada uno guarda su `monto_pagado`, `fecha_pago` y estado por mes, listo para reportes). De paso se corrige un bug: "Pendientes del mes pasado" antes marcaba el pago en el mes mostrado; ahora su botón **"Ir a pagar →"** te lleva al mes correcto. Solo `pagos.js` + `index.html`. ✅
- **Pagos: split por período (un pago que cubre el mes actual + uno anterior)**: cuando un pago incluye la factura de un mes anterior (p. ej. el acueducto: pagaste $1.459.896, de los cuales $638.566 eran de junio), al "Marcar pagado" ahora, tras el valor total, se pregunta **cuánto corresponde a un mes anterior**. Si es >0, se marca esa porción como pagada en el **mes anterior** y el resto en el **mes actual** — así ambos periodos quedan saldados con su monto real. Función pura `planMarcarSplit` con tests (incluye el rollover enero→diciembre y la validación porción<total). Solo `pagos.js` (UI); el backend ya aceptaba marcar un (año, mes) arbitrario. ✅
- **"Marcar pagado" pide el valor real (no el presupuesto)**: el monto de un pago fijo varía cada mes, pero "Marcar pagado" guardaba el presupuesto por defecto y no dejaba ingresar lo realmente pagado. Ahora al marcar se pregunta el **valor real** (prellenado con el presupuesto como referencia) y se guarda en `monto_pagado`; la fila muestra lo pagado de verdad y, si difiere, anota el `ptto` en pequeño. El total "Pagado" del mes ya refleja el valor real. Útil p. ej. cuando el pago del acueducto incluye la factura del mes anterior. Solo `pagos.js` (UI); el backend ya soportaba `monto_pagado`. ✅
- **Pagos fijos: los 22 reales del Excel (montos, día, categoría/subcategoría, "asumido por")** (issue #136): el catálogo tenía 12 pagos *placeholder* con **monto 0** (por eso el presupuesto del mes salía en $0). Se siembra el catálogo canónico del Excel maestro con **monto real, día de vencimiento, familia (DCDG/DCC), categoría + subcategoría** (habilitan el auto-vínculo #141) y **asumido_por** (LADCC/CMDG — insumo del fondo común/aportes #113). La siembra es idempotente y de **una sola vez** (centinela "Acueducto Apto"): retira los placeholders sin usar (`activo=false`, no borra) y hace upsert de los 22; re-ejecutar no pisa las ediciones que un owner haga luego. En la UI de Pagos: cada fila muestra el "asumido por", el resumen agrega **"Por quién asume: LADCC $X · CMDG $Y · Común $Z"**, y "Gestionar pagos fijos" gana el desplegable **Asumido por**. `repo.js` + `pagos.js` + `handlers.js` + `index.html`. ✅
- **Auto-vínculo movimiento → pago fijo (dejar de "Marcar pagado" a mano)**: al registrar un gasto que casa con un pago fijo del mes por **(categoría, subcategoría)** —p. ej. *Servicios Públicos/Agua*—, el sistema marca ese pago fijo como **pagado** con el monto real y guarda el `movimiento_id`. Best-effort e idempotente: no-op si no hay match, si ya estaba marcado (no pisa un "Marcar pagado" manual), o si el movimiento es en USD. Se agregan las columnas `subcategoria` y `asumido_por` (LADCC/CMDG, del Excel) a `pagos_fijos` por DDL idempotente. El auto-vínculo empieza a casar cuando los pagos fijos tengan categoría/subcategoría cargadas (siembra del Excel, #136). `repo.js` + `finanzas.js`. ✅
- **"Corregir" reconoce fechas sueltas y valida la categoría (evita el footgun)**: escribir solo `2026-07-09` en el diálogo de Corregir (sin el prefijo `fecha `) lo tomaba como **categoría nueva** — un recibo terminó con la categoría literal "2026-07-09". Ahora el diálogo detecta el formato AAAA-MM-DD y lo trata como corrección de **fecha** (con o sin prefijo), y si el texto no es una categoría válida lo **rechaza** mostrando la lista, en vez de guardar una categoría basura. Solo `dashboard.js`. ✅
- **Pagos → "Gestionar pagos fijos": etiquetas claras y sin overflow en móvil**: las dos columnas de números no tenían rótulo (no se sabía que la segunda era el **día de vencimiento**) y los campos/botones se salían de la vista en pantallas angostas. Ahora cada campo va etiquetado (**Monto ($)** / **Día de vencimiento**) y la fila envuelve (flex-wrap) para caber en móvil. Solo `pagos.js` + `index.html`. ✅
- **"Año" cubre todo el año calendario (registros futuros mal fechados dejan de ser invisibles)**: todos los periodos del Panel terminaban en HOY, así que un movimiento fechado por error en un mes futuro (p. ej. el recibo del agua leído como 2026-09-07 en vez de 2026-07-09) **no aparecía en ningún periodo** — ni "Este mes", ni "Mes pasado", ni "Año" (que iba 1 ene → hoy) — y por lo tanto no se podía ni ver ni corregir. Ahora "Año" va del **1 de enero al 31 de diciembre**, de modo que esos registros quedan visibles y se pueden **Corregir → `fecha`** o anular. Solo `dashboard.js` (frontend). ✅
- **Fechas colombianas (DD/MM) y corrección de fecha de un movimiento**: un
  recibo de agua pagado el **9 de julio** (`09/07/2026`) quedó registrado como
  **7 de septiembre** (`2026-09-07`) porque el clasificador leía la fecha como
  MM/DD (formato de EE. UU.) en vez de DD/MM (Colombia); por eso no aparecía en
  el periodo. El prompt (`config/prompt.js`) ahora instruye explícitamente que
  las fechas de recibos colombianos son **DD/MM/AAAA** y deben devolverse en ISO.
  Además, el "Corregir" del panel ahora permite **corregir la fecha** de un
  movimiento (escribiendo `fecha AAAA-MM-DD`): el backend
  (`repo.updateMovimientoCampos` + `corregir.recategorizarMovimiento`) actualiza
  la fecha y re-contabiliza el asiento con la fecha correcta. ✅
- **Taxonomía de categorías completa y alineada (Excel maestro)**: el
  desplegable del formulario (`config/categories.js`) no tenía **Servicios
  Públicos** (ni Vivienda, Seguros/Medicina Prepagada, Créditos y Tarjetas), así
  que un recibo de agua (Triple A) caía en "Hogar/Aseo". Se completa la
  taxonomía con la del Excel DCDG (Presupuesto + Pagos Fijos) y —clave— el
  **clasificador ahora enumera y se limita a esa MISMA lista** (`config/prompt.js`
  importa `CATEGORIAS`), con reglas nuevas para servicios públicos (Triple A→Agua,
  Air-e→Energía, Gases del Caribe→Gas, Movistar/Claro/Tigo→Internet/Telefonía),
  vivienda, seguros/medicina prepagada y pagos de créditos/tarjetas. Una sola
  fuente de verdad → formulario y clasificación dejan de desalinearse. Solo
  config/prompt (sin datos ni esquema). ✅

## 2026-07-09 (autobuild)
- 🤖 **Sección dedicada "Transferencia entre monedas"** (issue #132,
  `prioridad-alta` + `auto-ok`, PR #TBD): la pantalla 🔁 Transferencia gana un
  selector "Misma moneda" / "Entre monedas". En modo "Entre monedas" se
  muestran dos bloques explícitos — **Salió de** (cuenta origen, monto,
  moneda auto-detectada) y **Entró en** (cuenta destino, monto recibido,
  moneda auto-detectada) — más la **tasa aplicada** de forma prominente (p.
  ej. "Tasa: 3.313,49 COP/USD"), en vez de los campos `monto_destino`/
  `moneda_destino` que antes quedaban como opcionales sueltos en el flujo
  general. La moneda de cada cuenta se detecta sola a partir del catálogo
  (`⚙️ CUENTAS` o el fallback), sin que el usuario tenga que elegirla a mano.
  Reusa el backend existente sin tocarlo (`registrarMovimiento` transferencia
  + `cuadreTransferencia` de #121/#129); la transferencia de una sola moneda
  sigue funcionando igual que antes. Nuevo módulo puro
  `app/src/utils/transferencia-monedas.js` (detección de moneda por cuenta +
  cálculo de tasa) con tests. `npm test` (331/331) + `npm run build` en verde
  → auto-merge (aditivo, sin candado). ✅
- 🔎 **Cola de `autobuild` revisada, sin item elegible para construir directo**:
  #40/#41/#92/#98 ya tienen PR borrador esperando revisión (#58/#55/#96/#103),
  #51/#52 están divididos en sub-issues ya fusionados o en espera, y la épica
  #111 (contabilidad familiar) que se abrió hoy quedó **completa** (sus 7
  sub-issues #112–#118, todos fusionados). Sin nada que construir, propuse
  **una funcionalidad nueva**: **issue #130**, "Hoja de trabajo de renta por
  cédulas + patrimonio fiscal a 31-dic" (Fase 3.3 de
  `docs/roadmap-contable.md`, el objetivo #2 del Horizonte 1, pendiente desde
  que se aprobó el reporte IBC). Queda como `propuesta` esperando el OK de
  Luis; no se construyó nada esta corrida. `AUTOBUILD_NOTIFY_URL` no estaba
  configurado en el entorno de esta corrida, así que el aviso de WhatsApp no
  salió — este registro es la red de seguridad. 🔎 Propuesta #130 por aprobar:
  hoja de trabajo de renta por cédulas + patrimonio fiscal a 31-dic — insumo
  para que Santiago prepare la declaración de renta. Dime "aprueba la 130" o
  revísala en https://github.com/luchodelcast/finanzas_dcdg/issues/130.
- 🤖 **[Contab. familiar E] Metas financieras (emergencia/retiro/educación) +
  pensión de Carolina** (issue #117, `auto-ok`, PR #127): nuevo módulo de
  metas/objetivos con barra de progreso (tabla `metas`, DDL idempotente en
  runtime). Metas semilla creadas automáticamente la primera vez (Fondo de
  emergencia, Retiro, Educación de los hijos, Pensión/ahorro voluntario de
  Carolina ligada a su entidad). El saldo actual de cada meta suma el saldo
  (Libro Mayor, T5) de la(s) cuenta(s) PUC de respaldo que se le vinculen
  contra su `monto_objetivo`; sin cuenta vinculada queda en 0% con gracia.
  Nueva pantalla PWA **🎯 Metas** (Más → Metas): crear una meta (nombre,
  categoría, monto objetivo, fecha opcional, cuenta(s) de respaldo del plan de
  cuentas) y ver la lista con su avance. Escritura solo `owner`, lectura para
  el equipo. Aditivo puro, solo lectura sobre asientos existentes. `npm test`
  (308/308) + `npm run build` en verde → auto-merge. ✅
- 🤖 **Transferencias entre monedas (USD↔COP), modelo pragmático de dos patas**
  (issue #121, `auto-ok`): una transferencia ahora puede llevar `monto_destino`/
  `moneda_destino` opcionales (lo que realmente llegó al destino), además de
  `monto`/`moneda` de siempre. La contabilización (`_lib/contabilizar.js`,
  `cuadreTransferencia`) usa el monto de la pata que ya está en COP para ambos
  renglones del asiento (siempre cuadra) y deriva la tasa implícita
  (`monto_destino_COP / monto_origen`), sin formalizar diferencia en cambio.
  Pantalla PWA "Transferencia" con campos opcionales de monto/moneda destino y
  vista previa de la tasa. Retrocompatible: transferencias de una sola moneda
  siguen igual (`monto_destino`/`moneda_destino` quedan `null`). Aditivo (DDL
  idempotente en runtime: `movimientos.monto_destino`/`moneda_destino`); no se
  transforma nada existente. `npm test` (304/304) + `npm run build` en verde →
  auto-merge. ✅

## 2026-07-09 (autobuild)
- 🤖 **[Contab. familiar G] Cierre del mes — ritual de revisión de la pareja**
  (issue #118, `auto-ok`, PR pendiente): nueva pantalla PWA **"🗓️ Cierre del
  mes"** que en una sola vista consolida, por persona, el ingreso del mes, lo
  aportado al fondo común vs. su cuota (#113), su patrimonio neto y variación
  vs. el mes anterior (#115), más el bolsillo Común y el consolidado familiar
  — solo lectura, sin recalcular nada (reusa `reporteAportesHogar` y
  `patrimonioPorPersona`/`evolucionPatrimonio`). Metas (#117) se muestra si
  ya está fusionado, y degrada con gracia si no. Nuevo endpoint
  `GET/POST /api/pwa-cierre-mes` (GET = resumen; POST `enviar_resumen`
  intenta, opcionalmente, que SilvIA le mande el resumen por WhatsApp vía
  `AUTOBUILD_NOTIFY_URL` — sin configurar, degrada con un mensaje en vez de
  fallar). Aditivo, solo lectura sobre datos existentes, sin esquema nuevo.
  `npm test` (294/294) + `npm run build` en verde → auto-merge. ✅

## 2026-07-09 (autobuild)
- 🤖 **[Contab. familiar D] Préstamos entre personas integrados a la partida
  doble** (issue #116, `auto-ok`, PR #126): un préstamo real Luis↔Carolina
  ahora genera su asiento de partida doble usando las cuentas inter-personas
  del PUC (`1315` CxC a socios / `2340` CxP a socios) — débito/crédito según
  quién presta, sin tocar el tracker `prestamos` existente. Marcar/desmarcar un
  préstamo como saldado ajusta el asiento (reverso o reapertura, versionado con
  `contab_version` para que alternar el estado siga cuadrando). Nuevo flujo
  **"pagar con mi plata algo del otro"** (`POST /api/pwa-prestamos {accion:
  'pagar_deuda_otro'}` + tarjeta nueva en la pantalla 🤝 Préstamos): en un solo
  toque registra el pago (atribuido al deudor) y el préstamo correspondiente,
  ambos contabilizados e idempotentes ante reintento. Aditivo (DDL idempotente:
  `contab_version`/`idempotency_key` en `prestamos`); no se transforma el
  histórico existente. `npm test` (289/289) + `npm run build` en verde →
  auto-merge. ✅

## 2026-07-09 (autobuild)
- 🤖 **[Contab. familiar C] Patrimonio individual: balance por persona + "Mi
  patrimonio"** (issue #115, `auto-ok`, PR pendiente): el Balance General (T7)
  ya se puede ver por persona reusando el `dueño` de cada cuenta (`cuentas_meta`,
  #112) — nuevo endpoint `GET /api/pwa-patrimonio?fecha=` con Luis, Carolina, el
  bolsillo **Común** (asientos sin dueño individual) y el consolidado. Nueva
  pantalla PWA **"Mi patrimonio"**: `GET /api/pwa-mi-patrimonio?meses=&fecha=`
  resuelve la persona de la sesión (vía `usuarios.nombre`) y muestra su neto
  (activo − pasivo) y una serie mensual simple; si el email no está asociado a
  una persona, degrada con gracia al consolidado familiar. Solo lectura sobre
  asientos existentes, sin esquema nuevo. `npm test` (273/273) + `npm run
  build` en verde → auto-merge. ✅

## 2026-07-09 (autobuild)
- 🤖 **[Contab. familiar B] Clasificar gasto compartido (hogar) vs. personal**
  (issue #114, `auto-ok`, PR pendiente): al capturar un egreso, cada movimiento
  ahora lleva un marcador `hogar` (compartido) o `personal de <persona>`. Por
  defecto se **infiere** del `bolsillo` de la cuenta usada (`cuentas_meta`,
  #112): bolsillo `comun` → hogar; `gasto_individual`/`patrimonio_individual`
  → personal del dueño de esa cuenta. La PWA permite **override manual** en la
  pantalla de confirmación de registro ("¿Hogar o personal?"), y el marcador
  queda visible en el historial del Dashboard y filtrable vía
  `GET /api/pwa-movimientos?tipo_gasto=hogar|personal`. Columnas nuevas
  (`tipo_gasto`, `tipo_gasto_persona`, `tipo_gasto_auto`) vía DDL idempotente
  en runtime, sin `.sql` manual — aditivo puro (candado de `AUTOBUILD.md`
  respetado). `npm test` (267/267) + `npm run build` en verde → auto-merge. ✅

## 2026-07-09 (autobuild)
- 🤖 **[Contab. familiar A] Fondo común + reporte de aportes al hogar** (issue
  #113, `auto-ok`, PR #123): nueva tabla `aportes_hogar` (DDL idempotente en
  runtime) para que cada persona registre su aporte al fondo común del hogar,
  distinto de una transferencia genérica. Cada aporte se contabiliza solo
  (débito a la cuenta PUC nueva `1115` "Fondo común del hogar" / crédito el
  medio de pago de origen, usando la prioridad de `cuenta_puc` de `cuentas_meta`
  de #112 cuando aplica). El reporte del mes ("🏡 Fondo común" en Más → Familia)
  muestra cuánto aportó cada quien, su cuota proporcional sugerida (según su
  ingreso del periodo) y el % cumplido. Aditivo puro (candado de `AUTOBUILD.md`
  respetado). `npm test` + `npm run build` en verde → auto-merge. ✅

## 2026-07-09 (autobuild)
- 🤖 **[Contab. familiar 0] Dueño/bolsillo por cuenta (`cuentas_meta`)** (issue
  #112, `auto-ok`, PR #122): la contabilización automática agrupaba cada
  cuenta a una cuenta PUC solo por palabra clave del nombre
  (`efectivo`/`crédito`/`tc`), así que no distinguía el efectivo de Luis de la
  tarjeta de Carolina, y una tarjeta sin esas palabras (p. ej. "Serfinanza")
  se contabilizaba mal (agrupada en `1110`). Ahora una tabla nueva
  `cuentas_meta` (dueño/bolsillo/cuenta PUC explícita por cuenta, DDL
  idempotente en runtime, sin `.sql` manual) le da prioridad a la cuenta PUC
  explícita cuando existe, y cae a la heurística de siempre cuando no —
  llave que habilita el resto de la épica de contabilidad familiar (#111,
  #113–#118). UI mínima en "Saldos iniciales" para fijar los metadatos de
  cada cuenta (solo Luis/Carolina). Aditivo puro (candado de `AUTOBUILD.md`
  respetado igual). `npm test` (251/251) + `npm run build` en verde →
  auto-merge. ✅

## 2026-07-09
- **Corregir movimientos: anular y recategorizar** (botón "Corregir" en el
  Dashboard, solo Luis/Carolina): hasta ahora la captura y SilvIA solo sabían
  *agregar* — si algo quedaba mal (p. ej. una transferencia registrada como
  "Gasto Bancario"), no había forma de arreglarlo en la app. Ahora un owner puede
  **anular** un movimiento (borrado suave — no destruye la fila — con su
  **reverso contable**: un asiento espejo que neutraliza el original, auditable) o
  **recategorizarlo** (reversa y vuelve a contabilizar). Los movimientos anulados
  salen del dashboard, del resumen y de la recontabilización. Nuevo endpoint
  `POST /api/pwa-movimiento` (owner) + `_lib/corregir.js`; columnas `anulado`/
  `contab_version` vía DDL idempotente en runtime (sin `.sql` manual). En sesión
  (no autobuild) por tocar datos financieros. ✅

## 2026-07-09 (autobuild, corrida sin item elegible)
- Siguiendo `AUTOBUILD.md`, esta corrida sincronizó `main` (ya traía el
  rediseño de UI del PR #109, fusionado directo por Luis) y revisó el
  backlog de issues `autobuild`. **Mismo diagnóstico que las dos corridas
  anteriores** (#106 y la de #100/limpieza) — nada cambió desde entonces:
  - `#40`, `#41`, `#92`, `#98` siguen `autobuild-espera` con PR borrador
    abierto (`#58`, `#55`, `#96`, `#103`) esperando revisión de Luis.
  - `#51`, `#52` siguen siendo issues "padre" ya divididos en sub-issues.
  - `#100` sigue como propuesta abierta esperando aprobación — no se creó
    una segunda propuesta duplicada.
  - Sin issues `autofix` abiertos que deban tener prioridad.

  `npm test` → ✅ · `npm run build` → ✅ (sin cambios de comportamiento,
  solo `CHANGELOG.md`).

---

## 2026-07-08 (autobuild, corrida sin item elegible + limpieza de proceso)
- Siguiendo `AUTOBUILD.md`, esta corrida sincronizó `main` y revisó el backlog
  de issues `autobuild`. **Mismo diagnóstico que la corrida anterior (PR
  #106, fusionado ahora)** — nada cambió en las ~4 h entre corridas:
  - `#40`, `#41`, `#92`, `#98` siguen `autobuild-espera` con PR borrador
    abierto (`#58`, `#55`, `#96`, `#103`) esperando revisión de Luis.
  - `#51`, `#52` siguen siendo issues "padre" ya divididos en sub-issues.
  - `#100` sigue como propuesta abierta esperando aprobación — no se creó una
    segunda propuesta duplicada.
  - Ningún issue `autofix` abierto sin `autofix-espera` que deba tener
    prioridad.
- **Limpieza de proceso** (guardrail "sin trabajo silencioso"): las últimas
  corridas sin item elegible dejaban su propio PR de CHANGELOG abierto en
  borrador en vez de fusionarlo (aunque son cambios aditivos de riesgo nulo,
  que la regla general de `AUTOBUILD.md` dice fusionar con CI verde). Esta
  corrida:
  - **Fusionó #106** (la entrada de CHANGELOG más reciente y completa de esa
    serie, CI verde).
  - **Cerró sin fusionar**, por quedar duplicados/superados por #106: #105
    (mismo diagnóstico), #101 (propuesta #100 ya reflejada), #62 (muy
    desactualizado, el bookkeeping real —cerrar #37/#39— ya estaba hecho
    aparte) y #27 (versión temprana de `AUTOBUILD.md`, ya superada por el
    contenido fusionado en #20/#42/#59/#71). Ninguno perdía información real.

  `npm test` → ✅ · `npm run build` → ✅ (sin cambios de comportamiento, solo
  `CHANGELOG.md`).

## 2026-07-08 (autobuild, corrida sin item elegible)
- Siguiendo `AUTOBUILD.md`, esta corrida sincronizó `main` (ya traía la Auth
  PWA Google Sign-In del PR #104, fusionada por Luis directamente) y revisó
  el backlog de issues `autobuild`. **No había ningún item elegible para
  construir**, mismo diagnóstico que la corrida anterior (PR #105, aún sin
  fusionar):
  - `#40`, `#41`, `#92`, `#98` — etiqueta `autobuild-espera` con PR en
    borrador ya abierto (`#58`, `#55`, `#96`, `#103` respectivamente)
    esperando revisión de Luis.
  - `#51`, `#52` — issues "padre" ya divididos en sub-issues más chicos, en
    curso vía sus splits; no se toman directo.
  - `#100` — propuesta abierta (cuadre de saldos del extracto) esperando la
    aprobación de Luis. Como ya cubre el hueco de la cola, esta corrida **no
    creó una segunda propuesta** (evitar duplicar el mismo aviso).
  - No hay issues `autofix` abiertos que deban tener prioridad.

  Esta corrida **no fusionó ni construyó ningún código** — solo este cambio
  de documentación/CHANGELOG. `npm test` → 229/229 ✅ · `npm run build` → ✅
  (sin cambios de comportamiento).

## 2026-07-08 (autobuild, corrida nueva)
- **Auth de la PWA: Google Sign-In + token de sesión** (Issue #2 de auth): el
  navegador ya no hace OAuth de *access token* con el scope pesado
  `spreadsheets` (que reaparecía la pantalla de autorización de Google en cada
  apertura). Ahora solo hace **Google Sign-In** (ID token) y el backend emite un
  **token de sesión propio** (HMAC, 12 h) que se guarda en localStorage; dentro
  de esa ventana la app no vuelve a hablar con Google en cada recarga. Las dos
  últimas llamadas directas del navegador a Sheets (leer `⚙️ CUENTAS` y anexar
  el CET) pasan al backend (cuenta de servicio): nuevos `GET /api/pwa-cuentas` y
  `POST /api/pwa-login`; el CET se registra por `pwa-registrar`. Los `pwa-*`
  aceptan el token de sesión o, en transición, el access token viejo
  (`resolvePwaUser`). **Config pendiente antes de fusionar**: setear
  `AUTH_SECRET` en Netlify (ver `docs/auth-pwa-sesion.md`). Se elimina
  `services/sheets.js` del cliente. 🔎 en revisión.
- **[T8a] Roles de primera clase** (issue #97, sub-issue de #51 — split
  explicado en #97/#98): `verifyFinanceUser` ahora devuelve `{ email, rol }`
  leyendo la tabla `usuarios` (DDL + siembra idempotente en runtime, sin
  `.sql` manual); si el email no tiene fila (o la DB no responde), cae al
  mismo criterio que regía hoy vía `FINANZAS_OWNERS` (retrocompatible: nadie
  pierde ni gana acceso). `esOwner` pasa de una lista de emails hardcodeada a
  `rol === 'owner'`, reusado por los 9 endpoints que ya lo exigían. Además
  **cierra un hueco real**: `pwaIngresoHandler`, `pwaExtractoHandler`,
  `conciliacionHandler` (confirmar cruce) y `pwaBackfillHandler`
  (materializar líneas) escribían sin ningún gate de rol — cualquier email de
  `FINANZAS_USERS` podía registrar ingresos, cargar extractos, confirmar
  conciliación o materializar backfill; ahora exigen `owner` como el resto,
  cumpliendo la decisión documentada ("Solo Luis y Carolina escriben").
  Endpoint nuevo `GET /api/pwa-whoami` (equipo, lectura) para que la PWA
  (issue #98, bloqueado hasta que este se fusione) sepa qué rol tiene.
  **Pendiente**: #98 (ocultar botones de captura/edición en la PWA según el
  rol) queda para una corrida futura. 🤖 · PR #99 (en borrador, espera OK de
  Luis — candado/sensible). Closes #97.
- **Exports contables en CSV** (T12a, botón 📥, issue #91 — sub-issue de
  #52): descarga Libro Diario, Libro Mayor (por cuenta), Balance de
  Comprobación, Estado de Resultados y Balance General de un
  periodo/fecha. Los 5 reportes de solo lectura ya existentes responden
  CSV con `?formato=csv` (sin endpoints nuevos, sin escritura). Montos
  como número plano para Excel/Sheets. **Pendiente**: #92 (cierre
  mensual, la otra mitad de #52) queda para una corrida futura por su
  riesgo medio. 🤖 · PR #94. Closes #91.
- **Solicitudes de mejoras desde la PWA** (Nocturno 7/7, botón 💡): un
  textarea + botón crea un issue de GitHub (label `autobuild` +
  `enhancement`) para que Autobuild lo tome en una corrida futura; debajo,
  la lista de solicitudes/propuestas abiertas. Usa `GITHUB_TOKEN_FINANZAS`/
  `GITHUB_REPO_FINANZAS` (opcionales, sin secretos hardcodeados); sin el
  token configurado, degrada con gracia en vez de fallar. **Pendiente**:
  configurar `GITHUB_TOKEN_FINANZAS` en Netlify para activarla. 🤖 auto-ok
  · PR #89. Closes #78.
- **Préstamos entre Luis y Carolina** (Nocturno 6/7, botón 🤝): registra
  préstamos en ambos sentidos y muestra el saldo neto ("Carolina te debe
  $X" / "Le debes a Carolina $Y"), agrupado por moneda. Un abono es
  sencillamente un registro en sentido inverso; también se puede marcar un
  préstamo como saldado (sale del cálculo del neto). Esquema nuevo
  (`prestamos`) vía DDL idempotente en runtime — sin `.sql` manual.
  Escritura solo owners, lectura equipo. 🤖 auto-ok · PR #87. Closes #77.
- **Botón 🏠 en el header** (Nocturno 5/7): siempre accesible junto a los
  demás íconos, lleva al Home desde cualquier pantalla en un toque (antes
  había que usar "← Volver" varias veces). 🤖 auto-ok · PR #85. Closes #76.
- **Nuevo Home útil + "Registrar egresos"** (Nocturno 4/7): la captura de
  gastos (foto, galería, texto, CET, transferencia + últimos registros) se
  mudó intacta a una pantalla nueva "Registrar egresos". El Home ahora abre
  directo en un tablero: saldos en bancos (Caja + Bancos y billeteras),
  pagos pendientes/vencidos de este mes y pendientes del mes pasado (reusa
  #73), comparativo del gasto vs. mes anterior, y accesos rápidos a
  Registrar egresos / Ingresos / Pagos del mes / Reportes. 🤖 auto-ok · PR
  #83. Closes #75.
- **Plan de cuentas: más rubros de pasivo/activo + "＋ Agregar cuenta"**
  (Nocturno 3/7): en 🏦 Saldos Iniciales se agregan `2110` Obligaciones
  financieras (créditos bancarios/leasing), `1315` Cuentas por cobrar a
  empresas/socios y `2340` Cuentas por pagar a empresas/socios (DDL/inserts
  idempotentes en runtime, sin `.sql` manual). Además, una sección nueva para
  crear cuentas propias de Activo o Pasivo al vuelo, con código sugerido
  automático dentro de su clase y naturaleza inferida (solo owners). El
  asiento de apertura sigue cuadrando sin cambios (es agnóstico a la cuenta).
  🤖 auto-ok · PR #82. Closes #74.
- **Pagos del mes** (Nocturno 2/7, botón 📅): espejo del "Pagos Fijos" del Excel
  de Luis — ~12 conceptos sembrados (Arriendo, Internet, Claro/Tigo, Colegio
  Alemán, servicios…, DCDG y DCC) con día de vencimiento y estado ✅ pagado /
  ⏳ pendiente / 🔴 vencido. Marca/desmarca pagado, muestra los pendientes del
  mes pasado y el total pagado vs. pendiente; gestión para agregar/editar/
  desactivar pagos fijos (solo owners). Esquema nuevo (`pagos_fijos`,
  `pagos_estado`) vía DDL idempotente en runtime — sin `.sql` manual, como pide
  el modo `auto-ok`. 🤖 auto-ok · PR #80. Closes #73.
- **Backfill de extracto: "Contabilizar estas N líneas"** (Nocturno 1/7):
  en 🔗 Conciliación, las líneas `solo_extracto` (el banco las registró pero
  nunca se capturaron) ahora se pueden materializar directo desde ahí. Se
  clasifican automáticamente (reglas DCDG; Claude como respaldo acotado para
  las que no matchean ninguna regla) y se separan en **alta confianza**
  (pre-marcadas) y **dudosas** (tabla editable: categoría/subcategoría para
  gastos, entidad/cédula para ingresos, cuenta destino para transferencias).
  Al aceptar, cada línea crea su movimiento/ingreso ya `conciliado` y lo
  contabiliza (reusa T4); es idempotente (reintentar no duplica) y procesa en
  lotes acotados para no pasar el timeout de la function. 🤖 auto-ok · PR #79.
  Closes #72.
- **[T5] Libro Mayor + Balance de Comprobación**: `_lib/mayor.js` deriva, de los
  asientos de T2, el saldo corrido por cuenta (`GET /api/pwa-mayor?cuenta=`) y
  el balance de comprobación de todas las cuentas con movimiento
  (`GET /api/pwa-comprobacion`, valida Σdébito = Σcrédito). Pantalla PWA 📒
  de solo lectura para ambos. Cierra la Semana 1 del motor contable — base de
  Estado de Resultados (T6) y Balance General (T7). 🤖 PR #69.
- **Limpieza de cola**: cerré #45 (T2) y #46 (T3) — ya estaban fusionados a
  `main` (PR #65/#66) pero sus PR decían "Cierra #N" en vez de `Closes #N`,
  así que GitHub no los auto-cerró. Cerré también el PR borrador #60,
  duplicado de #45 ya superado por #65. Dejé anotado en #47 que hay dos PR
  borrador paralelos (#67/#68) para lo mismo — a la espera de que Luis elija
  cuál revisar.

## 2026-07-07
- Motor de cruce automático de conciliación (botón 🔗), fase 2 de
  docs/conciliacion.md: para un extracto a la vez, propone cruces entre sus
  líneas y lo capturado (`movimientos`/`ingresos` `provisional`); el usuario
  revisa y confirma antes de marcar `conciliado` (ante ambigüedad, elige
  manualmente entre los candidatos — nunca se auto-resuelve). 🤖 PR #57.
- Soporte de comprobantes en PDF en la PWA ("Elegir de galería"), solo 1 página
  por ahora: se manda como bloque `document` nativo de Anthropic reusando el
  mismo flujo de clasificación que las fotos; si el PDF trae más páginas o pesa
  de más, se avisa en vez de fallar en silencio. Límite exacto de tamaño y
  soporte multi-página quedan como decisiones abiertas; el lado SilvIA/WhatsApp
  queda fuera (otro repo). 🤖 PR #54.
- Cargador de extractos bancarios en CSV (botón 🧾): sube fecha/descripción/
  monto de una cuenta y un periodo y los deja guardados en `extracto_lineas`
  (`sin_conciliar`) — primer paso de la conciliación (docs/conciliacion.md);
  aún sin el motor de cruce automático. 🤖 PR #38. ✅

## 2026-07-06
- Dashboard: comparativo del periodo vs. el anterior (variación % del total y
  por categoría, "Este mes"/"Mes pasado"/"Año"). 🤖 PR #29. ✅
- **Autobuild activado** 🤖 — construcción autónoma de funcionalidades 24/7 desde
  la cola de issues `autobuild`, con auto-merge bajo CI verde y avisos por
  WhatsApp/email/este CHANGELOG. (Sistema base.) ✅
- Conciliación con extractos: diseño + esquema (`extractos`, `estado_conciliacion`). PR #19. ✅
- Captura de ingresos en la PWA (botón 💵). PR #16. ✅
- Dashboard online (botón 📊). PR #13. ✅
- Motor: Postgres (Neon) como fuente de verdad; el Sheet pasa a espejo. PR #10. ✅
- SilvIA: registrar tarjetas/cuentas (`registrar_cuenta`) + confiabilidad de reportes. PR #18. ✅
