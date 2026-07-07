# Migración a base de datos (Neon Postgres)

El Google Sheet dejó de ser la base de datos. Ahora la **fuente de verdad es
Postgres (Neon)** y el Sheet quedó como **espejo de exportación** (se sigue
llenando best-effort por si necesitas exportar/ver, pero ya no manda; si alguien
lo edita a mano no afecta al sistema).

## Por qué

- **Integridad:** llave `UNIQUE(idempotency_key)` + `INSERT … ON CONFLICT DO
  NOTHING` elimina los duplicados en el motor, inmune a reintentos y a escrituras
  en carrera. Se acabó el problema que veníamos parchando con heurísticas.
- **Control de acceso:** nadie edita la DB a mano; solo el backend con su token.
- **Consultas reales:** SQL responde cualquier pregunta (comparativos, rangos,
  búsquedas) — no solo el resumen fijo de antes.

## Arquitectura

```
  PWA ─┐
SilvIA ┼─▶  Backend (Netlify Functions)  ──▶  Postgres (Neon)   ← fuente de verdad
Aquí ──┘     registrarMovimiento()                  │
Dashboard    consultar()/resumen() = SQL            │ espejo best-effort
                                                     ▼
                                             Google Sheet (solo backup/lectura)
```

## Puesta en marcha (una sola vez)

1. **Crear proyecto en Neon** (https://neon.tech, plan gratis). Copia el
   *connection string* (formato `postgresql://usuario:clave@host/db?sslmode=require`).
2. **Cargar el esquema:** abre el editor SQL de Neon y pega el contenido de
   [`sql/schema.sql`](../sql/schema.sql). Es idempotente (se puede re-ejecutar).
3. **Configurar Netlify** (sitio `dcdg`): en *Site settings → Environment
   variables* agrega:
   - `DATABASE_URL` = el connection string de Neon.
4. **Redeploy** del sitio para que las funciones tomen la variable.

No hay que migrar el histórico: la DB **arranca desde la fecha de corte** (hoy).
Lo viejo se queda en el Sheet como archivo.

## Componentes

| Archivo | Rol |
|---|---|
| `sql/schema.sql` | DDL: `movimientos`, `empresas_mov`, `eventos`, y (Fase 1.5) `cuentas`/`categorias`/`reglas`. |
| `_lib/db.js` | Cliente Neon (import perezoso; inyectable en tests). |
| `_lib/repo.js` | Única capa que habla con la DB (insert/dedup/update/consulta). |
| `_lib/idempotency.js` | Deriva la llave de idempotencia del movimiento. |
| `_lib/finanzas.js` | Lógica: DB-primero + espejo al Sheet + reglas iWin/Delca2. |
| `_lib/sheet-mirror.js` | Espejo best-effort al Sheet (no bloquea la transacción). |
| `_lib/config-datos.js` | Fase 1.5: lee `categorias`/`reglas` de la DB, con `app/src/config/*.js` como fallback si no responde/aún no se sembró. |
| `scripts/seed-config-datos.js` | Siembra inicial (manual, una vez) de `categorias`/`reglas` desde los arrays hardcodeados. |
| `api-movimientos.js` | `GET/POST /api/movimientos` — lista/búsqueda para SilvIA y dashboard. |

## Idempotencia — cómo funciona

Cada movimiento lleva una `idempotency_key`:

- Si el llamador manda `source_msg_id` (p. ej. el id del mensaje de WhatsApp) o
  una `idempotency_key` explícita, se respeta (señal fuerte de "es lo mismo").
- Si no, se deriva de `tipo|fecha|monto|comercio` normalizado.

Un reintento con la misma llave devuelve `ya_existia: true` sin crear otra fila.
El dedup por **ventana de ±3 días** (monto ±1 · comercio) se conserva como
**pregunta humana** (`posible_duplicado`) para el caso "lo re-registro otro día".
Cuando confirmas (`confirmar: true`) un duplicado genuino, se fuerza una llave
única para que sí entre la segunda fila.

## Fase 1.5 — config-como-datos (primera versión)

`categorias` y `reglas` (tablas ya definidas en `sql/schema.sql` desde el motor
inicial) ahora se **leen primero de la DB** desde `classify.js` (backend) y
`/api/pwa-catalogos` (categorías de gasto para el formulario de la PWA), con
los arrays de `app/src/config/{rules,categories}.js` como **semilla** (ver
`scripts/seed-config-datos.js`, se corre una vez a mano contra Neon — no es
automático) y como **fallback** si Postgres no responde o la tabla sigue vacía.

Alcance de esta primera versión, y lo que queda pendiente/abierto:
- **`cuentas` queda fuera** — sigue viviendo en el Sheet `⚙️ CUENTAS`
  (`_lib/cuentas.js`); migrarla es una fase aparte.
- **Sin UI de edición todavía**: hoy se agrega con un `insert` directo en Neon
  (o reutilizando `insertCategoria`/`insertRegla` de `_lib/repo.js`), igual que
  antes se editaba `rules.js` a mano.
- **Abierto:** si el fallback a los arrays hardcodeados se queda permanente
  (red de seguridad) o es solo transición mientras se valida el modelo en uso
  real; si hace falta una UI mínima de alta/edición en una fase siguiente.

## Siguientes fases (no incluidas aquí)

- **Fase 2 — dashboard online:** página en el sitio Netlify (auth Google que ya
  existe) que consume `/api/movimientos` y `/api/resumen` con gráficos.
- **Export programada:** función agendada que vuelca la DB al Sheet como backup
  completo (hoy el espejo es incremental por escritura).
