# Preguntas por WhatsApp (SilvIA) — configuración

Cuando el cron de captura por correo detecta un movimiento que no puede
clasificar solo (v1: **transferencias salientes**), le pregunta por WhatsApp a
la persona dueña de la cuenta (Luis o Carolina) vía SilvIA, y siembra la
pregunta en el chat para que la respuesta se registre con las tools de finanzas.

## Variables de entorno

Del lado de **finanzas (sitio `dcdg`)** — `netlify/functions/_lib/silvia-preguntar.js`:

| Variable | Uso |
|----------|-----|
| `SILVIA_FINANZAS_PREGUNTA_URL` | Endpoint del CRM: `https://crm.superlikers.com/api/silvia-finanzas-pregunta` |
| `SILVIA_FINANZAS_PREGUNTA_SECRET` | Secret compartido con el CRM (header `x-finanzas-secret`). Respaldo: `AUTOBUILD_NOTIFY_SECRET`. |

Del lado del **CRM (sitio `sl-crm-live`)** — `netlify/functions/silvia-finanzas-pregunta.js`
valida el mismo `SILVIA_FINANZAS_PREGUNTA_SECRET` (respaldo `AUTOBUILD_NOTIFY_SECRET` / `AUTH_SECRET`).

> Si falta la URL **o** el secret del lado de finanzas, `preguntarSilvia` no envía
> nada y devuelve el motivo `SILVIA_FINANZAS_PREGUNTA_URL/SECRET no configurados.`.
> Las funciones de Netlify toman las variables al **desplegar**, no en caliente:
> tras cambiar un env var hay que redeploy en ambos sitios.

## Probar el carril

`GET /api/capturar-diagnostico?token=<DCDG_API_TOKEN>&preguntar=1&desde=YYYY-MM-DD&hasta=YYYY-MM-DD`
escanea la ventana y dispara las preguntas; devuelve `detalle` con `{a, clase,
monto, enviado, motivo}` por pendiente para ver si llegó o por qué falló.
