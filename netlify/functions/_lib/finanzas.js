/**
 * _lib/finanzas.js — Lógica de negocio financiera DCDG (backend, fuente de verdad).
 *
 * Registra movimientos que llegan por SilvIA/WhatsApp, la PWA o cualquier cliente
 * de la API. La FUENTE DE VERDAD es Postgres (Neon); el Google Sheet quedó como
 * espejo de exportación (se escribe best-effort, no bloquea). Soporta tres tipos:
 *   - "gasto":   gasto familiar diario.
 *   - "pago":    pago de una obligación (servicios, tarjeta, cuota).
 *   - "factura": factura recibida / cuenta por pagar registrada como movimiento.
 *
 * Robustez: cada movimiento lleva una llave de idempotencia (UNIQUE en la DB), así
 * los reintentos y las escrituras en carrera colapsan en una sola fila —sin depender
 * de heurísticas. El dedup por ventana de fechas se conserva como PREGUNTA humana.
 * Aplica las reglas iWin/Delca2 y registra el adelanto/retiro en `empresas_mov`.
 */

import {
  insertMovimiento,
  findPosibleDuplicado,
  updateMovimientoCuenta,
  insertEmpresa,
  logEvento,
  queryResumen,
  listCuentasMeta,
  autovincularPagoFijo,
} from './repo.js';
import { mirrorMovimiento, mirrorEmpresa } from './sheet-mirror.js';
import { indexarCuentasMeta, cuadreTransferencia } from './contabilizar.js';
import { inferirTipoGasto } from './tipo-gasto.js';
import { deriveIdempotencyKey } from './idempotency.js';
import { clasificar } from './classify.js';
import { evaluarMovimiento } from '../../../app/src/config/iwin.js';
import { cuentaPorTarjeta, monedaDeCuenta } from '../../../app/src/config/accounts.js';
import { viajeActivo } from './viajes.js';
import {
  parseMonto,
  normalizarFecha,
  corregirAnioProbable,
  mesDeISO,
  ultimos4,
  formatCOP,
} from '../../../app/src/utils/formatters.js';

const TIPOS = new Set(['gasto', 'pago', 'factura', 'transferencia']);

const ETIQUETA_TIPO = {
  gasto: '🤖 SilvIA · gasto',
  pago: '🤖 SilvIA · pago',
  factura: '🤖 SilvIA · factura',
  transferencia: '🔁 transferencia',
};

/** Formatea un monto según la moneda: COP con separador local; otra (USD, MXN…) con su código. */
function fmtMonto(monto, moneda) {
  const m = String(moneda || 'COP').toUpperCase();
  return m === 'COP' ? formatCOP(monto) : `${m} ` + Number(monto || 0).toLocaleString('en-US');
}

/**
 * Registra un movimiento financiero en la DB (y lo espeja en el Sheet).
 * @param {Object} mov  (ver JSDoc de campos abajo)
 * @returns {Promise<Object>} resultado con lo escrito o el motivo de omisión.
 */
export async function registrarMovimiento(mov = {}) {
  const tipo = String(mov.tipo || 'gasto').toLowerCase();
  if (!TIPOS.has(tipo)) {
    throw new Error(`tipo inválido: "${mov.tipo}". Usa gasto | pago | factura | transferencia.`);
  }

  const monto = parseMonto(mov.monto);
  // OJO: NaN <= 0 es `false`, así que sin el chequeo de finitud un monto NaN
  // se colaría y contaminaría las sumas del resumen (total → NaN → "$0").
  if (monto == null || !Number.isFinite(monto) || monto <= 0) throw new Error('monto inválido o ausente');
  // Moneda: explícita si viene; si no, se INFIERE. El peso colombiano NO tiene
  // centavos, así que un monto FRACCIONARIO pagado con una cuenta en dólares
  // (Mercury Delca2 7730, DollarApp, TC iWin) es una compra en USD (bug del
  // recibo AutohausAZ US$125.90 / Xenon US$119.98 que caía a "$126 COP"). OJO:
  // esas mismas cuentas también gastan en COP en comercios locales (montos
  // ENTEROS: Olímpica $18.191, TAQUI $40.000) y esos NO se tocan. Una moneda
  // explícita del llamador siempre manda.
  // La moneda EXPLÍCITA del llamador siempre manda (COP, USD, MXN, …): se guarda
  // tal cual (ISO en mayúsculas). Sin moneda explícita, el default es COP y solo
  // se infiere USD por el heurístico de centavos en cuentas USD (Jeeves, DollarApp).
  const monedaExplicita = mov.moneda != null && String(mov.moneda).trim() !== '';
  let moneda = monedaExplicita ? String(mov.moneda).toUpperCase().trim() : 'COP';
  if (!monedaExplicita
      && Number.isFinite(monto) && Math.round(monto) !== monto
      && monedaDeCuenta({ metodo_pago: mov.metodo_pago, tarjeta_ultimos4: mov.tarjeta_ultimos4 }) === 'USD') {
    moneda = 'USD';
  }

  // Una TRANSFERENCIA entre cuentas propias NO es un gasto: no se clasifica, no
  // aplica reglas iWin/Delca2 y NO cuenta en los totales de gasto. Se maneja aparte.
  if (tipo === 'transferencia') {
    return registrarTransferencia({ ...mov, monto, moneda });
  }

  const descripcion = String(mov.descripcion || '').trim();
  if (!descripcion) throw new Error('descripcion requerida');

  // 1) Clasificación: respeta lo que venga; completa con reglas/modelo.
  let categoria = String(mov.categoria || '').trim();
  let subcategoria = String(mov.subcategoria || '').trim();
  let metodo = String(mov.metodo_pago || '').trim();
  let iwinPrestamo = false;

  if (!categoria || !subcategoria) {
    const cls = await clasificar(descripcion);
    categoria = categoria || cls.categoria;
    subcategoria = subcategoria || cls.subcategoria;
    if (!metodo && cls.metodo_pago) metodo = cls.metodo_pago;
    iwinPrestamo = !!cls.iwin_prestamo;
  }

  // 2) Resolver tarjeta y cuenta.
  const tarjeta = ultimos4(mov.tarjeta_ultimos4 || metodo);
  if (!metodo && tarjeta) {
    const cta = cuentaPorTarjeta(tarjeta);
    if (cta) metodo = cta.nombre;
  }

  // 3) Reglas de negocio iWin/Delca2.
  const evalMov = evaluarMovimiento({
    tarjeta_ultimos4: tarjeta,
    metodo_pago: metodo,
    iwin_prestamo: iwinPrestamo,
  });
  if (!evalMov.registrar) {
    return { ok: true, registrado: false, motivo: evalMov.motivo, tipo, monto };
  }

  // Beneficiario: 'empresa' (iWin) → es costo de la empresa, NO genera adelanto de
  // honorarios ni cuenta en el presupuesto FAMILIAR; solo se rastrea (tarjeta/viaje).
  // 'familia' (default) → como siempre. Aplica sobre todo a gastos con la Jeeves/iWin.
  const beneficiario = /^(empresa|iwin|negocio)/i.test(String(mov.beneficiario || '')) ? 'empresa' : 'familia';
  if (beneficiario === 'empresa') evalMov.adelanto_empresas = false; // costo de iWin, no préstamo a la persona

  const fecha = corregirAnioProbable(normalizarFecha(mov.fecha));
  const origen = String(mov.origen || 'SilvIA');
  const titular = String(mov.quien_pago || '').trim() || 'Luis';

  // 4) Dedup "humano" (ventana ±3 días · monto ±1 · comercio) vía SQL. Sirve para
  //    preguntar antes de escribir cuando NO es un reintento exacto.
  let dup = null;
  try {
    dup = await findPosibleDuplicado({ fecha, monto, descripcion });
  } catch (_) { /* si la consulta falla, seguimos como alta normal */ }

  if (dup) {
    // 4a) La fila ya existe pero le faltaba la cuenta y ahora la traemos →
    //     ACTUALIZAR esa fila (evita el duplicado del "regístralo… ah, fue con la X").
    if (!dup.metodo_pago && (metodo || tarjeta)) {
      const row = await updateMovimientoCuenta(dup.id, { metodo_pago: metodo, tarjeta });
      const emp = await registrarEmpresas(evalMov, { descripcion, titular, monto, fecha, origen, movimiento_id: dup.id });
      await logEvento('actualizacion', origen, { id: dup.id, metodo, tarjeta });
      return {
        ok: true, registrado: true, actualizado: true, id: dup.id,
        tipo, fecha, categoria, subcategoria, monto, monto_fmt: formatCOP(monto),
        metodo_pago: metodo, quien_pago: titular, tarjeta,
        adelanto_empresas: emp.adelanto, retiro_delca2: emp.retiroDelca2,
        mensaje: `Actualicé el registro con la cuenta ✅ ${metodo || tarjeta}${emp.retiroDelca2 ? ' · retiro Delca2 registrado' : ''}${emp.adelanto ? ' · adelanto iWin registrado' : ''}.`,
      };
    }
    // 4b) Duplicado genuino (ya tiene la info) → NO escribir; preguntar. Solo se
    //     registra si el llamador confirma explícitamente (confirmar: true).
    if (!mov.confirmar) {
      await logEvento('duplicado', origen, { id: dup.id, monto, descripcion, fecha });
      return {
        ok: true,
        registrado: false,
        posible_duplicado: {
          id: dup.id, fecha, monto, monto_fmt: formatCOP(monto),
          descripcion, categoria, subcategoria, metodo_actual: dup.metodo_pago,
        },
        mensaje: `Parece que ya está registrado: ${categoria}${subcategoria ? '/' + subcategoria : ''} ${formatCOP(monto)} "${descripcion}" del ${fecha}. ¿Lo anoto igual?`,
      };
    }
  }

  // 5) Alta. Llave de idempotencia: si el llamador confirma un duplicado genuino,
  //    se fuerza una llave única para que SÍ entre una segunda fila.
  let idempotencyKey = deriveIdempotencyKey({ tipo, fecha, monto, descripcion,
    idempotency_key: mov.idempotency_key, source_msg_id: mov.source_msg_id });
  if (mov.confirmar && !mov.idempotency_key && !mov.source_msg_id) {
    idempotencyKey += ':forced:' + Date.now();
  }

  const notasBase = ETIQUETA_TIPO[tipo].replace('SilvIA', origen);
  const notas = [notasBase, mov.notas].filter(Boolean).join(' — ');

  // Hogar (compartido) vs. personal de alguien (#114): por defecto se infiere
  // del bolsillo de la cuenta usada (`cuentas_meta`, #112); best-effort, cae a
  // "hogar" si la consulta falla. Un override explícito del llamador manda.
  let cuentasMeta = new Map();
  try { cuentasMeta = indexarCuentasMeta(await listCuentasMeta()); } catch (_) { /* cae a hogar */ }
  const tipoGasto = inferirTipoGasto({
    metodoPago: metodo, quienPago: titular, cuentasMeta,
    tipoGastoOverride: mov.tipo_gasto, personaOverride: mov.tipo_gasto_persona,
  });

  // Viaje: un viaje_id explícito manda; si no, se auto-etiqueta al viaje ACTIVO
  // de la persona SOLO para lo que ella reporta (SilvIA/App), no la captura
  // automática por correo (que traería gastos del hogar al viaje).
  let viaje_id = null;
  if (mov.viaje_id) viaje_id = Number(mov.viaje_id) || null;
  else if (mov.viaje_id === undefined && (origen === 'SilvIA' || origen === 'App')) {
    try { const v = await viajeActivo(titular); if (v) viaje_id = v.id; } catch (_) { /* sin viaje: sigue */ }
  }

  const { inserted, row } = await insertMovimiento({
    fecha, tipo, categoria, subcategoria, descripcion, monto, moneda,
    metodo_pago: metodo, quien_pago: titular, tarjeta, notas, origen,
    idempotency_key: idempotencyKey,
    tipo_gasto: tipoGasto.tipo_gasto, tipo_gasto_persona: tipoGasto.tipo_gasto_persona,
    tipo_gasto_auto: tipoGasto.tipo_gasto_auto, viaje_id, beneficiario,
  });

  // Reintento exacto (misma llave) → ya estaba; no duplicamos ni re-espejamos.
  if (!inserted) {
    return {
      ok: true, registrado: false, ya_existia: true, id: row && row.id,
      tipo, fecha, monto, moneda, monto_fmt: fmtMonto(monto, moneda),
      mensaje: `Ya estaba anotado ✅ ${fmtMonto(monto, moneda)} "${descripcion}" (${fecha}). No lo dupliqué.`,
    };
  }

  const movId = row.id;
  const emp = await registrarEmpresas(evalMov, { descripcion, titular, monto, fecha, origen, movimiento_id: movId });
  await logEvento('alta', origen, { id: movId, tipo, monto, categoria });

  // Auto-vínculo con pagos fijos (#136): si este gasto casa con un pago fijo del
  // mes (por categoria/subcategoria), lo marca pagado con el monto real, así el
  // usuario no tiene que "Marcar pagado" a mano. Best-effort: no bloquea el alta.
  let pagoFijoVinculado = null;
  try {
    const pf = await autovincularPagoFijo({ movimiento_id: movId, categoria, subcategoria, fecha, monto, moneda });
    if (pf) { pagoFijoVinculado = pf.concepto; await logEvento('pago_fijo_vinculado', origen, { movimiento_id: movId, pago_fijo_id: pf.id, concepto: pf.concepto }); }
  } catch (_) { /* el auto-vínculo nunca tumba el registro */ }

  // Espejo al Sheet (best-effort). Fila A-L como el layout histórico.
  mirrorMovimiento([
    fecha, mesDeISO(fecha), categoria, subcategoria, descripcion, monto,
    metodo, titular, notas, tarjeta, '', new Date(row.creado_en || Date.now()).toISOString(),
  ]);

  return {
    ok: true,
    registrado: true,
    id: movId,
    tipo, fecha, categoria, subcategoria, monto, moneda, monto_fmt: fmtMonto(monto, moneda),
    metodo_pago: metodo, quien_pago: titular, tarjeta,
    tipo_gasto: tipoGasto.tipo_gasto, tipo_gasto_persona: tipoGasto.tipo_gasto_persona,
    adelanto_empresas: emp.adelanto, retiro_delca2: emp.retiroDelca2,
    pago_fijo_vinculado: pagoFijoVinculado,
    mensaje: `Anotado ✅ ${categoria}${subcategoria ? '/' + subcategoria : ''} ${fmtMonto(monto, moneda)}${metodo ? ', ' + metodo : ''}${emp.retiroDelca2 ? ' · retiro Delca2 registrado' : ''}${emp.adelanto ? ' · adelanto iWin registrado' : ''}${pagoFijoVinculado ? ` · pago fijo "${pagoFijoVinculado}" marcado como pagado` : ''}.`,
  };
}

/**
 * Registra una TRANSFERENCIA entre cuentas propias. No es un gasto: no se
 * clasifica, no corre reglas iWin/Delca2, NO se espeja al Sheet de gastos y NO
 * cuenta en los totales de gasto (el resumen la excluye). Guarda cuenta origen,
 * cuenta destino, moneda e idempotencia.
 *
 * Dos patas en monedas distintas (issue #121, modelo pragmático USD↔COP):
 * `monto_destino`/`moneda_destino` opcionales — lo que realmente llegó al
 * destino, cuando difiere de `monto`/`moneda` (origen). Retrocompatible: si
 * no vienen, o coinciden con la moneda de origen, se comporta como siempre.
 */
async function registrarTransferencia(mov) {
  const monto = mov.monto;
  const moneda = mov.moneda === 'USD' ? 'USD' : 'COP';
  const fecha = corregirAnioProbable(normalizarFecha(mov.fecha));
  const origen = String(mov.origen || 'App');
  const titular = String(mov.quien_pago || '').trim() || 'Luis';
  const cuentaOrigen = String(mov.cuenta_origen || mov.metodo_pago || '').trim();
  const cuentaDestino = String(mov.cuenta_destino || '').trim();
  if (!cuentaOrigen || !cuentaDestino) {
    throw new Error('la transferencia requiere cuenta de origen y de destino');
  }

  let montoDestino = mov.monto_destino != null && mov.monto_destino !== '' ? Number(mov.monto_destino) : null;
  let monedaDestino = mov.moneda_destino ? (String(mov.moneda_destino).toUpperCase() === 'USD' ? 'USD' : 'COP') : null;
  if (!(montoDestino > 0)) montoDestino = null;
  if (monedaDestino === moneda) { monedaDestino = null; montoDestino = null; } // misma moneda: nada nuevo que guardar
  if ((montoDestino && !monedaDestino) || (!montoDestino && monedaDestino)) {
    throw new Error('monto_destino y moneda_destino de la transferencia deben venir juntos, o ninguno');
  }
  const { tasa } = cuadreTransferencia({ monto, moneda, monto_destino: montoDestino, moneda_destino: monedaDestino });

  const descripcion = String(mov.descripcion || '').trim()
    || `Transferencia ${cuentaOrigen} → ${cuentaDestino}`;

  let idempotencyKey = deriveIdempotencyKey({
    tipo: 'transferencia', fecha, monto, descripcion,
    idempotency_key: mov.idempotency_key, source_msg_id: mov.source_msg_id,
  });
  if (mov.confirmar && !mov.idempotency_key && !mov.source_msg_id) {
    idempotencyKey += ':forced:' + Date.now();
  }

  const notas = ['🔁 Transferencia', mov.notas].filter(Boolean).join(' — ');
  const { inserted, row } = await insertMovimiento({
    fecha, tipo: 'transferencia', categoria: 'Transferencia', subcategoria: '',
    descripcion, monto, moneda, metodo_pago: cuentaOrigen, quien_pago: titular,
    tarjeta: '', cuenta_destino: cuentaDestino, notas, origen,
    monto_destino: montoDestino, moneda_destino: monedaDestino,
    idempotency_key: idempotencyKey,
  });

  if (!inserted) {
    return {
      ok: true, registrado: false, ya_existia: true, id: row && row.id, tipo: 'transferencia',
      fecha, monto, moneda, monto_fmt: fmtMonto(monto, moneda),
      monto_destino: row && row.monto_destino, moneda_destino: row && row.moneda_destino,
      mensaje: `Esa transferencia ya estaba registrada (no la dupliqué).`,
    };
  }
  await logEvento('alta', origen, { id: row.id, tipo: 'transferencia', monto, moneda });

  const detalleDestino = montoDestino ? ` → ${fmtMonto(montoDestino, monedaDestino)}` : '';
  const detalleTasa = tasa ? ` (tasa implícita ${tasa.toLocaleString('es-CO', { maximumFractionDigits: 4 })})` : '';
  return {
    ok: true, registrado: true, id: row.id, tipo: 'transferencia',
    fecha, monto, moneda, monto_fmt: fmtMonto(monto, moneda),
    monto_destino: montoDestino, moneda_destino: monedaDestino, tasa_implicita: tasa,
    cuenta_origen: cuentaOrigen, cuenta_destino: cuentaDestino, quien_pago: titular,
    mensaje: `Transferencia registrada ✅ ${fmtMonto(monto, moneda)}${detalleDestino} · ${cuentaOrigen} → ${cuentaDestino}${detalleTasa}.`,
  };
}

/**
 * Registra en `empresas_mov` el adelanto (iWin) o el retiro (Delca2) si aplica,
 * y lo espeja en la hoja EMPRESAS (13 columnas). Reutilizado por alta y actualización.
 */
async function registrarEmpresas(evalMov, { descripcion, titular, monto, fecha, origen, movimiento_id }) {
  const mesNum = mesDeISO(fecha);
  const anio = Number(fecha.slice(0, 4)) || new Date().getFullYear();
  const mesNombre = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][mesNum - 1];
  let adelanto = null;
  let retiroDelca2 = null;

  if (evalMov.adelanto_empresas) {
    const concepto = `Adelanto honorarios LADCC · ${descripcion}`;
    await insertEmpresa({ empresa: 'Superlikers', flujo: 'Empresa → Familia', mes: mesNombre, anio,
      concepto, titular, monto, estado: 'Pendiente', origen, movimiento_id });
    mirrorEmpresa(['', 'Superlikers', 'Empresa → Familia', mesNombre, anio, concepto, titular,
      monto, 'COP', monto, 'Pendiente', '', `Registrado vía ${origen} · ${fecha}`]);
    adelanto = { tipo: 'adelanto', monto };
  }
  if (evalMov.retiro_delca2) {
    const concepto = `Retiro/distribución socios Delca2 · ${descripcion}`;
    await insertEmpresa({ empresa: 'Delca2', flujo: 'Empresa → Familia', mes: mesNombre, anio,
      concepto, titular, monto, estado: 'Registrado', origen, movimiento_id });
    mirrorEmpresa(['', 'Delca2', 'Empresa → Familia', mesNombre, anio, concepto, titular,
      monto, 'COP', monto, 'Registrado', '', `Registrado vía ${origen} · ${fecha}`]);
    retiroDelca2 = { tipo: 'retiro', monto };
  }
  return { adelanto, retiroDelca2 };
}

/**
 * Resumen de gastos desde la DB.
 * @param {Object} q
 * @param {string} [q.periodo]    'mes' | 'semana' | 'YYYY-MM' | 'YYYY-MM-DD..YYYY-MM-DD'
 * @param {string} [q.categoria]
 * @param {string} [q.quien]
 * @param {Date}   [q.hoy]        fecha de referencia (inyectable para tests)
 * @returns {Promise<Object>}
 */
export async function resumen(q = {}) {
  const hoy = q.hoy instanceof Date ? q.hoy : new Date();
  const { desde, hasta, etiqueta } = rangoPeriodo(q.periodo, hoy);

  const r = await queryResumen({ desde, hasta, categoria: q.categoria, quien: q.quien });
  const desglose = (r.por_categoria || []).map((x) => ({
    categoria: x.categoria, monto: Number(x.monto), monto_fmt: formatCOP(Number(x.monto)),
  }));
  const topComercios = (r.por_descripcion || []).map((x) => ({
    descripcion: x.descripcion, monto: Number(x.monto), monto_fmt: formatCOP(Number(x.monto)),
  }));

  return {
    ok: true,
    periodo: etiqueta,
    desde,
    hasta,
    total: Number(r.total) || 0,
    total_fmt: formatCOP(Number(r.total) || 0),
    movimientos: Number(r.movimientos) || 0,
    por_categoria: desglose,
    top_comercios: topComercios,
  };
}

/** Calcula el rango [desde, hasta] (YYYY-MM-DD) de un periodo. */
export function rangoPeriodo(periodo, hoy = new Date()) {
  const iso = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };
  const p = String(periodo || 'mes').toLowerCase().trim();

  const rango = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(p);
  if (rango) return { desde: rango[1], hasta: rango[2], etiqueta: `${rango[1]} a ${rango[2]}` };

  const mesEsp = /^(\d{4})-(\d{2})$/.exec(p);
  if (mesEsp) {
    const y = Number(mesEsp[1]);
    const m = Number(mesEsp[2]);
    const ini = new Date(y, m - 1, 1);
    const fin = new Date(y, m, 0);
    return { desde: iso(ini), hasta: iso(fin), etiqueta: p };
  }

  if (p === 'semana') {
    const d = new Date(hoy);
    const dow = (d.getDay() + 6) % 7; // lunes=0
    const ini = new Date(d);
    ini.setDate(d.getDate() - dow);
    return { desde: iso(ini), hasta: iso(hoy), etiqueta: 'semana' };
  }

  const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  return { desde: iso(ini), hasta: iso(hoy), etiqueta: 'mes' };
}
