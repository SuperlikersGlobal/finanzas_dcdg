/**
 * _lib/backup.js — Backup completo de la DB a una hoja de Sheets dedicada.
 *
 * Distinto del espejo incremental (`sheet-mirror.js`: agrega una fila por cada
 * registro nuevo, best-effort — si falla una escritura puntual, esa fila no
 * vuelve a espejarse sola). Esta corrida (Netlify Scheduled Function, ver
 * `netlify/functions/scheduled-backup-db.js`) vuelca TODO lo que hay hoy en
 * Postgres a una hoja aparte (`⚙️ BACKUP DB` por defecto, config.sheetBackup()),
 * separada de `Registro Gastos`/`EMPRESAS`, como red de seguridad si el espejo
 * incremental se desalinea. Solo lectura de la DB, solo escritura en la hoja
 * dedicada. Cada corrida REEMPLAZA el contenido de esa hoja (foto completa, no
 * acumula histórico de corridas — issue #41).
 */

import { getSql } from './db.js';
import { config } from './env.js';
import { replaceSheetContent } from './sheets.js';
import { listAllMovimientos, listAllEmpresasMov, listAllIngresos } from './repo.js';

const MOV_COLS = [
  'id', 'fecha', 'tipo', 'categoria', 'subcategoria', 'descripcion', 'monto', 'moneda',
  'metodo_pago', 'quien_pago', 'tarjeta', 'cuenta_destino', 'notas', 'origen',
  'idempotency_key', 'creado_en', 'actualizado_en',
];
const EMP_COLS = [
  'id', 'empresa', 'flujo', 'mes', 'anio', 'concepto', 'titular', 'monto', 'moneda',
  'estado', 'origen', 'movimiento_id', 'creado_en',
];
const ING_COLS = [
  'id', 'entidad_id', 'fecha', 'cedula', 'concepto', 'tercero_id', 'cuenta_id', 'monto', 'moneda',
  'retencion_fuente', 'actividad', 'notas', 'origen', 'idempotency_key', 'creado_en',
];

/** Formatea un valor de celda: Date -> ISO string; null/undefined -> ''. */
function fmt(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  return v;
}

/** Bloque "# titulo (n)" + encabezado + filas + separador, para una tabla. */
function seccion(titulo, cols, rows) {
  const out = [[`# ${titulo} (${rows.length})`], cols];
  for (const r of rows) out.push(cols.map((c) => fmt(r[c])));
  out.push([]); // fila en blanco separadora
  return out;
}

/**
 * Arma las filas del backup completo (pura, testeable sin red ni DB). `data`
 * trae los arreglos ya leídos de las 3 tablas principales.
 * @param {{movimientos?: object[], empresasMov?: object[], ingresos?: object[]}} data
 * @param {Date} [generadoEn]
 */
export function buildBackupRows({ movimientos = [], empresasMov = [], ingresos = [] } = {}, generadoEn = new Date()) {
  const rows = [];
  rows.push([`Backup DB — ${generadoEn.toISOString()} — reemplaza el contenido anterior de esta hoja`]);
  rows.push([]);
  rows.push(...seccion('movimientos', MOV_COLS, movimientos));
  rows.push(...seccion('empresas_mov', EMP_COLS, empresasMov));
  rows.push(...seccion('ingresos', ING_COLS, ingresos));
  return rows;
}

/**
 * Ejecuta el backup completo: lee las 3 tablas (solo lectura) y reemplaza la
 * hoja dedicada (solo escritura ahí). `sqlArg`/`writeFn` inyectables para tests.
 * @param {object} [sqlArg]  cliente `.query(text, params)` (default: getSql())
 * @param {(sheetName: string, rows: Array<Array>) => Promise<any>} [writeFn]
 */
export async function runBackupCompleto(sqlArg, writeFn = replaceSheetContent) {
  const sql = sqlArg || await getSql();
  const [movimientos, empresasMov, ingresos] = await Promise.all([
    listAllMovimientos(sql),
    listAllEmpresasMov(sql),
    listAllIngresos(sql),
  ]);
  const rows = buildBackupRows({ movimientos, empresasMov, ingresos });
  await writeFn(config.sheetBackup(), rows);
  return {
    ok: true,
    movimientos: movimientos.length,
    empresas_mov: empresasMov.length,
    ingresos: ingresos.length,
  };
}
