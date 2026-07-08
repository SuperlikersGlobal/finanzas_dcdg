/**
 * _lib/repo.js — Acceso a datos (Postgres). ÚNICA capa que habla con la DB.
 *
 * `finanzas.js` y los handlers dependen de estas funciones, no de SQL suelto.
 * Todas reciben un `sql` inyectable (default: el cliente Neon de db.js) para
 * poder testear sin red pasando un cliente falso con `.query(text, params)`.
 *
 * Se usa la forma parametrizada `sql.query(text, params)` (no template) para
 * poder componer filtros opcionales de forma segura.
 */

import { getSql } from './db.js';
import { ensureViajesSchema } from './viajes.js';
import { normalize } from '../../../app/src/config/rules.js';

/**
 * Inserta un movimiento. Idempotente: si la idempotency_key ya existe, NO crea
 * otra fila (ON CONFLICT DO NOTHING) y devuelve inserted:false con la existente.
 * @returns {Promise<{inserted: boolean, row: object}>}
 */
export async function insertMovimiento(m, sqlArg) {
  const sql = sqlArg || await getSql();
  await ensureTipoGastoSchema(sql);
  await ensureTransferenciaMonedaSchema(sql);
  await ensureViajesSchema(sql); // añade movimientos.viaje_id si falta
  const cols = ['fecha', 'tipo', 'categoria', 'subcategoria', 'descripcion', 'monto', 'moneda',
    'metodo_pago', 'quien_pago', 'tarjeta', 'cuenta_destino', 'notas', 'origen', 'idempotency_key',
    'estado_conciliacion', 'extracto_linea_id', 'tipo_gasto', 'tipo_gasto_persona', 'tipo_gasto_auto',
    'monto_destino', 'moneda_destino', 'viaje_id', 'beneficiario'];
  const vals = [m.fecha, m.tipo, m.categoria, m.subcategoria, m.descripcion, m.monto, m.moneda || 'COP',
    m.metodo_pago, m.quien_pago, m.tarjeta, m.cuenta_destino || null, m.notas, m.origen, m.idempotency_key,
    m.estado_conciliacion || 'provisional', m.extracto_linea_id || null,
    m.tipo_gasto || 'hogar', m.tipo_gasto_persona || null, m.tipo_gasto_auto === undefined ? true : !!m.tipo_gasto_auto,
    m.monto_destino || null, m.moneda_destino || null, m.viaje_id || null, m.beneficiario || 'familia'];
  const ph = vals.map((_, i) => `$${i + 1}`).join(', ');
  const ins = await sql.query(
    `insert into movimientos (${cols.join(', ')}) values (${ph})
     on conflict (idempotency_key) do nothing
     returning *`,
    vals
  );
  if (ins.length) return { inserted: true, row: ins[0] };
  // Colisión: ya existía. Devuelve la fila existente por su llave.
  const prev = await sql.query(
    'select * from movimientos where idempotency_key = $1 limit 1',
    [m.idempotency_key]
  );
  return { inserted: false, row: prev[0] || null };
}

/**
 * Busca un posible duplicado "humano": mismo monto (±1) y comercio (6 chars)
 * dentro de una ventana de ±ventanaDias. Para preguntar antes de escribir cuando
 * el evento no es un reintento exacto (p. ej. re-registrado otro día).
 * @returns {Promise<null | {id, metodo_pago, tarjeta, fecha}>}
 */
export async function findPosibleDuplicado({ fecha, monto, descripcion, ventanaDias = 3 }, sqlArg) {
  const sql = sqlArg || await getSql();
  const m = Number(monto) || 0;
  const desc6 = normalize(descripcion).slice(0, 6);
  if (!fecha || !m || desc6.length < 3) return null;
  const cand = await sql.query(
    `select id, fecha, descripcion, monto, metodo_pago, tarjeta
       from movimientos
      where monto between $1 and $2
        and fecha between ($3::date - ($4 || ' days')::interval) and ($3::date + ($4 || ' days')::interval)
      order by creado_en desc
      limit 40`,
    [m - 1, m + 1, fecha, ventanaDias]
  );
  for (const r of cand) {
    if (normalize(r.descripcion).slice(0, 6) === desc6) {
      return { id: r.id, metodo_pago: (r.metodo_pago || '').trim(), tarjeta: (r.tarjeta || '').trim(), fecha: r.fecha };
    }
  }
  return null;
}

/** Completa cuenta/tarjeta de un movimiento existente (caso "…ah, fue con la 7730"). */
export async function updateMovimientoCuenta(id, { metodo_pago, tarjeta }, sqlArg) {
  const sql = sqlArg || await getSql();
  const rows = await sql.query(
    `update movimientos
        set metodo_pago = coalesce(nullif($2,''), metodo_pago),
            tarjeta     = coalesce(nullif($3,''), tarjeta),
            actualizado_en = now()
      where id = $1
      returning *`,
    [id, metodo_pago || '', tarjeta || '']
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Corrección de movimientos (anular / recategorizar) — aditivo, DDL idempotente.
// ---------------------------------------------------------------------------
let _correccionSchemaPromise = null;

/** DDL idempotente: columnas para anular y versionar la contabilización. */
export async function ensureCorreccionSchema(sqlArg) {
  const sql = sqlArg || await getSql();
  if (!_correccionSchemaPromise) {
    _correccionSchemaPromise = (async () => {
      await sql.query('alter table movimientos add column if not exists anulado boolean not null default false', []);
      await sql.query('alter table movimientos add column if not exists anulado_en timestamptz', []);
      await sql.query('alter table movimientos add column if not exists anulado_motivo text', []);
      await sql.query('alter table movimientos add column if not exists contab_version int not null default 1', []);
    })().catch((e) => { _correccionSchemaPromise = null; throw e; });
  }
  return _correccionSchemaPromise;
}

/** Para tests: olvida la memoización del DDL. */
export function resetCorreccionSchemaParaTests() { _correccionSchemaPromise = null; }

// ---------------------------------------------------------------------------
// Clasificar gasto hogar vs. personal (issue #114, Contab. familiar B,
// `auto-ok`) — aditivo, DDL idempotente en runtime, mismo patrón que
// ensureCorreccionSchema.
// ---------------------------------------------------------------------------
let _tipoGastoSchemaPromise = null;

export const TIPOS_GASTO = ['hogar', 'personal'];

/** DDL idempotente: columnas para marcar un movimiento hogar/personal. */
export async function ensureTipoGastoSchema(sqlArg) {
  const sql = sqlArg || await getSql();
  if (!_tipoGastoSchemaPromise) {
    _tipoGastoSchemaPromise = (async () => {
      await sql.query("alter table movimientos add column if not exists tipo_gasto text not null default 'hogar'", []);
      await sql.query('alter table movimientos add column if not exists tipo_gasto_persona text', []);
      await sql.query('alter table movimientos add column if not exists tipo_gasto_auto boolean not null default true', []);
    })().catch((e) => { _tipoGastoSchemaPromise = null; throw e; });
  }
  return _tipoGastoSchemaPromise;
}

/** Para tests: olvida la memoización del DDL. */
export function resetTipoGastoSchemaParaTests() { _tipoGastoSchemaPromise = null; }

// ---------------------------------------------------------------------------
// Transferencias entre monedas (issue #121, `auto-ok`) — aditivo, DDL
// idempotente en runtime, mismo patrón que ensureTipoGastoSchema. Una
// transferencia puede llevar la segunda pata (lo que realmente llegó al
// destino) cuando origen y destino están en monedas distintas (USD↔COP).
// ---------------------------------------------------------------------------
let _transferenciaMonedaSchemaPromise = null;

/** DDL idempotente: columnas para la pata de destino de una transferencia cross-currency. */
export async function ensureTransferenciaMonedaSchema(sqlArg) {
  const sql = sqlArg || await getSql();
  if (!_transferenciaMonedaSchemaPromise) {
    _transferenciaMonedaSchemaPromise = (async () => {
      await sql.query('alter table movimientos add column if not exists monto_destino numeric(14,2)', []);
      await sql.query('alter table movimientos add column if not exists moneda_destino text', []);
    })().catch((e) => { _transferenciaMonedaSchemaPromise = null; throw e; });
  }
  return _transferenciaMonedaSchemaPromise;
}

/** Para tests: olvida la memoización del DDL. */
export function resetTransferenciaMonedaSchemaParaTests() { _transferenciaMonedaSchemaPromise = null; }

/** Asiento (con sus líneas) por su idempotency_key. Para poder reversarlo. */
export async function getAsientoByKey(key, sqlArg) {
  const sql = sqlArg || await getSql();
  const rows = await sql.query(
    `select a.id, a.fecha, a.descripcion, a.entidad_id,
            coalesce(json_agg(json_build_object('cuenta', l.cuenta, 'debito', l.debito, 'credito', l.credito) order by l.id)
                     filter (where l.id is not null), '[]') as lineas
       from asientos a left join asiento_lineas l on l.asiento_id = a.id
      where a.idempotency_key = $1
      group by a.id
      limit 1`, [key]);
  return rows[0] || null;
}

/** Marca un movimiento como anulado (borrado suave — no destruye la fila). */
export async function anularMovimiento(id, motivo, sqlArg) {
  const sql = sqlArg || await getSql();
  await ensureCorreccionSchema(sql);
  const rows = await sql.query(
    `update movimientos
        set anulado = true, anulado_en = now(), anulado_motivo = $2, actualizado_en = now()
      where id = $1
      returning *`, [id, motivo || null]);
  return rows[0] || null;
}

// ── Mantenimiento de datos ───────────────────────────────────────────────────

/** Unifica una categoría escrita distinto (p. ej. "Gastos Luhijo-Luciano" →
 *  "Gastos Luhijo - Luciano"). Devuelve cuántas filas se renombraron. */
export async function renombrarCategoria(desde, hacia, sqlArg) {
  const sql = sqlArg || await getSql();
  const rows = await sql.query(
    `update movimientos set categoria = $2, actualizado_en = now()
      where categoria = $1 and not coalesce(anulado,false)
      returning id`, [desde, hacia]);
  return rows.length;
}

/** Anula (borrado suave) las filas con monto inválido (NaN) — basura de un mal
 *  parseo anterior que contaminaba las sumas. Devuelve cuántas se anularon. */
export async function anularMontosNaN(sqlArg) {
  const sql = sqlArg || await getSql();
  await ensureCorreccionSchema(sql);
  const rows = await sql.query(
    `update movimientos
        set anulado = true, anulado_en = now(),
            anulado_motivo = 'monto inválido (NaN) — limpieza automática', actualizado_en = now()
      where coalesce(monto::text,'') = 'NaN' and not coalesce(anulado,false)
      returning id`);
  return rows.length;
}

/** Busca movimientos recientes por monto (±1) y texto opcional, para ubicar cuál
 *  corregir cuando SilvIA reclasifica ("la de $26.000 era X"). Excluye anulados y
 *  transferencias; ordena por fecha desc. Devuelve varios para desambiguar. */
export async function buscarMovimientosPorMonto({ monto, texto, dias = 45, limit = 6 }, sqlArg) {
  const sql = sqlArg || await getSql();
  await ensureCorreccionSchema(sql);
  const m = Number(monto);
  if (!Number.isFinite(m)) return [];
  const d = Math.max(1, Math.min(Number(dias) || 45, 365));
  const params = [m];
  let filtro = `not coalesce(anulado,false) and coalesce(tipo,'gasto') <> 'transferencia'
      and coalesce(monto::text,'') <> 'NaN' and abs(monto::numeric - $1) <= 1
      and fecha >= (current_date - ($2 || ' days')::interval)`;
  params.push(String(d));
  if (texto) { params.push(`%${String(texto).toLowerCase()}%`); filtro += ` and lower(coalesce(descripcion,'')) like $${params.length}`; }
  params.push(Math.max(1, Math.min(Number(limit) || 6, 20)));
  const rows = await sql.query(
    `select id, fecha, tipo, categoria, subcategoria, descripcion, monto, moneda, metodo_pago, quien_pago
       from movimientos where ${filtro}
      order by fecha desc, creado_en desc limit $${params.length}`, params);
  return rows;
}

/** Diagnóstico: busca movimientos por texto en descripción o método de pago,
 *  INCLUYENDO anulados, para depurar "lo registré pero no aparece". */
export async function diagBuscarMovimientos(texto, sqlArg) {
  const sql = sqlArg || await getSql();
  const q = `%${String(texto || '').toLowerCase()}%`;
  const rows = await sql.query(
    `select id, fecha, descripcion, monto, moneda, metodo_pago, tipo, origen,
            coalesce(anulado,false) as anulado, anulado_motivo, creado_en
       from movimientos
      where lower(descripcion) like $1 or lower(coalesce(metodo_pago,'')) like $1
      order by creado_en desc
      limit 25`, [q]);
  return rows;
}

/** Corrige la moneda de los movimientos pagados con cuentas en dólares (Mercury
 *  Delca2 7730, DollarApp, TC iWin). Regla: el peso colombiano no tiene centavos,
 *  así que un monto FRACCIONARIO = USD y uno ENTERO = COP (esas cuentas también
 *  gastan en pesos en comercios locales). Auto-corrige (idempotente): revierte a
 *  COP lo que se marcó USD por error y marca USD solo los montos con centavos. */
export async function corregirMonedaCuentasUSD(sqlArg) {
  const sql = sqlArg || await getSql();
  const base = `not coalesce(anulado,false)
        and coalesce(tipo,'gasto') <> 'transferencia'
        and coalesce(monto::text,'') <> 'NaN'
        and (
             coalesce(tarjeta,'') = '7730'
          or metodo_pago ilike '%7730%'
          or metodo_pago ilike '%delca2%'
          or metodo_pago ilike '%mercury%'
          or metodo_pago ilike '%dollarapp%'
          or metodo_pago ilike '%dolar app%'
          or metodo_pago ilike '%jeeves%'
          or metodo_pago ilike '%superlikers%'
          or metodo_pago ilike '%iwin%'
        )`;
  // 1) Revertir a COP lo marcado USD por error: montos enteros = pesos.
  const revertidos = await sql.query(
    `update movimientos set moneda = 'COP', actualizado_en = now()
      where moneda = 'USD' and ${base} and monto::numeric = trunc(monto::numeric)
      returning id`);
  // 2) Marcar USD solo los montos con centavos (fraccionarios). Solo toca filas en
  //    COP: una moneda explícita distinta (MXN, EUR…) NO se reinterpreta como USD.
  const marcados = await sql.query(
    `update movimientos set moneda = 'USD', actualizado_en = now()
      where coalesce(moneda,'COP') = 'COP' and ${base} and monto::numeric <> trunc(monto::numeric)
      returning id, fecha, descripcion, monto, metodo_pago`);
  return { revertidos: revertidos.length, marcados };
}

/** Actualiza los campos editables de un movimiento (recategorizar). */
export async function updateMovimientoCampos(id, campos, sqlArg) {
  const sql = sqlArg || await getSql();
  await ensureCorreccionSchema(sql);
  const rows = await sql.query(
    `update movimientos
        set tipo         = coalesce(nullif($2,''), tipo),
            categoria    = coalesce($3, categoria),
            subcategoria = coalesce($4, subcategoria),
            descripcion  = coalesce(nullif($5,''), descripcion),
            contab_version = coalesce($6, contab_version),
            fecha        = coalesce(nullif($7,'')::date, fecha),
            actualizado_en = now()
      where id = $1
      returning *`,
    [id, campos.tipo || '', campos.categoria ?? null, campos.subcategoria ?? null,
      campos.descripcion || '', campos.contab_version ?? null, campos.fecha || '']);
  return rows[0] || null;
}

/** Inserta un movimiento empresa↔familia (adelanto iWin / retiro Delca2). */
export async function insertEmpresa(e, sqlArg) {
  const sql = sqlArg || await getSql();
  const cols = ['empresa', 'flujo', 'mes', 'anio', 'concepto', 'titular', 'monto',
    'moneda', 'estado', 'origen', 'movimiento_id'];
  const vals = [e.empresa, e.flujo, e.mes, e.anio, e.concepto, e.titular, e.monto,
    e.moneda || 'COP', e.estado, e.origen, e.movimiento_id || null];
  const ph = vals.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await sql.query(
    `insert into empresas_mov (${cols.join(', ')}) values (${ph}) returning *`, vals
  );
  return rows[0] || null;
}

/** Bitácora append-only. Best-effort: nunca debe tumbar una transacción. */
export async function logEvento(tipo, origen, payload, sqlArg) {
  try {
    const sql = sqlArg || await getSql();
    await sql.query(
      'insert into eventos (tipo, origen, payload) values ($1, $2, $3)',
      [tipo, origen, JSON.stringify(payload || {})]
    );
  } catch (_) { /* la auditoría no bloquea */ }
}

/** Totales y desglose por categoría en un rango. */
export async function queryResumen({ desde, hasta, categoria, quien }, sqlArg) {
  const sql = sqlArg || await getSql();
  await ensureCorreccionSchema(sql);
  await ensureViajesSchema(sql); // garantiza la columna `beneficiario`
  const params = [desde, hasta];
  // Excluye transferencias (no son gasto), anulados, y limita el total a COP (no
  // se mezclan monedas). Los movimientos en USD se ven en la lista, no en el total.
  // `coalesce(monto::text,'') <> 'NaN'` excluye filas con monto NaN (basura de un
  // mal parseo anterior): en SQL, un solo NaN vuelve NaN toda la suma → el total
  // salía "$0". Type-agnostic (numeric o float8). Se prevé el origen del NaN en
  // registrarMovimiento/parseMontoCOP, pero esto protege el resumen igual.
  // `beneficiario <> 'empresa'` excluye gastos de iWin (tarjeta Jeeves usada para
  // costos de la empresa): se rastrean pero NO cuentan en el presupuesto familiar.
  let filtro = "fecha >= $1 and fecha <= $2 and coalesce(tipo,'gasto') <> 'transferencia' and coalesce(moneda,'COP') = 'COP' and not coalesce(anulado,false) and coalesce(monto::text,'') <> 'NaN' and coalesce(beneficiario,'familia') <> 'empresa'";
  if (categoria) { params.push(`%${categoria.toLowerCase()}%`); filtro += ` and lower(categoria) like $${params.length}`; }
  if (quien) { params.push(`%${quien.toLowerCase()}%`); filtro += ` and lower(coalesce(quien_pago,'')) like $${params.length}`; }
  const agg = await sql.query(
    `select coalesce(sum(monto),0)::float8 as total, count(*)::int as n from movimientos where ${filtro}`,
    params
  );
  const desglose = await sql.query(
    `select coalesce(categoria,'Sin categoría') as categoria, sum(monto)::float8 as monto
       from movimientos where ${filtro}
      group by 1 order by 2 desc`,
    params
  );
  const porDescripcion = await sql.query(
    `select descripcion, sum(monto)::float8 as monto
       from movimientos where ${filtro}
      group by 1 order by 2 desc
      limit 5`,
    params
  );
  return { total: agg[0].total, movimientos: agg[0].n, por_categoria: desglose, por_descripcion: porDescripcion };
}

// ---------------------------------------------------------------------------
// Plan de cuentas (PUC simplificado) — base de la partida doble.
// ---------------------------------------------------------------------------

/** Lista el plan de cuentas activo (opcionalmente filtra por clase 1–6). */
export async function listPlanCuentas({ clase } = {}, sqlArg) {
  await ensurePlanCuentasSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const params = [];
  let filtro = 'activo';
  if (clase != null && clase !== '') { params.push(Number(clase)); filtro += ` and clase = $${params.length}`; }
  return sql.query(
    `select codigo, nombre, clase, naturaleza, cuenta_padre
       from plan_cuentas where ${filtro} order by codigo`,
    params
  );
}

/** Devuelve una cuenta del PUC por su código (o null). */
export async function getPlanCuenta(codigo, sqlArg) {
  await ensurePlanCuentasSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const rows = await sql.query(
    'select codigo, nombre, clase, naturaleza, cuenta_padre from plan_cuentas where codigo = $1 limit 1',
    [String(codigo || '')]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Ampliación del plan de cuentas (issue #74, Nocturno 3/7, `auto-ok`): más
// rubros de pasivo (obligaciones financieras, CxP a empresas) y activo (CxC a
// empresas), y la opción de agregar cuentas propias desde la pantalla 🏦. El
// plan base vive en sql/plan-cuentas.sql (ya corrido a mano en Neon); esto se
// agrega con DDL/inserts idempotentes en runtime, sin `.sql` manual — mismo
// patrón que ensurePagosFijosSchema. Memoizado.
// ---------------------------------------------------------------------------
let _planCuentasExtraPromise = null;

const PLAN_CUENTAS_EXTRA_SEED = [
  { codigo: '2110', nombre: 'Obligaciones financieras (créditos bancarios/leasing)', clase: 2, naturaleza: 'credito', cuenta_padre: '21' },
  { codigo: '1315', nombre: 'Cuentas por cobrar a empresas/socios', clase: 1, naturaleza: 'debito', cuenta_padre: '13' },
  { codigo: '2340', nombre: 'Cuentas por pagar a empresas/socios', clase: 2, naturaleza: 'credito', cuenta_padre: '23' },
  { codigo: '1115', nombre: 'Fondo común del hogar', clase: 1, naturaleza: 'debito', cuenta_padre: '11' },
];

/** Crea (si no existe) `plan_cuentas` y agrega las cuentas nuevas del catálogo. Memoizado. */
export async function ensurePlanCuentasSchema(sqlArg) {
  if (!_planCuentasExtraPromise) {
    _planCuentasExtraPromise = aplicarPlanCuentasExtra(sqlArg)
      .catch((e) => { _planCuentasExtraPromise = null; throw e; }); // reintentable si falló
  }
  return _planCuentasExtraPromise;
}

async function aplicarPlanCuentasExtra(sqlArg) {
  const sql = sqlArg || await getSql();
  await sql.query(`
    create table if not exists plan_cuentas (
      codigo       text primary key,
      nombre       text not null,
      clase        int  not null,
      naturaleza   text not null default 'debito',
      cuenta_padre text references plan_cuentas (codigo),
      entidad_id   bigint references entidades (id),
      activo       boolean not null default true,
      creado_en    timestamptz not null default now()
    )
  `, []);
  await sql.query('create index if not exists plan_cuentas_clase_idx on plan_cuentas (clase)', []);
  for (const c of PLAN_CUENTAS_EXTRA_SEED) {
    await sql.query(
      `insert into plan_cuentas (codigo, nombre, clase, naturaleza, cuenta_padre)
       values ($1, $2, $3, $4, $5)
       on conflict (codigo) do nothing`,
      [c.codigo, c.nombre, c.clase, c.naturaleza, c.cuenta_padre]
    );
  }
}

/** Solo para tests: fuerza a que la próxima llamada vuelva a intentar el DDL/seed. */
export function resetPlanCuentasSchemaParaTests() {
  _planCuentasExtraPromise = null;
}

// ---------------------------------------------------------------------------
// Metadatos de cuentas (issue #112, `auto-ok`): quién es el dueño de cada
// cuenta del catálogo `⚙️ CUENTAS` y a qué bolsillo pertenece, para que la
// contabilización deje de agrupar por palabra clave del nombre y pueda
// distinguir "el efectivo de Luis" de "la tarjeta de Carolina". Aditivo, DDL
// idempotente en runtime — mismo patrón que ensurePlanCuentasSchema. Memoizado.
// ---------------------------------------------------------------------------
let _cuentasMetaSchemaPromise = null;

export const DUENOS_CUENTA = ['luis', 'carolina', 'comun'];
export const BOLSILLOS_CUENTA = ['comun', 'gasto_individual', 'patrimonio_individual'];

/** Crea (si no existe) `cuentas_meta`. Memoizado. */
export async function ensureCuentasMetaSchema(sqlArg) {
  if (!_cuentasMetaSchemaPromise) {
    _cuentasMetaSchemaPromise = (async () => {
      const sql = sqlArg || await getSql();
      await ensurePlanCuentasSchema(sql); // cuenta_puc referencia plan_cuentas
      await sql.query(`
        create table if not exists cuentas_meta (
          id             bigint generated always as identity primary key,
          nombre         text not null unique,
          dueno          text not null default 'comun',
          bolsillo       text not null default 'comun',
          cuenta_puc     text references plan_cuentas (codigo),
          creado_en      timestamptz not null default now(),
          actualizado_en timestamptz not null default now()
        )
      `, []);
    })().catch((e) => { _cuentasMetaSchemaPromise = null; throw e; });
  }
  return _cuentasMetaSchemaPromise;
}

/** Solo para tests: fuerza a que la próxima llamada vuelva a intentar el DDL. */
export function resetCuentasMetaSchemaParaTests() {
  _cuentasMetaSchemaPromise = null;
}

/** Metadatos de todas las cuentas con fila propia (las que no tienen fila usan el fallback por heurística). */
export async function listCuentasMeta(sqlArg) {
  await ensureCuentasMetaSchema(sqlArg);
  const sql = sqlArg || await getSql();
  return sql.query('select nombre, dueno, bolsillo, cuenta_puc from cuentas_meta order by nombre', []);
}

/** Crea/actualiza los metadatos de una cuenta (gestión, solo owners). */
export async function upsertCuentaMeta({ nombre, dueno, bolsillo, cuenta_puc } = {}, sqlArg) {
  const nombreLimpio = String(nombre || '').trim();
  if (!nombreLimpio) throw new Error('Falta el nombre de la cuenta.');
  const d = String(dueno || 'comun').trim().toLowerCase();
  const b = String(bolsillo || 'comun').trim().toLowerCase();
  if (!DUENOS_CUENTA.includes(d)) throw new Error(`dueno inválido (usa ${DUENOS_CUENTA.join('|')}).`);
  if (!BOLSILLOS_CUENTA.includes(b)) throw new Error(`bolsillo inválido (usa ${BOLSILLOS_CUENTA.join('|')}).`);
  const puc = cuenta_puc ? String(cuenta_puc).trim() : null;
  await ensureCuentasMetaSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const rows = await sql.query(
    `insert into cuentas_meta (nombre, dueno, bolsillo, cuenta_puc)
     values ($1, $2, $3, $4)
     on conflict (nombre) do update
       set dueno = excluded.dueno, bolsillo = excluded.bolsillo, cuenta_puc = excluded.cuenta_puc,
           actualizado_en = now()
     returning nombre, dueno, bolsillo, cuenta_puc`,
    [nombreLimpio, d, b, puc]
  );
  return rows[0];
}

/** Naturaleza contable esperada por clase (1 Activo … 6 Costos). Débito: activo/gasto/costo. */
export function naturalezaDeClase(clase) {
  return [1, 5, 6].includes(Number(clase)) ? 'debito' : 'credito';
}

/** Sugiere el próximo código "hoja" (≥4 dígitos) libre dentro de una clase. */
export async function sugerirCodigoCuenta(clase, sqlArg) {
  await ensurePlanCuentasSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const claseNum = Number(clase);
  const rows = await sql.query(
    'select codigo from plan_cuentas where clase = $1 and length(codigo) >= 4 order by codigo desc limit 1',
    [claseNum]
  );
  const ultimo = rows[0] && rows[0].codigo;
  return ultimo ? String(Number(ultimo) + 5) : `${claseNum}105`;
}

/** Agrega una cuenta nueva de Activo (1) o Pasivo (2) al plan de cuentas (gestión, solo owners). */
export async function insertPlanCuenta({ nombre, clase, cuenta_padre, codigo } = {}, sqlArg) {
  const claseNum = Number(clase);
  if (![1, 2].includes(claseNum)) throw new Error('Solo se pueden agregar cuentas de Activo (1) o Pasivo (2).');
  const nombreLimpio = String(nombre || '').trim();
  if (!nombreLimpio) throw new Error('El nombre de la cuenta es obligatorio.');
  await ensurePlanCuentasSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const cod = codigo || await sugerirCodigoCuenta(claseNum, sql);
  const naturaleza = naturalezaDeClase(claseNum);
  const padre = cuenta_padre || String(claseNum);
  const rows = await sql.query(
    `insert into plan_cuentas (codigo, nombre, clase, naturaleza, cuenta_padre)
     values ($1, $2, $3, $4, $5)
     returning codigo, nombre, clase, naturaleza, cuenta_padre`,
    [cod, nombreLimpio, claseNum, naturaleza, padre]
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Libro diario de partida doble (asientos) — T2.
// ---------------------------------------------------------------------------

/** Inserta la cabecera de un asiento. Idempotente por idempotency_key. */
export async function insertAsiento(a, sqlArg) {
  const sql = sqlArg || await getSql();
  const cols = ['fecha', 'descripcion', 'entidad_id', 'origen', 'estado', 'estado_conciliacion', 'idempotency_key'];
  const vals = [a.fecha, a.descripcion || null, a.entidad_id || null, a.origen || 'manual',
    a.estado || 'contabilizado', a.estado_conciliacion || 'provisional', a.idempotency_key];
  const ph = vals.map((_, i) => `$${i + 1}`).join(', ');
  const ins = await sql.query(
    `insert into asientos (${cols.join(', ')}) values (${ph})
     on conflict (idempotency_key) do nothing returning *`, vals);
  if (ins.length) return { inserted: true, row: ins[0] };
  const prev = await sql.query('select * from asientos where idempotency_key = $1 limit 1', [a.idempotency_key]);
  return { inserted: false, row: prev[0] || null };
}

/** Inserta los renglones de un asiento (una sola sentencia multi-fila). */
export async function insertAsientoLineas(asiento_id, lineas, sqlArg) {
  const sql = sqlArg || await getSql();
  if (!lineas || !lineas.length) return [];
  const cols = ['asiento_id', 'cuenta', 'debito', 'credito', 'tercero_id', 'movimiento_id', 'ingreso_id'];
  const vals = [];
  const groups = lineas.map((l, i) => {
    const base = i * cols.length;
    vals.push(asiento_id, l.cuenta, Number(l.debito) || 0, Number(l.credito) || 0,
      l.tercero_id || null, l.movimiento_id || null, l.ingreso_id || null);
    return `(${cols.map((_, j) => `$${base + j + 1}`).join(', ')})`;
  });
  return sql.query(
    `insert into asiento_lineas (${cols.join(', ')}) values ${groups.join(', ')} returning *`, vals);
}

/** Libro diario: asientos en un rango, cada uno con sus renglones. */
export async function queryAsientos({ desde, hasta, entidad_id, limit = 100 } = {}, sqlArg) {
  const sql = sqlArg || await getSql();
  const params = [];
  const cond = [];
  if (desde) { params.push(desde); cond.push(`a.fecha >= $${params.length}`); }
  if (hasta) { params.push(hasta); cond.push(`a.fecha <= $${params.length}`); }
  if (entidad_id) { params.push(entidad_id); cond.push(`a.entidad_id = $${params.length}`); }
  const where = cond.length ? `where ${cond.join(' and ')}` : '';
  params.push(Math.min(Number(limit) || 100, 500));
  return sql.query(
    `select a.id, a.fecha, a.descripcion, a.entidad_id, a.origen, a.estado, a.estado_conciliacion,
            coalesce(json_agg(json_build_object('cuenta', l.cuenta, 'debito', l.debito, 'credito', l.credito)
                     order by l.id) filter (where l.id is not null), '[]') as lineas
       from asientos a
       left join asiento_lineas l on l.asiento_id = a.id
       ${where}
      group by a.id
      order by a.fecha desc, a.id desc
      limit $${params.length}`, params);
}

/** Renglones de una cuenta en un rango, con fecha/descripción del asiento — Libro Mayor (T5). */
export async function queryLineasCuenta({ cuenta, desde, hasta, entidad_id, limit = 500 } = {}, sqlArg) {
  const sql = sqlArg || await getSql();
  const params = [cuenta];
  const cond = ['l.cuenta = $1'];
  if (desde) { params.push(desde); cond.push(`a.fecha >= $${params.length}`); }
  if (hasta) { params.push(hasta); cond.push(`a.fecha <= $${params.length}`); }
  if (entidad_id) { params.push(entidad_id); cond.push(`a.entidad_id = $${params.length}`); }
  params.push(Math.min(Number(limit) || 500, 2000));
  return sql.query(
    `select a.id as asiento_id, a.fecha, a.descripcion, l.debito, l.credito
       from asiento_lineas l join asientos a on a.id = l.asiento_id
      where ${cond.join(' and ')}
      order by a.fecha asc, a.id asc
      limit $${params.length}`, params);
}

/**
 * Σdébito/Σcrédito por cuenta en un rango, con su naturaleza — Balance de
 * Comprobación (T5). `soloSinEntidad` filtra los asientos sin dueño individual
 * (bolsillo "Común", #115) — tiene prioridad sobre `entidad_id` si ambos llegan.
 */
export async function queryComprobacion({ desde, hasta, entidad_id, soloSinEntidad } = {}, sqlArg) {
  const sql = sqlArg || await getSql();
  const params = [];
  const cond = [];
  if (desde) { params.push(desde); cond.push(`a.fecha >= $${params.length}`); }
  if (hasta) { params.push(hasta); cond.push(`a.fecha <= $${params.length}`); }
  if (soloSinEntidad) { cond.push(`a.entidad_id is null`); }
  else if (entidad_id) { params.push(entidad_id); cond.push(`a.entidad_id = $${params.length}`); }
  const where = cond.length ? `where ${cond.join(' and ')}` : '';
  return sql.query(
    `select p.codigo, p.nombre, p.clase, p.naturaleza,
            coalesce(sum(l.debito), 0) as debito, coalesce(sum(l.credito), 0) as credito
       from asiento_lineas l
       join asientos a on a.id = l.asiento_id
       join plan_cuentas p on p.codigo = l.cuenta
       ${where}
      group by p.codigo, p.nombre, p.clase, p.naturaleza
      order by p.codigo`, params);
}

// ---------------------------------------------------------------------------
// Contabilización automática (T4): reglas de mapeo + búsquedas de apoyo.
// ---------------------------------------------------------------------------

/** Reglas de mapeo captura → PUC (categoría/cédula/medio → cuenta). */
export async function listReglasContables(sqlArg) {
  const sql = sqlArg || await getSql();
  return sql.query('select ambito, clave, cuenta from reglas_contables', []);
}

/** Un movimiento por id (para contabilizarlo). */
export async function getMovimiento(id, sqlArg) {
  const sql = sqlArg || await getSql();
  const rows = await sql.query('select * from movimientos where id = $1 limit 1', [id]);
  return rows[0] || null;
}

/** Un ingreso por id (para contabilizarlo). */
export async function getIngreso(id, sqlArg) {
  const sql = sqlArg || await getSql();
  const rows = await sql.query('select * from ingresos where id = $1 limit 1', [id]);
  return rows[0] || null;
}

/** id de una entidad por nombre (p. ej. quien_pago 'Luis'), o null. */
export async function entidadIdPorNombre(nombre, sqlArg) {
  const n = String(nombre || '').trim();
  if (!n) return null;
  const sql = sqlArg || await getSql();
  const rows = await sql.query('select id from entidades where lower(nombre) = lower($1) limit 1', [n]);
  return rows[0] ? rows[0].id : null;
}

/** Movimientos que todavía no tienen asiento (para recontabilizar en lote). */
export async function movimientosSinAsiento({ limit = 500 } = {}, sqlArg) {
  const sql = sqlArg || await getSql();
  await ensureCorreccionSchema(sql);
  return sql.query(
    `select id from movimientos m
      where not exists (select 1 from asiento_lineas l where l.movimiento_id = m.id)
        and not coalesce(m.anulado,false)
      order by m.fecha, m.id
      limit $1`, [Math.min(Number(limit) || 500, 2000)]);
}

/** Ingresos que todavía no tienen asiento. */
export async function ingresosSinAsiento({ limit = 500 } = {}, sqlArg) {
  const sql = sqlArg || await getSql();
  return sql.query(
    `select id from ingresos i
      where not exists (select 1 from asiento_lineas l where l.ingreso_id = i.id)
      order by i.fecha, i.id
      limit $1`, [Math.min(Number(limit) || 500, 2000)]);
}

// ---------------------------------------------------------------------------
// Ingresos / entidades / terceros (Horizonte 1 contable).
// ---------------------------------------------------------------------------

/** Entidades activas (Luis, Carolina, Ahinoa, sociedades…). */
export async function listEntidades(sqlArg) {
  const sql = sqlArg || await getSql();
  return sql.query(
    'select id, nombre, tipo, pais, moneda, propietario_id from entidades where activo order by tipo, nombre',
    [],
  );
}

/** Terceros (pagadores/proveedores) para autocompletar. */
export async function listTerceros(sqlArg) {
  const sql = sqlArg || await getSql();
  return sql.query('select id, nombre, nit from terceros order by nombre limit 500', []);
}

/** Busca un tercero por nombre (+nit) o lo crea. Devuelve su id (o null). */
export async function findOrCreateTercero({ nombre, nit, tipo }, sqlArg) {
  const sql = sqlArg || await getSql();
  const n = String(nombre || '').trim();
  if (!n) return null;
  const found = await sql.query(
    "select id from terceros where lower(nombre) = lower($1) and coalesce(nit,'') = coalesce($2,'') limit 1",
    [n, nit || null]
  );
  if (found.length) return found[0].id;
  const ins = await sql.query(
    'insert into terceros (nombre, nit, tipo) values ($1, $2, $3) returning id',
    [n, nit || null, tipo || null]
  );
  return ins[0].id;
}

/** Inserta un ingreso (idempotente por idempotency_key). */
export async function insertIngreso(i, sqlArg) {
  const sql = sqlArg || await getSql();
  const cols = ['entidad_id', 'fecha', 'cedula', 'concepto', 'tercero_id', 'cuenta_id', 'monto',
    'moneda', 'retencion_fuente', 'actividad', 'notas', 'origen', 'idempotency_key',
    'estado_conciliacion', 'extracto_linea_id'];
  const vals = [i.entidad_id, i.fecha, i.cedula, i.concepto || null, i.tercero_id || null, i.cuenta_id || null,
    i.monto, i.moneda || 'COP', i.retencion_fuente || 0, i.actividad || null, i.notas || null,
    i.origen || null, i.idempotency_key,
    i.estado_conciliacion || 'provisional', i.extracto_linea_id || null];
  const ph = vals.map((_, x) => `$${x + 1}`).join(', ');
  const ins = await sql.query(
    `insert into ingresos (${cols.join(', ')}) values (${ph})
     on conflict (idempotency_key) do nothing returning *`, vals);
  if (ins.length) return { inserted: true, row: ins[0] };
  const prev = await sql.query('select * from ingresos where idempotency_key = $1 limit 1', [i.idempotency_key]);
  return { inserted: false, row: prev[0] || null };
}

/**
 * Totales de ingresos y costos deducibles por entidad, agrupados en un rango
 * de fechas — base del reporte de aportes IBC (Fase 3.2, solo lectura).
 * Devuelve dos listas `{entidad_id, total}` (una por tabla); el llamador las
 * combina con `listEntidades()`.
 */
export async function queryAportesBase({ desde, hasta }, sqlArg) {
  const sql = sqlArg || await getSql();
  const ingresos = await sql.query(
    `select entidad_id, coalesce(sum(monto),0)::float8 as total
       from ingresos
      where fecha >= $1 and fecha <= $2
      group by entidad_id`,
    [desde, hasta]
  );
  const costos = await sql.query(
    `select entidad_id, coalesce(sum(monto),0)::float8 as total
       from costos_actividad
      where deducible = true and fecha >= $1 and fecha <= $2
      group by entidad_id`,
    [desde, hasta]
  );
  return { ingresos, costos };
}

// ---------------------------------------------------------------------------
// Costos de actividad económica (p.ej. Ahinoa: tejedoras, proveedores) —
// issue #154. La tabla `costos_actividad` ya existe en sql/contable.sql (se
// lee para el reporte de aportes IBC vía queryAportesBase), pero hasta ahora
// no tenía ningún camino de escritura. Se agrega `idempotency_key` en runtime
// con el mismo patrón "ensureSchema" idempotente que el resto de fases
// aditivas (p.ej. ensureAportesHogarSchema) — aditivo, sin tocar filas existentes.
// ---------------------------------------------------------------------------
let _costosActividadSchemaPromise = null;

/** Crea (si no existe) `costos_actividad` y agrega `idempotency_key`. Memoizado. */
export async function ensureCostosActividadSchema(sqlArg) {
  if (!_costosActividadSchemaPromise) {
    _costosActividadSchemaPromise = aplicarCostosActividadSchema(sqlArg)
      .catch((e) => { _costosActividadSchemaPromise = null; throw e; });
  }
  return _costosActividadSchemaPromise;
}

async function aplicarCostosActividadSchema(sqlArg) {
  const sql = sqlArg || await getSql();
  await sql.query(`
    create table if not exists costos_actividad (
      id          bigint generated always as identity primary key,
      entidad_id  bigint not null references entidades (id),
      actividad   text,
      fecha       date not null,
      concepto    text,
      tercero_id  bigint references terceros (id),
      monto       numeric(14,2) not null check (monto > 0),
      deducible   boolean default true,
      notas       text,
      creado_en   timestamptz not null default now()
    )
  `, []);
  await sql.query('alter table costos_actividad add column if not exists idempotency_key text unique', []);
  await sql.query('create index if not exists costos_actividad_entidad_fecha_idx on costos_actividad (entidad_id, fecha)', []);
}

/** Solo para tests: fuerza a que la próxima llamada vuelva a intentar el DDL. */
export function resetCostosActividadSchemaParaTests() {
  _costosActividadSchemaPromise = null;
}

/** Registra un costo de actividad (idempotente por idempotency_key). */
export async function insertCostoActividad(c, sqlArg) {
  await ensureCostosActividadSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const cols = ['entidad_id', 'actividad', 'fecha', 'concepto', 'tercero_id', 'monto', 'deducible', 'notas', 'idempotency_key'];
  const vals = [c.entidad_id, c.actividad || null, c.fecha, c.concepto || null, c.tercero_id || null,
    c.monto, c.deducible !== false, c.notas || null, c.idempotency_key];
  const ph = vals.map((_, i) => `$${i + 1}`).join(', ');
  const ins = await sql.query(
    `insert into costos_actividad (${cols.join(', ')}) values (${ph})
     on conflict (idempotency_key) do nothing
     returning *`,
    vals
  );
  if (ins.length) return { inserted: true, row: ins[0] };
  const prev = await sql.query('select * from costos_actividad where idempotency_key = $1 limit 1', [c.idempotency_key]);
  return { inserted: false, row: prev[0] || null };
}

/** Lista costos de actividad (con nombre de entidad y tercero), para captura/reporte. */
export async function listCostosActividad({ entidad_id, desde, hasta, limit = 50 } = {}, sqlArg) {
  await ensureCostosActividadSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const params = [];
  const cond = [];
  if (entidad_id) { params.push(entidad_id); cond.push(`c.entidad_id = $${params.length}`); }
  if (desde) { params.push(desde); cond.push(`c.fecha >= $${params.length}`); }
  if (hasta) { params.push(hasta); cond.push(`c.fecha <= $${params.length}`); }
  const where = cond.length ? `where ${cond.join(' and ')}` : '';
  params.push(Math.min(Number(limit) || 50, 500));
  return sql.query(
    `select c.id, c.entidad_id, c.fecha, c.concepto, c.monto, c.deducible, c.actividad,
            e.nombre as entidad, t.nombre as tercero
       from costos_actividad c
       join entidades e on e.id = c.entidad_id
       left join terceros t on t.id = c.tercero_id
       ${where}
      order by c.fecha desc, c.creado_en desc
      limit $${params.length}`, params);
}

/**
 * Totales de ingresos por entidad y cédula, agrupados en un rango de fechas —
 * base de la hoja de trabajo de renta por cédulas (issue #130, solo lectura).
 */
export async function queryIngresosPorCedula({ desde, hasta }, sqlArg) {
  const sql = sqlArg || await getSql();
  return sql.query(
    `select entidad_id, cedula, coalesce(sum(monto),0)::float8 as total
       from ingresos
      where fecha >= $1 and fecha <= $2
      group by entidad_id, cedula`,
    [desde, hasta]
  );
}

/** Lista ingresos (con nombre de entidad y tercero). */
export async function queryIngresos({ entidad_id, desde, hasta, limit = 50 }, sqlArg) {
  const sql = sqlArg || await getSql();
  const params = [];
  const cond = [];
  if (entidad_id) { params.push(entidad_id); cond.push(`i.entidad_id = $${params.length}`); }
  if (desde) { params.push(desde); cond.push(`i.fecha >= $${params.length}`); }
  if (hasta) { params.push(hasta); cond.push(`i.fecha <= $${params.length}`); }
  const where = cond.length ? `where ${cond.join(' and ')}` : '';
  params.push(Math.min(Number(limit) || 50, 500));
  return sql.query(
    `select i.id, i.fecha, i.cedula, i.concepto, i.monto, i.moneda, i.retencion_fuente,
            i.actividad, e.nombre as entidad, t.nombre as tercero
       from ingresos i
       join entidades e on e.id = i.entidad_id
       left join terceros t on t.id = i.tercero_id
       ${where}
      order by i.fecha desc, i.creado_en desc
      limit $${params.length}`, params);
}

// ---------------------------------------------------------------------------
// Extractos bancarios (cargador CSV — fase 1 de conciliación, docs/conciliacion.md).
// ---------------------------------------------------------------------------

/** Inserta un extracto cargado (cabecera). */
export async function insertExtracto(e, sqlArg) {
  const sql = sqlArg || await getSql();
  const cols = ['cuenta', 'entidad_id', 'periodo', 'fecha_desde', 'fecha_hasta',
    'saldo_inicial', 'saldo_final', 'moneda', 'fuente', 'estado'];
  const vals = [e.cuenta, e.entidad_id || null, e.periodo || null, e.fecha_desde || null, e.fecha_hasta || null,
    e.saldo_inicial ?? null, e.saldo_final ?? null, e.moneda || 'COP', e.fuente || 'csv', e.estado || 'cargado'];
  const ph = vals.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await sql.query(
    `insert into extractos (${cols.join(', ')}) values (${ph}) returning *`, vals
  );
  return rows[0];
}

/** Inserta las líneas de un extracto ya cargado (una sola sentencia multi-fila). */
export async function insertExtractoLineas(extracto_id, lineas, sqlArg) {
  const sql = sqlArg || await getSql();
  if (!lineas || !lineas.length) return [];
  const cols = ['extracto_id', 'fecha', 'descripcion', 'monto', 'tipo', 'referencia'];
  const vals = [];
  const groups = lineas.map((l, i) => {
    const base = i * cols.length;
    vals.push(extracto_id, l.fecha, l.descripcion || null, l.monto, l.tipo || null, l.referencia || null);
    return `(${cols.map((_, j) => `$${base + j + 1}`).join(', ')})`;
  });
  return sql.query(
    `insert into extracto_lineas (${cols.join(', ')}) values ${groups.join(', ')} returning *`, vals
  );
}

/** Lista extractos cargados (con conteo de líneas). */
export async function queryExtractos({ cuenta, limit = 50 } = {}, sqlArg) {
  const sql = sqlArg || await getSql();
  const params = [];
  const cond = [];
  if (cuenta) { params.push(cuenta); cond.push(`e.cuenta = $${params.length}`); }
  const where = cond.length ? `where ${cond.join(' and ')}` : '';
  params.push(Math.min(Number(limit) || 50, 200));
  return sql.query(
    `select e.id, e.cuenta, e.periodo, e.fecha_desde, e.fecha_hasta, e.saldo_inicial, e.saldo_final,
            e.moneda, e.fuente, e.estado, e.creado_en,
            (select count(*) from extracto_lineas l where l.extracto_id = e.id)::int as n_lineas
       from extractos e
       ${where}
      order by e.creado_en desc
      limit $${params.length}`,
    params
  );
}

/** Lista las líneas de un extracto. */
export async function queryExtractoLineas({ extracto_id, limit = 500 } = {}, sqlArg) {
  const sql = sqlArg || await getSql();
  if (!extracto_id) return [];
  return sql.query(
    `select id, fecha, descripcion, monto, tipo, referencia, estado
       from extracto_lineas
      where extracto_id = $1
      order by fecha, id
      limit $2`,
    [extracto_id, Math.min(Number(limit) || 500, 2000)]
  );
}

// ---------------------------------------------------------------------------
// Backup completo (issue #41) — foto entera de las tablas principales para el
// export programado al Sheet dedicado (`⚙️ BACKUP DB`). Sin filtros ni límite:
// a diferencia de `query*`, estas leen TODO (uso exclusivo del backup, no de
// endpoints con datos de usuario en vivo).
// ---------------------------------------------------------------------------

/** Todos los movimientos, sin filtrar (para el backup completo). */
export async function listAllMovimientos(sqlArg) {
  const sql = sqlArg || await getSql();
  return sql.query(
    `select id, fecha, tipo, categoria, subcategoria, descripcion, monto, moneda,
            metodo_pago, quien_pago, tarjeta, cuenta_destino, notas, origen,
            idempotency_key, creado_en, actualizado_en
       from movimientos
      order by id`,
    []
  );
}

/** Todos los movimientos empresa↔familia, sin filtrar (para el backup completo). */
export async function listAllEmpresasMov(sqlArg) {
  const sql = sqlArg || await getSql();
  return sql.query(
    `select id, empresa, flujo, mes, anio, concepto, titular, monto, moneda,
            estado, origen, movimiento_id, creado_en
       from empresas_mov
      order by id`,
    []
  );
}

/** Todos los ingresos, sin filtrar (para el backup completo). */
export async function listAllIngresos(sqlArg) {
  const sql = sqlArg || await getSql();
  return sql.query(
    `select id, entidad_id, fecha, cedula, concepto, tercero_id, cuenta_id, monto, moneda,
            retencion_fuente, actividad, notas, origen, idempotency_key, creado_en
       from ingresos
      order by id`,
    []
  );
}

// ---------------------------------------------------------------------------
// Motor de cruce de conciliación (fase 2, docs/conciliacion.md, issue #39).
// Solo lectura salvo `confirmarConciliacion` (la única escritura: siempre a
// pedido explícito del usuario, tras revisar la propuesta).
// ---------------------------------------------------------------------------

/** Un extracto por id (el motor de cruce necesita su rango de fechas). */
export async function getExtracto(id, sqlArg) {
  const sql = sqlArg || await getSql();
  const rows = await sql.query('select * from extractos where id = $1', [id]);
  return rows[0] || null;
}

/** Movimientos `provisional` dentro de una ventana de fechas (candidatos a conciliar). */
export async function queryMovimientosProvisionales({ desde, hasta }, sqlArg) {
  const sql = sqlArg || await getSql();
  return sql.query(
    `select id, fecha, descripcion, monto
       from movimientos
      where coalesce(estado_conciliacion, 'provisional') = 'provisional'
        and fecha between $1 and $2
      order by fecha`,
    [desde, hasta]
  );
}

/** Ingresos `provisional` dentro de una ventana de fechas (candidatos a conciliar). */
export async function queryIngresosProvisionales({ desde, hasta }, sqlArg) {
  const sql = sqlArg || await getSql();
  return sql.query(
    `select id, fecha, concepto as descripcion, monto
       from ingresos
      where coalesce(estado_conciliacion, 'provisional') = 'provisional'
        and fecha between $1 and $2
      order by fecha`,
    [desde, hasta]
  );
}

/**
 * Confirma un cruce propuesto (o elegido manualmente ante ambigüedad): marca
 * `conciliado` en la línea del extracto Y en el movimiento/ingreso elegido.
 * Única escritura del motor de conciliación — nunca se llama sola, siempre
 * tras revisión del usuario en la pantalla de conciliación.
 * Guarda-raíles: la línea debe seguir `sin_conciliar` y el capturado debe
 * seguir `provisional` (evita re-conciliar o pisar un cruce ya confirmado).
 */
export async function confirmarConciliacion({ linea_id, tipo, id }, sqlArg) {
  const sql = sqlArg || await getSql();
  const esIngreso = tipo === 'ingreso';

  const lineaRows = await sql.query('select * from extracto_lineas where id = $1', [linea_id]);
  const linea = lineaRows[0];
  if (!linea) throw new Error('Línea de extracto no encontrada');
  if (linea.estado !== 'sin_conciliar') throw new Error('Esa línea ya fue conciliada (o marcada) previamente');

  const capturadoRows = esIngreso
    ? await sql.query('select * from ingresos where id = $1', [id])
    : await sql.query('select * from movimientos where id = $1', [id]);
  const capturado = capturadoRows[0];
  if (!capturado) throw new Error(`${esIngreso ? 'Ingreso' : 'Movimiento'} no encontrado`);
  if ((capturado.estado_conciliacion || 'provisional') !== 'provisional') {
    throw new Error('Ese registro ya no está provisional (¿ya se concilió con otra línea?)');
  }

  if (esIngreso) {
    await sql.query("update extracto_lineas set estado = 'conciliado', ingreso_id = $2 where id = $1", [linea_id, id]);
    await sql.query("update ingresos set estado_conciliacion = 'conciliado', extracto_linea_id = $2 where id = $1", [id, linea_id]);
  } else {
    await sql.query("update extracto_lineas set estado = 'conciliado', movimiento_id = $2 where id = $1", [linea_id, id]);
    await sql.query("update movimientos set estado_conciliacion = 'conciliado', extracto_linea_id = $2 where id = $1", [id, linea_id]);
  }

  return { linea_id, tipo: esIngreso ? 'ingreso' : 'movimiento', id };
}

/** Una línea de extracto por id (backfill de `solo_extracto`, issue #72). */
export async function getExtractoLinea(id, sqlArg) {
  const sql = sqlArg || await getSql();
  const rows = await sql.query('select * from extracto_lineas where id = $1 limit 1', [id]);
  return rows[0] || null;
}

/**
 * Marca una línea de extracto como materializada: el movimiento/ingreso ya se
 * creó (ya nace `conciliado`, ver `insertMovimiento`/`insertIngreso`) y solo
 * falta enlazarlo. Guarda-raíl: solo si la línea sigue `sin_conciliar` (evita
 * re-materializar en una llamada repetida).
 * @returns {Promise<boolean>} true si se marcó, false si ya no estaba `sin_conciliar`.
 */
export async function marcarLineaMaterializada({ linea_id, tipo, id }, sqlArg) {
  const sql = sqlArg || await getSql();
  const col = tipo === 'ingreso' ? 'ingreso_id' : 'movimiento_id';
  const rows = await sql.query(
    `update extracto_lineas set estado = 'conciliado', ${col} = $2
      where id = $1 and estado = 'sin_conciliar'
      returning id`,
    [linea_id, id]
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Pagos del mes (issue #73, Nocturno 2/7, `auto-ok`). Esquema nuevo: en vez de
// un `.sql` que alguien deba correr a mano en Neon, `ensurePagosFijosSchema`
// aplica un DDL idempotente en runtime (create table/index if not exists) la
// primera vez que se usa este módulo — memoizado para no repetirlo en cada
// llamada. Ver AUTOBUILD.md § modo auto-ok.
// ---------------------------------------------------------------------------
// Memoiza la PROMESA (no un booleano): varias llamadas concurrentes (p. ej. el
// Promise.all de listPagosFijos/queryPagosEstadoMes en el handler) deben
// esperar la MISMA corrida del DDL/seed en vez de dispararla varias veces.
let _pagosFijosSchemaPromise = null;

// Catálogo canónico de pagos fijos, tomado 1:1 del Excel maestro (pestaña
// "Pagos Fijos", columna MONTO PTTO), issue #136. Cada uno trae:
//  - monto real (para que el presupuesto del mes deje de ser $0),
//  - dia_vencimiento / familia (DCDG/DCC) reales,
//  - categoria + subcategoria de la taxonomía DCDG → habilitan el auto-vínculo
//    movimiento→pago fijo (#141): al registrar el gasto se marca solo,
//  - asumido_por (LADCC/CMDG) → insumo del fondo común / aportes al hogar (#113).
const PAGOS_FIJOS_SEED = [
  { concepto: 'Gas Apto', monto: 200000, dia_vencimiento: 3, familia: 'DCDG', categoria: 'Servicios Públicos', subcategoria: 'Gas', asumido_por: 'CMDG' },
  { concepto: 'Medicina Prepagada Caro', monto: 580650, dia_vencimiento: 3, familia: 'DCDG', categoria: 'Seguros y Medicina Prepagada', subcategoria: 'Medicina Prepagada', asumido_por: 'LADCC' },
  { concepto: 'Medicina Prepagada Luhijo-Luciano', monto: 573300, dia_vencimiento: 3, familia: 'DCDG', categoria: 'Seguros y Medicina Prepagada', subcategoria: 'Medicina Prepagada', asumido_por: 'LADCC' },
  { concepto: 'Medicina prepagada Ladcc-Adcm', monto: 2348073, dia_vencimiento: 3, familia: 'DCC', categoria: 'Seguros y Medicina Prepagada', subcategoria: 'Medicina Prepagada', asumido_por: 'LADCC' },
  { concepto: 'TC Colpatria ****2889', monto: 250000, dia_vencimiento: 5, familia: 'DCDG', categoria: 'Créditos y Tarjetas', subcategoria: 'Pago tarjeta de crédito', asumido_por: 'LADCC' },
  { concepto: 'TC Colpatria ****3802', monto: 250000, dia_vencimiento: 5, familia: 'DCDG', categoria: 'Créditos y Tarjetas', subcategoria: 'Pago tarjeta de crédito', asumido_por: 'LADCC' },
  { concepto: 'Claro Luis', monto: 59363, dia_vencimiento: 6, familia: 'DCDG', categoria: 'Servicios Públicos', subcategoria: 'Telefonía', asumido_por: 'LADCC' },
  { concepto: 'Tigo Luis', monto: 45001, dia_vencimiento: 8, familia: 'DCDG', categoria: 'Servicios Públicos', subcategoria: 'Telefonía', asumido_por: 'LADCC' },
  { concepto: 'Arriendo Apto', monto: 6205876, dia_vencimiento: 10, familia: 'DCDG', categoria: 'Vivienda', subcategoria: 'Arriendo', asumido_por: 'LADCC' },
  { concepto: 'Medicina prepagada MCS', monto: 1405000, dia_vencimiento: 10, familia: 'DCC', categoria: 'Seguros y Medicina Prepagada', subcategoria: 'Medicina Prepagada', asumido_por: 'LADCC' },
  { concepto: 'Plan Complementario Sanitas', monto: 299502, dia_vencimiento: 15, familia: 'DCDG', categoria: 'Seguros y Medicina Prepagada', subcategoria: 'Plan Complementario', asumido_por: 'LADCC' },
  { concepto: 'Crédito Bcol 7388 (4549)', monto: 889887, dia_vencimiento: 15, familia: 'DCDG', categoria: 'Créditos y Tarjetas', subcategoria: 'Pago crédito bancario', asumido_por: 'LADCC' },
  { concepto: 'Crédito Bcol 1048 (Ahinoa 5688)', monto: 416246, dia_vencimiento: 15, familia: 'DCDG', categoria: 'Créditos y Tarjetas', subcategoria: 'Pago crédito bancario', asumido_por: 'CMDG' },
  { concepto: 'Acueducto Apto', monto: 679297, dia_vencimiento: 16, familia: 'DCDG', categoria: 'Servicios Públicos', subcategoria: 'Agua', asumido_por: 'LADCC' },
  { concepto: 'TC Serfinanza 6014', monto: 1500000, dia_vencimiento: 17, familia: 'DCDG', categoria: 'Créditos y Tarjetas', subcategoria: 'Pago tarjeta de crédito', asumido_por: 'LADCC' },
  { concepto: 'Tigo Carolina', monto: 72820, dia_vencimiento: 19, familia: 'DCDG', categoria: 'Servicios Públicos', subcategoria: 'Telefonía', asumido_por: 'CMDG' },
  { concepto: 'Internet Apto', monto: 104000, dia_vencimiento: 22, familia: 'DCDG', categoria: 'Servicios Públicos', subcategoria: 'Internet', asumido_por: 'LADCC' },
  { concepto: 'Electricaribe - Energía Apto', monto: 1200000, dia_vencimiento: 26, familia: 'DCDG', categoria: 'Servicios Públicos', subcategoria: 'Energía', asumido_por: 'LADCC' },
  { concepto: 'Colegio Alemán - LUCIANO', monto: 2772615, dia_vencimiento: 27, familia: 'DCDG', categoria: 'Educación', subcategoria: 'Colegio', asumido_por: 'LADCC' },
  { concepto: 'Colegio Alemán - LUHIJO', monto: 2877399, dia_vencimiento: 27, familia: 'DCDG', categoria: 'Educación', subcategoria: 'Colegio', asumido_por: 'LADCC' },
  { concepto: 'Escuela de Fútbol', monto: 330000, dia_vencimiento: 30, familia: 'DCDG', categoria: 'Educación', subcategoria: 'Extracurriculares', asumido_por: 'LADCC' },
  { concepto: 'Merienda y almuerzos colegio Luciano', monto: 1000000, dia_vencimiento: 30, familia: 'DCDG', categoria: 'Gastos Luhijo - Luciano', subcategoria: 'Meriendas y Almuerzos Colegio', asumido_por: 'LADCC' },
];

// Los 12 pagos "placeholder" con monto 0 que sembró #73 (nombres genéricos que
// no calzan 1:1 con el Excel). Al aplicar la siembra canónica se **retiran**
// (activo=false) los que sigan sin usar (monto 0), sin borrarlos. "Internet
// Apto" NO está aquí: es un concepto canónico, así que se actualiza en su lugar.
const PAGOS_FIJOS_PLACEHOLDERS_LEGACY = [
  'Arriendo', 'Administración', 'Claro (celular)', 'Tigo (celular)', 'Agua',
  'Energía', 'Gas natural', 'Colegio Alemán', 'Extracurriculares',
  'Seguro vehículo', 'Cuota crédito vehículo',
];

/** Crea (si no existen) `pagos_fijos`/`pagos_estado` y siembra el catálogo conocido. Memoizado. */
export async function ensurePagosFijosSchema(sqlArg) {
  if (!_pagosFijosSchemaPromise) {
    _pagosFijosSchemaPromise = aplicarPagosFijosSchema(sqlArg)
      .catch((e) => { _pagosFijosSchemaPromise = null; throw e; }); // reintentable si falló (p.ej. DB caída)
  }
  return _pagosFijosSchemaPromise;
}

async function aplicarPagosFijosSchema(sqlArg) {
  const sql = sqlArg || await getSql();
  await sql.query(`
    create table if not exists pagos_fijos (
      id serial primary key,
      concepto text not null,
      monto numeric not null default 0,
      dia_vencimiento int not null default 1,
      familia text not null default 'DCDG',
      categoria text,
      moneda text not null default 'COP',
      activo boolean not null default true,
      creado_en timestamptz not null default now()
    )
  `, []);
  await sql.query('create unique index if not exists pagos_fijos_concepto_familia_uk on pagos_fijos (concepto, familia)', []);
  // Columnas para casar automáticamente un movimiento con su pago fijo
  // (categoria/subcategoria) y para saber quién asume el costo (asumido_por,
  // LADCC/CMDG — del Excel maestro). Idempotente.
  await sql.query('alter table pagos_fijos add column if not exists subcategoria text', []);
  await sql.query('alter table pagos_fijos add column if not exists asumido_por text', []);
  await sql.query(`
    create table if not exists pagos_estado (
      id serial primary key,
      pago_fijo_id bigint not null references pagos_fijos (id),
      anio int not null,
      mes int not null,
      estado text not null default 'pendiente',
      fecha_pago date,
      monto_pagado numeric,
      movimiento_id bigint,
      creado_en timestamptz not null default now(),
      unique (pago_fijo_id, anio, mes)
    )
  `, []);
  // Siembra canónica del Excel (#136), UNA sola vez. Centinela: si ya existe
  // "Acueducto Apto" es que ya se sembró → no re-aplicar, para no pisar las
  // ediciones que un owner haga luego en "Gestionar pagos fijos".
  const yaSembrado = await sql.query(
    "select 1 from pagos_fijos where concepto = 'Acueducto Apto' and familia = 'DCDG' limit 1", []);
  if (!yaSembrado.length) {
    // Retira (activo=false, no borra) los placeholders genéricos de #73 que
    // nunca se usaron (monto 0). Si un owner ya les había puesto monto, se
    // respetan (no se tocan).
    await sql.query(
      'update pagos_fijos set activo = false where monto = 0 and concepto = any($1)',
      [PAGOS_FIJOS_PLACEHOLDERS_LEGACY]
    );
    // Inserta/actualiza los 22 canónicos con sus datos reales.
    for (const p of PAGOS_FIJOS_SEED) {
      await sql.query(
        `insert into pagos_fijos (concepto, monto, dia_vencimiento, familia, categoria, subcategoria, asumido_por, activo)
         values ($1, $2, $3, $4, $5, $6, $7, true)
         on conflict (concepto, familia) do update set
           monto = excluded.monto, dia_vencimiento = excluded.dia_vencimiento,
           categoria = excluded.categoria, subcategoria = excluded.subcategoria,
           asumido_por = excluded.asumido_por, activo = true`,
        [p.concepto, p.monto, p.dia_vencimiento, p.familia, p.categoria, p.subcategoria, p.asumido_por]
      );
    }
  }
}

/** Solo para tests: fuerza a que la próxima llamada vuelva a intentar el DDL/seed. */
export function resetPagosFijosSchemaParaTests() {
  _pagosFijosSchemaPromise = null;
}

/** Catálogo de pagos fijos (activos por default). */
export async function listPagosFijos({ activo = true } = {}, sqlArg) {
  await ensurePagosFijosSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const rows = await sql.query(
    activo == null
      ? 'select * from pagos_fijos order by familia, dia_vencimiento, concepto'
      : 'select * from pagos_fijos where activo = $1 order by familia, dia_vencimiento, concepto',
    activo == null ? [] : [!!activo]
  );
  return rows;
}

/** Filas de `pagos_estado` de un (anio, mes) dado. */
export async function queryPagosEstadoMes({ anio, mes }, sqlArg) {
  await ensurePagosFijosSchema(sqlArg);
  const sql = sqlArg || await getSql();
  return sql.query('select * from pagos_estado where anio = $1 and mes = $2', [Number(anio), Number(mes)]);
}

/** Filas de `pagos_estado` en un rango [desde, hasta] inclusive (para el historial). */
export async function queryPagosEstadoRango({ desde, hasta }, sqlArg) {
  await ensurePagosFijosSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const lo = Number(desde.anio) * 12 + Number(desde.mes);
  const hi = Number(hasta.anio) * 12 + Number(hasta.mes);
  return sql.query(
    'select * from pagos_estado where (anio * 12 + mes) between $1 and $2 order by anio, mes',
    [lo, hi]
  );
}

/** Agrega un pago fijo nuevo al catálogo (gestión, solo owners). */
export async function insertPagoFijo(p, sqlArg) {
  await ensurePagosFijosSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const rows = await sql.query(
    `insert into pagos_fijos (concepto, monto, dia_vencimiento, familia, categoria, subcategoria, asumido_por, moneda)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning *`,
    [p.concepto, Number(p.monto) || 0, Number(p.dia_vencimiento) || 1, p.familia || 'DCDG',
      p.categoria || null, p.subcategoria || null, p.asumido_por || null, p.moneda || 'COP']
  );
  return rows[0];
}

/** Edita campos de un pago fijo existente (gestión, solo owners). */
export async function updatePagoFijo(id, patch, sqlArg) {
  await ensurePagosFijosSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const rows = await sql.query(
    `update pagos_fijos set
        concepto = coalesce($2, concepto),
        monto = coalesce($3, monto),
        dia_vencimiento = coalesce($4, dia_vencimiento),
        categoria = coalesce($5, categoria),
        activo = coalesce($6, activo),
        subcategoria = coalesce($7, subcategoria),
        asumido_por = coalesce($8, asumido_por)
      where id = $1
      returning *`,
    [id, patch.concepto ?? null, patch.monto != null ? Number(patch.monto) : null,
      patch.dia_vencimiento != null ? Number(patch.dia_vencimiento) : null,
      patch.categoria ?? null, patch.activo != null ? !!patch.activo : null,
      patch.subcategoria ?? null, patch.asumido_por ?? null]
  );
  return rows[0] || null;
}

/** Marca (o actualiza) el pago de un pago fijo en un mes: upsert en `pagos_estado`. */
export async function upsertPagoEstado({ pago_fijo_id, anio, mes, fecha_pago, monto_pagado, movimiento_id }, sqlArg) {
  await ensurePagosFijosSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const rows = await sql.query(
    `insert into pagos_estado (pago_fijo_id, anio, mes, estado, fecha_pago, monto_pagado, movimiento_id)
     values ($1, $2, $3, 'pagado', $4, $5, $6)
     on conflict (pago_fijo_id, anio, mes) do update
       set estado = 'pagado', fecha_pago = excluded.fecha_pago,
           monto_pagado = excluded.monto_pagado, movimiento_id = excluded.movimiento_id
     returning *`,
    [pago_fijo_id, Number(anio), Number(mes), fecha_pago || null, monto_pagado != null ? Number(monto_pagado) : null, movimiento_id || null]
  );
  return rows[0];
}

/**
 * Auto-vincula un movimiento con el pago fijo que le corresponde: busca un pago
 * fijo activo que case por (categoria, subcategoria) del mes del movimiento y,
 * si ese pago aún no tiene estado ese mes, lo marca **pagado** con el monto real.
 * Best-effort e idempotente: no-op si no hay match, si ya está marcado, o si el
 * movimiento no es COP. Devuelve el pago fijo vinculado (o null).
 */
export async function autovincularPagoFijo({ movimiento_id, categoria, subcategoria, fecha, monto, moneda }, sqlArg) {
  if (!categoria || (moneda && moneda !== 'COP')) return null;
  const d = String(fecha || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const anio = Number(d.slice(0, 4));
  const mes = Number(d.slice(5, 7));
  await ensurePagosFijosSchema(sqlArg);
  const sql = sqlArg || await getSql();
  // Pago fijo activo cuya categoria casa; si el pago tiene subcategoria, debe
  // coincidir también. Preferimos el que casa por subcategoria exacta.
  const rows = await sql.query(
    `select * from pagos_fijos
       where activo = true and categoria = $1
         and (subcategoria is null or subcategoria = $2)
       order by (subcategoria is not distinct from $2) desc, dia_vencimiento
       limit 1`,
    [categoria, subcategoria || null]
  );
  const pf = rows[0];
  if (!pf) return null;
  // Si ya hay estado del mes (pagado manual, etc.), NO lo tocamos.
  const est = await sql.query(
    'select 1 from pagos_estado where pago_fijo_id = $1 and anio = $2 and mes = $3',
    [pf.id, anio, mes]
  );
  if (est.length) return null;
  await upsertPagoEstado(
    { pago_fijo_id: pf.id, anio, mes, fecha_pago: d, monto_pagado: monto, movimiento_id },
    sqlArg
  );
  return pf;
}

/** Desmarca un pago (vuelve a pendiente): borra la fila de `pagos_estado` del mes. */
export async function desmarcarPagoEstado({ pago_fijo_id, anio, mes }, sqlArg) {
  await ensurePagosFijosSchema(sqlArg);
  const sql = sqlArg || await getSql();
  await sql.query('delete from pagos_estado where pago_fijo_id = $1 and anio = $2 and mes = $3', [pago_fijo_id, Number(anio), Number(mes)]);
  return true;
}

// ---------------------------------------------------------------------------
// Préstamos entre Luis y Carolina (issue #77, Nocturno 6/7, `auto-ok`). Esquema
// nuevo vía DDL idempotente en runtime (sin `.sql` manual) — mismo patrón que
// ensurePagosFijosSchema. Ver AUTOBUILD.md § modo auto-ok.
//
// `contab_version` e `idempotency_key` (issue #116, Contab. familiar D) se
// agregan vía ALTER TABLE ADD COLUMN IF NOT EXISTS — mismo patrón que
// ensureCorreccionSchema sobre `movimientos` — para versionar el reverso
// contable al marcar/desmarcar saldado y poder deduplicar el flujo "pagar
// deuda del otro".
// ---------------------------------------------------------------------------
let _prestamosSchemaPromise = null;

/** Crea (si no existe) `prestamos`. Memoizado. */
export async function ensurePrestamosSchema(sqlArg) {
  if (!_prestamosSchemaPromise) {
    _prestamosSchemaPromise = aplicarPrestamosSchema(sqlArg)
      .catch((e) => { _prestamosSchemaPromise = null; throw e; }); // reintentable si falló
  }
  return _prestamosSchemaPromise;
}

async function aplicarPrestamosSchema(sqlArg) {
  const sql = sqlArg || await getSql();
  await sql.query(`
    create table if not exists prestamos (
      id serial primary key,
      fecha date not null,
      de text not null,
      para text not null,
      monto numeric not null,
      concepto text,
      moneda text not null default 'COP',
      saldado boolean not null default false,
      notas text,
      creado_en timestamptz not null default now()
    )
  `, []);
  await sql.query('alter table prestamos add column if not exists contab_version int not null default 1', []);
  await sql.query('alter table prestamos add column if not exists idempotency_key text', []);
  await sql.query('create unique index if not exists prestamos_idempotency_key_uidx on prestamos (idempotency_key) where idempotency_key is not null', []);
}

/** Solo para tests: fuerza a que la próxima llamada vuelva a intentar el DDL. */
export function resetPrestamosSchemaParaTests() {
  _prestamosSchemaPromise = null;
}

/** Lista los préstamos (todos por default; `saldado: false` para solo los abiertos). */
export async function listPrestamos({ saldado } = {}, sqlArg) {
  await ensurePrestamosSchema(sqlArg);
  const sql = sqlArg || await getSql();
  if (saldado == null) {
    return sql.query('select * from prestamos order by fecha desc, id desc', []);
  }
  return sql.query('select * from prestamos where saldado = $1 order by fecha desc, id desc', [!!saldado]);
}

const PERSONAS_VALIDAS = ['Luis', 'Carolina'];

/** Un préstamo por id (para contabilizarlo). */
export async function getPrestamo(id, sqlArg) {
  await ensurePrestamosSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const rows = await sql.query('select * from prestamos where id = $1 limit 1', [Number(id)]);
  return rows[0] || null;
}

/**
 * Registra un préstamo (o un abono, que es sencillamente uno en sentido inverso).
 * `idempotency_key` es opcional (issue #116: la usa el flujo "pagar deuda del
 * otro" para no duplicar en un reintento); sin ella, cada llamada crea una fila
 * nueva, igual que siempre.
 */
export async function insertPrestamo({ fecha, de, para, monto, concepto, moneda, notas, idempotency_key }, sqlArg) {
  if (!PERSONAS_VALIDAS.includes(de) || !PERSONAS_VALIDAS.includes(para)) {
    throw new Error('"de" y "para" deben ser "Luis" o "Carolina".');
  }
  if (de === para) throw new Error('"de" y "para" no pueden ser la misma persona.');
  const montoNum = Number(monto);
  if (!(montoNum > 0)) throw new Error('El monto del préstamo debe ser mayor a 0.');
  await ensurePrestamosSchema(sqlArg);
  const sql = sqlArg || await getSql();
  if (!idempotency_key) {
    const rows = await sql.query(
      `insert into prestamos (fecha, de, para, monto, concepto, moneda, notas)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [fecha, de, para, montoNum, concepto || null, moneda || 'COP', notas || null]
    );
    return rows[0];
  }
  const ins = await sql.query(
    `insert into prestamos (fecha, de, para, monto, concepto, moneda, notas, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (idempotency_key) do nothing
     returning *`,
    [fecha, de, para, montoNum, concepto || null, moneda || 'COP', notas || null, idempotency_key]
  );
  if (ins.length) return ins[0];
  const prev = await sql.query('select * from prestamos where idempotency_key = $1 limit 1', [idempotency_key]);
  return prev[0] || null;
}

/**
 * Marca (o desmarca) un préstamo como saldado — sale del cálculo del neto.
 * Sin cambio real (ya estaba en ese estado) devuelve la fila tal cual, sin
 * tocar `contab_version`; en una transición real, la incrementa (issue #116:
 * el llamador la usa para versionar el asiento de reverso/reapertura).
 */
export async function marcarPrestamoSaldado(id, saldado = true, sqlArg) {
  await ensurePrestamosSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const target = !!saldado;
  const prevRows = await sql.query('select * from prestamos where id = $1 limit 1', [Number(id)]);
  const prev = prevRows[0];
  if (!prev) return null;
  if (!!prev.saldado === target) return prev; // sin transición: nada que actualizar
  const rows = await sql.query(
    'update prestamos set saldado = $2, contab_version = contab_version + 1 where id = $1 returning *',
    [Number(id), target]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Usuarios del equipo y su rol (T8, issue #97). Esquema nuevo vía DDL
// idempotente en runtime (sin `.sql` manual) — mismo patrón que
// ensurePrestamosSchema. `sql/contable.sql` documenta el mismo esquema/semilla
// para quien prefiera correrlo a mano en Neon; aquí se crea solo si falta.
// ---------------------------------------------------------------------------
let _usuariosSchemaPromise = null;

const USUARIOS_SEED = [
  ['luis@iwin.im', 'Luis', 'owner', 'CO'],
  ['carodz2@gmail.com', 'Carolina', 'owner', 'CO'],
  ['angela@iwin.im', 'Angela Guerrero', 'admin_financiero', 'CO'],
  ['ma.isabel@iwin.im', 'María Isabel Bolaños', 'tesoreria', 'CO'],
  ['santiago@iwin.im', 'Santiago Rodríguez', 'contador', 'CO'],
];

/** Crea (si no existe) `usuarios` + siembra el equipo conocido. Memoizado. */
export async function ensureUsuariosSchema(sqlArg) {
  if (!_usuariosSchemaPromise) {
    _usuariosSchemaPromise = aplicarUsuariosSchema(sqlArg)
      .catch((e) => { _usuariosSchemaPromise = null; throw e; }); // reintentable si falló
  }
  return _usuariosSchemaPromise;
}

async function aplicarUsuariosSchema(sqlArg) {
  const sql = sqlArg || await getSql();
  await sql.query(`
    create table if not exists usuarios (
      id      bigint generated always as identity primary key,
      email   text not null unique,
      nombre  text,
      rol     text not null,
      pais    text,
      activo  boolean default true
    )
  `, []);
  for (const [email, nombre, rol, pais] of USUARIOS_SEED) {
    await sql.query(
      'insert into usuarios (email, nombre, rol, pais) values ($1, $2, $3, $4) on conflict (email) do nothing',
      [email, nombre, rol, pais]
    );
  }
}

/** Solo para tests: fuerza a que la próxima llamada vuelva a intentar el DDL. */
export function resetUsuariosSchemaParaTests() {
  _usuariosSchemaPromise = null;
}

/**
 * Rol del email en `usuarios` (o null si no tiene fila, está inactivo, o la
 * tabla no responde — el llamador decide el fallback). Nunca lanza: quien la
 * usa para autenticar no debe quedar bloqueado por un problema transitorio.
 */
export async function getUsuarioRolPorEmail(email, sqlArg) {
  const correo = String(email || '').toLowerCase().trim();
  if (!correo) return null;
  try {
    await ensureUsuariosSchema(sqlArg);
    const sql = sqlArg || await getSql();
    const rows = await sql.query(
      'select rol from usuarios where lower(email) = $1 and activo = true limit 1',
      [correo]
    );
    return rows[0] ? rows[0].rol : null;
  } catch (_) {
    return null;
  }
}

/**
 * Nombre (`usuarios.nombre`) del email, o null (mismo criterio de nunca-lanza
 * que `getUsuarioRolPorEmail`) — usado por "Mi patrimonio" (#115) para saber
 * a qué entidad (Luis/Carolina) corresponde la sesión.
 */
export async function getUsuarioNombrePorEmail(email, sqlArg) {
  const correo = String(email || '').toLowerCase().trim();
  if (!correo) return null;
  try {
    await ensureUsuariosSchema(sqlArg);
    const sql = sqlArg || await getSql();
    const rows = await sql.query(
      'select nombre from usuarios where lower(email) = $1 and activo = true limit 1',
      [correo]
    );
    return rows[0] ? rows[0].nombre : null;
  } catch (_) {
    return null;
  }
}

/** Lista/busca movimientos (para consultas puntuales, SilvIA y dashboard). */
export async function queryMovimientos({ desde, hasta, categoria, quien, texto, tipoGasto, limit = 50 }, sqlArg) {
  const sql = sqlArg || await getSql();
  await ensureCorreccionSchema(sql);
  await ensureTipoGastoSchema(sql);
  const params = [];
  const cond = ['not coalesce(anulado,false)'];
  if (desde) { params.push(desde); cond.push(`fecha >= $${params.length}`); }
  if (hasta) { params.push(hasta); cond.push(`fecha <= $${params.length}`); }
  if (categoria) { params.push(`%${categoria.toLowerCase()}%`); cond.push(`lower(categoria) like $${params.length}`); }
  if (quien) { params.push(`%${quien.toLowerCase()}%`); cond.push(`lower(coalesce(quien_pago,'')) like $${params.length}`); }
  if (texto) { params.push(`%${texto.toLowerCase()}%`); cond.push(`lower(descripcion) like $${params.length}`); }
  if (tipoGasto) { params.push(String(tipoGasto).toLowerCase()); cond.push(`tipo_gasto = $${params.length}`); }
  const where = cond.length ? `where ${cond.join(' and ')}` : '';
  params.push(Math.min(Number(limit) || 50, 500));
  const rows = await sql.query(
    `select id, fecha, tipo, categoria, subcategoria, descripcion, monto, moneda,
            metodo_pago, quien_pago, tarjeta, cuenta_destino, notas, origen, creado_en,
            tipo_gasto, tipo_gasto_persona, tipo_gasto_auto
       from movimientos ${where}
      order by fecha desc, creado_en desc
      limit $${params.length}`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Fondo común del hogar (issue #113, Contab. familiar A, `auto-ok`): aportes
// de cada persona al fondo, para el reporte de cuota proporcional. Esquema
// nuevo vía DDL idempotente en runtime (sin `.sql` manual) — mismo patrón que
// ensurePrestamosSchema/ensurePagosFijosSchema.
// ---------------------------------------------------------------------------
let _aportesHogarSchemaPromise = null;

/** Crea (si no existe) `aportes_hogar`. Memoizado. */
export async function ensureAportesHogarSchema(sqlArg) {
  if (!_aportesHogarSchemaPromise) {
    _aportesHogarSchemaPromise = aplicarAportesHogarSchema(sqlArg)
      .catch((e) => { _aportesHogarSchemaPromise = null; throw e; }); // reintentable si falló
  }
  return _aportesHogarSchemaPromise;
}

async function aplicarAportesHogarSchema(sqlArg) {
  const sql = sqlArg || await getSql();
  await sql.query(`
    create table if not exists aportes_hogar (
      id              bigint generated always as identity primary key,
      entidad_id      bigint not null references entidades (id),
      fecha           date not null,
      monto           numeric(14,2) not null check (monto > 0),
      moneda          text not null default 'COP',
      metodo_pago     text,
      notas           text,
      origen          text,
      idempotency_key text unique,
      creado_en       timestamptz not null default now()
    )
  `, []);
  await sql.query('create index if not exists aportes_hogar_entidad_fecha_idx on aportes_hogar (entidad_id, fecha)', []);
}

/** Solo para tests: fuerza a que la próxima llamada vuelva a intentar el DDL. */
export function resetAportesHogarSchemaParaTests() {
  _aportesHogarSchemaPromise = null;
}

/** Registra un aporte al fondo común. Idempotente por idempotency_key. */
export async function insertAporteHogar(a, sqlArg) {
  await ensureAportesHogarSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const cols = ['entidad_id', 'fecha', 'monto', 'moneda', 'metodo_pago', 'notas', 'origen', 'idempotency_key'];
  const vals = [a.entidad_id, a.fecha, a.monto, a.moneda || 'COP', a.metodo_pago || null,
    a.notas || null, a.origen || 'manual', a.idempotency_key];
  const ph = vals.map((_, i) => `$${i + 1}`).join(', ');
  const ins = await sql.query(
    `insert into aportes_hogar (${cols.join(', ')}) values (${ph})
     on conflict (idempotency_key) do nothing
     returning *`,
    vals
  );
  if (ins.length) return { inserted: true, row: ins[0] };
  const prev = await sql.query('select * from aportes_hogar where idempotency_key = $1 limit 1', [a.idempotency_key]);
  return { inserted: false, row: prev[0] || null };
}

/** Un aporte por id (para contabilizarlo). */
export async function getAporteHogar(id, sqlArg) {
  await ensureAportesHogarSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const rows = await sql.query('select * from aportes_hogar where id = $1 limit 1', [id]);
  return rows[0] || null;
}

/** Aportes al fondo común en un rango de fechas (para el reporte mensual). */
export async function listAportesHogarPeriodo({ desde, hasta } = {}, sqlArg) {
  await ensureAportesHogarSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const params = [];
  const cond = [];
  if (desde) { params.push(desde); cond.push(`fecha >= $${params.length}`); }
  if (hasta) { params.push(hasta); cond.push(`fecha <= $${params.length}`); }
  const where = cond.length ? `where ${cond.join(' and ')}` : '';
  return sql.query(
    `select id, entidad_id, fecha, monto, moneda, metodo_pago, notas
       from aportes_hogar ${where}
      order by fecha desc, id desc`,
    params
  );
}

// ---------------------------------------------------------------------------
// Metas financieras (issue #117, Contab. familiar E, `auto-ok`). Esquema nuevo
// vía DDL idempotente en runtime (sin `.sql` manual) — mismo patrón que
// ensureAportesHogarSchema/ensurePrestamosSchema. Ver AUTOBUILD.md § modo auto-ok.
// ---------------------------------------------------------------------------
let _metasSchemaPromise = null;

/** Crea (si no existe) `metas`. Memoizado. */
export async function ensureMetasSchema(sqlArg) {
  if (!_metasSchemaPromise) {
    _metasSchemaPromise = aplicarMetasSchema(sqlArg)
      .catch((e) => { _metasSchemaPromise = null; throw e; }); // reintentable si falló
  }
  return _metasSchemaPromise;
}

async function aplicarMetasSchema(sqlArg) {
  const sql = sqlArg || await getSql();
  await sql.query(`
    create table if not exists metas (
      id              bigint generated always as identity primary key,
      nombre          text not null,
      categoria       text not null default 'otra',
      monto_objetivo  numeric(14,2) not null check (monto_objetivo > 0),
      fecha_objetivo  date,
      cuentas_puc     text not null default '',
      entidad_id      bigint references entidades (id),
      activa          boolean not null default true,
      notas           text,
      creado_en       timestamptz not null default now(),
      actualizado_en  timestamptz not null default now()
    )
  `, []);
  await sql.query('create index if not exists metas_activa_idx on metas (activa)', []);
}

/** Solo para tests: fuerza a que la próxima llamada vuelva a intentar el DDL. */
export function resetMetasSchemaParaTests() {
  _metasSchemaPromise = null;
}

/** Lista de metas (opcionalmente solo las activas), de más vieja a más nueva. */
export async function listMetas({ soloActivas } = {}, sqlArg) {
  await ensureMetasSchema(sqlArg);
  const sql = sqlArg || await getSql();
  return sql.query(
    soloActivas
      ? 'select * from metas where activa order by creado_en asc, id asc'
      : 'select * from metas order by creado_en asc, id asc',
    []
  );
}

/** Una meta por id. */
export async function getMeta(id, sqlArg) {
  await ensureMetasSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const rows = await sql.query('select * from metas where id = $1 limit 1', [id]);
  return rows[0] || null;
}

/** Crea una meta nueva. */
export async function insertMeta(m, sqlArg) {
  await ensureMetasSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const rows = await sql.query(
    `insert into metas (nombre, categoria, monto_objetivo, fecha_objetivo, cuentas_puc, entidad_id, notas)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [m.nombre, m.categoria || 'otra', Number(m.monto_objetivo) || 0, m.fecha_objetivo || null,
      m.cuentas_puc || '', m.entidad_id || null, m.notas || null]
  );
  return rows[0];
}

/** Edita campos de una meta existente (gestión, solo owners). */
export async function updateMeta(id, patch, sqlArg) {
  await ensureMetasSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const rows = await sql.query(
    `update metas set
        nombre = coalesce($2, nombre),
        categoria = coalesce($3, categoria),
        monto_objetivo = coalesce($4, monto_objetivo),
        fecha_objetivo = coalesce($5, fecha_objetivo),
        cuentas_puc = coalesce($6, cuentas_puc),
        activa = coalesce($7, activa),
        notas = coalesce($8, notas),
        actualizado_en = now()
      where id = $1
      returning *`,
    [id, patch.nombre ?? null, patch.categoria ?? null,
      patch.monto_objetivo != null ? Number(patch.monto_objetivo) : null,
      patch.fecha_objetivo ?? null, patch.cuentas_puc ?? null,
      patch.activa != null ? !!patch.activa : null, patch.notas ?? null]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Presupuesto mensual por categoría (issue #135, `auto-ok`). Esquema nuevo vía
// DDL idempotente en runtime — mismo patrón que ensureMetasSchema. Ver
// AUTOBUILD.md § modo auto-ok.
// ---------------------------------------------------------------------------
let _presupuestosSchemaPromise = null;

/** Crea (si no existe) `presupuestos`. Memoizado. */
export async function ensurePresupuestosSchema(sqlArg) {
  if (!_presupuestosSchemaPromise) {
    _presupuestosSchemaPromise = aplicarPresupuestosSchema(sqlArg)
      .catch((e) => { _presupuestosSchemaPromise = null; throw e; }); // reintentable si falló
  }
  return _presupuestosSchemaPromise;
}

async function aplicarPresupuestosSchema(sqlArg) {
  const sql = sqlArg || await getSql();
  await sql.query(`
    create table if not exists presupuestos (
      id              bigint generated always as identity primary key,
      categoria       text not null,
      anio            int not null,
      mes             int not null check (mes between 1 and 12),
      monto_ptto      numeric(14,2) not null default 0 check (monto_ptto >= 0),
      creado_en       timestamptz not null default now(),
      actualizado_en  timestamptz not null default now(),
      unique (categoria, anio, mes)
    )
  `, []);
  await sql.query('create index if not exists presupuestos_periodo_idx on presupuestos (anio, mes)', []);
}

/** Solo para tests: fuerza a que la próxima llamada vuelva a intentar el DDL. */
export function resetPresupuestosSchemaParaTests() {
  _presupuestosSchemaPromise = null;
}

/** Presupuestos fijados para un mes (anio/mes), uno por categoría. */
export async function listPresupuestos({ anio, mes }, sqlArg) {
  await ensurePresupuestosSchema(sqlArg);
  const sql = sqlArg || await getSql();
  return sql.query(
    'select * from presupuestos where anio = $1 and mes = $2 order by categoria asc',
    [anio, mes]
  );
}

/** Crea o actualiza (upsert) el presupuesto de una categoría en un mes. */
export async function upsertPresupuesto({ categoria, anio, mes, monto_ptto }, sqlArg) {
  await ensurePresupuestosSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const rows = await sql.query(
    `insert into presupuestos (categoria, anio, mes, monto_ptto)
     values ($1, $2, $3, $4)
     on conflict (categoria, anio, mes) do update set
       monto_ptto = excluded.monto_ptto,
       actualizado_en = now()
     returning *`,
    [categoria, anio, mes, monto_ptto]
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Cierre mensual (issue #92, T12b, sub-issue de #52). Congela los asientos de
// un periodo: `crearAsiento` (asientos.js) rechaza asientos con fecha dentro
// de un periodo cerrado — los ajustes van con fecha del mes siguiente.
// Esquema nuevo vía DDL idempotente en runtime (sin `.sql` manual). SENSIBLE:
// PR en borrador para aprobación de Luis (ver AUTOBUILD.md, candado).
// `entidad_id = 0` es el sentinel de "cierre global" (toda la familia);
// cerrar una entidad puntual no cierra las demás.
// ---------------------------------------------------------------------------
let _cierresSchemaPromise = null;

/** Crea (si no existe) `periodos_cerrados`. Memoizado. */
export async function ensureCierresSchema(sqlArg) {
  if (!_cierresSchemaPromise) {
    _cierresSchemaPromise = aplicarCierresSchema(sqlArg)
      .catch((e) => { _cierresSchemaPromise = null; throw e; }); // reintentable si falló
  }
  return _cierresSchemaPromise;
}

async function aplicarCierresSchema(sqlArg) {
  const sql = sqlArg || await getSql();
  await sql.query(`
    create table if not exists periodos_cerrados (
      id serial primary key,
      anio int not null,
      mes int not null,
      entidad_id bigint not null default 0,
      cerrado_por text,
      cerrado_en timestamptz not null default now(),
      unique (anio, mes, entidad_id)
    )
  `, []);
}

/** Solo para tests: fuerza a que la próxima llamada vuelva a intentar el DDL. */
export function resetCierresSchemaParaTests() {
  _cierresSchemaPromise = null;
}

/** Lista los periodos cerrados (opcionalmente filtra por año). */
export async function listPeriodosCerrados({ anio } = {}, sqlArg) {
  await ensureCierresSchema(sqlArg);
  const sql = sqlArg || await getSql();
  if (anio) {
    return sql.query('select * from periodos_cerrados where anio = $1 order by anio desc, mes desc, entidad_id asc', [Number(anio)]);
  }
  return sql.query('select * from periodos_cerrados order by anio desc, mes desc, entidad_id asc', []);
}

/** ¿Está cerrado ese (anio,mes) para esta entidad (o de forma global)? */
export async function estaPeriodoCerrado({ anio, mes, entidad_id }, sqlArg) {
  await ensureCierresSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const eid = Number(entidad_id) || 0;
  const rows = await sql.query(
    'select 1 from periodos_cerrados where anio = $1 and mes = $2 and entidad_id in (0, $3) limit 1',
    [Number(anio), Number(mes), eid]
  );
  return rows.length > 0;
}

/** Cierra un periodo (idempotente: si ya estaba cerrado, devuelve el existente). */
export async function cerrarPeriodo({ anio, mes, entidad_id, cerrado_por }, sqlArg) {
  await ensureCierresSchema(sqlArg);
  const sql = sqlArg || await getSql();
  const eid = Number(entidad_id) || 0;
  const rows = await sql.query(
    `insert into periodos_cerrados (anio, mes, entidad_id, cerrado_por)
     values ($1, $2, $3, $4)
     on conflict (anio, mes, entidad_id) do nothing
     returning *`,
    [Number(anio), Number(mes), eid, cerrado_por || null]
  );
  if (rows[0]) return { ...rows[0], ya_estaba_cerrado: false };
  const existente = await sql.query(
    'select * from periodos_cerrados where anio = $1 and mes = $2 and entidad_id = $3',
    [Number(anio), Number(mes), eid]
  );
  return { ...(existente[0] || {}), ya_estaba_cerrado: true };
}
