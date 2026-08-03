/**
 * _lib/viajes.js — Viajes (negocios/personal) para agrupar gastos y ver cuánto se
 * lleva gastado por rubro durante el viaje. Un viaje ACTIVO por persona: mientras
 * esté activo, los gastos que la persona REPORTA (SilvIA/App, no la captura
 * automática por correo) se etiquetan solos al viaje (ver finanzas.js).
 *
 * Esquema por DDL idempotente en runtime (mismo patrón que pagos fijos / metas):
 * no requiere `.sql` manual.
 */
import { getSql } from './db.js';

let _schema = null;
export function resetViajesSchemaParaTests() { _schema = null; }

/** Crea (si no existen) la tabla `viajes` y la columna `movimientos.viaje_id`. Memoizado. */
export async function ensureViajesSchema(sqlArg) {
  if (!_schema) {
    _schema = (async () => {
      const sql = sqlArg || await getSql();
      await sql.query(`create table if not exists viajes (
        id serial primary key,
        nombre text not null,
        tipo text not null default 'negocios',
        quien text,
        entidad_id integer,
        fecha_inicio date default current_date,
        fecha_fin date,
        activo boolean not null default true,
        notas text,
        creado_en timestamptz default now()
      )`, []);
      await sql.query('alter table movimientos add column if not exists viaje_id integer', []);
      // beneficiario: 'familia' (default) | 'empresa' (iWin) — para saber si un gasto
      // con la tarjeta Jeeves/iWin es familiar (adelanto, cuenta en presupuesto) o
      // de la empresa (costo de iWin: se rastrea pero no cuenta en lo familiar).
      await sql.query("alter table movimientos add column if not exists beneficiario text default 'familia'", []);
    })().catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

function normTipo(t) {
  const s = String(t || '').toLowerCase();
  return (s.includes('personal') || s.includes('famil')) ? 'personal' : 'negocios';
}

/** Inicia un viaje (y cierra otro activo del mismo `quien`: un viaje activo por persona). */
export async function crearViaje({ nombre, tipo, quien, entidad_id, notas } = {}, sqlArg) {
  const sql = sqlArg || await getSql();
  await ensureViajesSchema(sql);
  const nom = String(nombre || 'Viaje').trim();
  if (quien) {
    // Idempotencia: si ya hay un viaje ACTIVO con el mismo nombre para esa persona,
    // devuélvelo tal cual (no lo cierres ni crees uno nuevo: perdería los gastos ya
    // etiquetados). Evita el "¿iniciar viaje?" repetido que abría duplicados vacíos.
    const yaActivo = await sql.query(
      "select * from viajes where activo and quien=$1 and lower(nombre)=lower($2) order by creado_en desc limit 1",
      [quien, nom]);
    if (yaActivo[0]) return { ...yaActivo[0], _ya_existia: true };
    await sql.query("update viajes set activo=false, fecha_fin=coalesce(fecha_fin, current_date) where activo and quien=$1", [quien]);
  }
  const rows = await sql.query(
    `insert into viajes (nombre, tipo, quien, entidad_id, notas, activo)
     values ($1,$2,$3,$4,$5,true) returning *`,
    [nom, normTipo(tipo), quien || null, entidad_id || null, notas || null]);
  return rows[0];
}

/** Viaje activo de una persona (o el más reciente activo si `quien` es null). */
export async function viajeActivo(quien, sqlArg) {
  const sql = sqlArg || await getSql();
  await ensureViajesSchema(sql);
  const rows = quien
    ? await sql.query('select * from viajes where activo and quien=$1 order by creado_en desc limit 1', [quien])
    : await sql.query('select * from viajes where activo order by creado_en desc limit 1', []);
  return rows[0] || null;
}

/** Cierra un viaje (por id o el activo de `quien`). */
export async function cerrarViaje({ viaje_id, quien } = {}, sqlArg) {
  const sql = sqlArg || await getSql();
  await ensureViajesSchema(sql);
  let id = Number(viaje_id) || null;
  if (!id) { const v = await viajeActivo(quien, sql); id = v && v.id; }
  if (!id) return null;
  const rows = await sql.query(
    "update viajes set activo=false, fecha_fin=coalesce(fecha_fin, current_date) where id=$1 returning *", [id]);
  return rows[0] || null;
}

export async function listViajes({ soloActivos } = {}, sqlArg) {
  const sql = sqlArg || await getSql();
  await ensureViajesSchema(sql);
  return sql.query(`select * from viajes ${soloActivos ? 'where activo' : ''} order by activo desc, creado_en desc limit 50`, []);
}

/**
 * Resumen de gastos de un viaje: total y desglose por rubro y por pagador
 * (iWin/Jeeves = reembolsable vs. personal), separado por MONEDA (no se mezclan
 * COP y USD). `viaje_id` o el viaje activo de `quien`.
 */
export async function resumenViaje({ viaje_id, quien } = {}, sqlArg) {
  const sql = sqlArg || await getSql();
  await ensureViajesSchema(sql);
  let viaje = null;
  if (viaje_id) { const r = await sql.query('select * from viajes where id=$1', [Number(viaje_id)]); viaje = r[0]; }
  else viaje = await viajeActivo(quien, sql);
  if (!viaje) return null;

  const filtro = "viaje_id=$1 and not coalesce(anulado,false) and coalesce(monto::text,'')<>'NaN' and coalesce(tipo,'gasto')<>'transferencia'";
  const pagador = "case when metodo_pago ilike '%iwin%' or metodo_pago ilike '%jeeves%' or metodo_pago ilike '%superlikers%' then 'iWin (reembolsable)' else 'Personal' end";
  const [porMoneda, porCategoria, porPagador, items] = await Promise.all([
    sql.query(`select coalesce(moneda,'COP') moneda, sum(monto)::float8 total, count(*)::int n from movimientos where ${filtro} group by 1 order by 2 desc`, [viaje.id]),
    sql.query(`select coalesce(categoria,'Sin categoría') categoria, coalesce(moneda,'COP') moneda, sum(monto)::float8 monto, count(*)::int n from movimientos where ${filtro} group by 1,2 order by 3 desc`, [viaje.id]),
    sql.query(`select ${pagador} pagador, coalesce(moneda,'COP') moneda, sum(monto)::float8 monto, count(*)::int n from movimientos where ${filtro} group by 1,2 order by 3 desc`, [viaje.id]),
    sql.query(`select id, fecha, categoria, subcategoria, descripcion, monto, coalesce(moneda,'COP') moneda, metodo_pago from movimientos where ${filtro} order by fecha desc, id desc limit 60`, [viaje.id]),
  ]);
  return { viaje, por_moneda: porMoneda, por_categoria: porCategoria, por_pagador: porPagador, movimientos: items };
}

// Movimientos hechos con la tarjeta Jeeves/iWin (por método de pago).
const FILTRO_JEEVES = "(metodo_pago ilike '%jeeves%' or metodo_pago ilike '%iwin%' or metodo_pago ilike '%superlikers%')";

/**
 * Uso de la tarjeta Jeeves/iWin: qué se pagó con esa tarjeta, separado por
 * beneficiario (Familia = adelanto de honorarios / Empresa = costo de iWin),
 * por rubro y por moneda. Sirve para que el poseedor de la tarjeta sepa en qué
 * la ha usado tanto para la familia como para la empresa.
 * `desde`/`hasta` opcionales (YYYY-MM-DD). Sin fechas, toma todo el histórico.
 */
export async function resumenTarjeta({ desde, hasta } = {}, sqlArg) {
  const sql = sqlArg || await getSql();
  await ensureViajesSchema(sql);
  const params = [];
  let rango = '';
  if (desde) { params.push(desde); rango += ` and fecha >= $${params.length}`; }
  if (hasta) { params.push(hasta); rango += ` and fecha <= $${params.length}`; }
  const filtro = `${FILTRO_JEEVES} and not coalesce(anulado,false) and coalesce(monto::text,'')<>'NaN' and coalesce(tipo,'gasto')<>'transferencia'${rango}`;
  const benef = "case when coalesce(beneficiario,'familia')='empresa' then 'Empresa (iWin)' else 'Familia (personal)' end";
  const [porBeneficiario, porCategoria, items] = await Promise.all([
    sql.query(`select ${benef} beneficiario, coalesce(moneda,'COP') moneda, sum(monto)::float8 monto, count(*)::int n from movimientos where ${filtro} group by 1,2 order by 3 desc`, params),
    sql.query(`select ${benef} beneficiario, coalesce(categoria,'Sin categoría') categoria, coalesce(moneda,'COP') moneda, sum(monto)::float8 monto, count(*)::int n from movimientos where ${filtro} group by 1,2,3 order by 4 desc`, params),
    sql.query(`select id, fecha, categoria, subcategoria, descripcion, monto, coalesce(moneda,'COP') moneda, ${benef} beneficiario, coalesce(viaje_id,0) viaje_id from movimientos where ${filtro} order by fecha desc, id desc limit 100`, params),
  ]);
  return { desde: desde || null, hasta: hasta || null, por_beneficiario: porBeneficiario, por_categoria: porCategoria, movimientos: items };
}
