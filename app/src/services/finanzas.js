/**
 * services/finanzas.js — Consultas y captura contra el backend (Neon).
 *
 * La fuente de verdad es Postgres; la PWA pregunta/escribe al backend,
 * autenticando al usuario con su login de Google (mismo patrón que claude.js).
 * Nunca expone el token de servicio.
 */

import { getConfig } from '../config/env.js';
import { getSessionToken } from './auth.js';

async function request(path, { method = 'GET', params = {}, body } = {}) {
  const token = await getSessionToken();
  const cfg = getConfig();
  const base = (cfg.apiBaseUrl || '').replace(/\/$/, '');
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== '')
  ).toString();
  const res = await fetch(`${base}${path}${qs ? '?' + qs : ''}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Descarga un reporte como CSV (issue #91): pide el archivo con el login de Google y lo guarda en el dispositivo. */
export async function descargarCsv(path, params, nombreArchivo) {
  const token = await getSessionToken();
  const cfg = getConfig();
  const base = (cfg.apiBaseUrl || '').replace(/\/$/, '');
  const qs = new URLSearchParams(
    Object.entries({ ...params, formato: 'csv' }).filter(([, v]) => v != null && v !== '')
  ).toString();
  const res = await fetch(`${base}${path}?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const texto = await res.text();
  const blob = new Blob([texto], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Resumen de gastos de un periodo. */
export const getResumen = (params = {}) => request('/api/pwa-resumen', { params });

/** Lista de movimientos (gastos). */
export const getMovimientos = (params = {}) => request('/api/pwa-movimientos', { params });

/** Uso de la tarjeta Jeeves/iWin, separado familia vs empresa, por rubro y moneda. */
export const getUsoTarjeta = (params = {}) => request('/api/tarjeta', { params });

/** Tasas de cambio del día (base USD): { base, fecha, rates: { COP, USD, MXN, … } }. */
export const getTasas = () => request('/api/pwa-tasas');

/** Lista de viajes (activos y cerrados). */
export const getViajes = () => request('/api/pwa-viajes');

/** Resumen de un viaje: totales por moneda, por rubro, por pagador y movimientos. */
export const getResumenViaje = (viaje_id) => request('/api/pwa-viajes', { params: { viaje_id } });

/** Saca un movimiento del viaje (des-etiqueta, sin anularlo). Solo owners. */
export const sacarDeViaje = (id) => request('/api/pwa-viajes', { method: 'POST', body: { accion: 'sacar', id } });

/** Cierra un viaje activo. Solo owners. */
export const cerrarViaje = (viaje_id) => request('/api/pwa-viajes', { method: 'POST', body: { accion: 'cerrar', viaje_id } });

/** Catálogos para el formulario de ingresos (entidades, terceros, cédulas). */
export const getCatalogos = () => request('/api/pwa-catalogos');

/** Cuentas/tarjetas activas del catálogo `⚙️ CUENTAS` (leídas en el backend). */
export const getCuentas = () => request('/api/pwa-cuentas');

/** Corrección de movimientos (solo owners): anular (con reverso contable). */
export const anularMovimiento = (id, motivo) =>
  request('/api/pwa-movimiento', { method: 'POST', body: { accion: 'anular', id, motivo } });

/** Corrección de movimientos (solo owners): recategorizar y recontabilizar. */
export const recategorizarMovimiento = (body) =>
  request('/api/pwa-movimiento', { method: 'POST', body: { accion: 'recategorizar', ...body } });

/** Lista de ingresos. */
export const getIngresos = (params = {}) => request('/api/pwa-ingreso', { params });

/** Registra un ingreso. */
export const registrarIngreso = (body) => request('/api/pwa-ingreso', { method: 'POST', body });

/** Lista/reporte (mini-P&L) de costos de actividad económica (issue #154, p.ej. Ahinoa). */
export const getCostosActividad = (params = {}) => request('/api/pwa-costo-actividad', { params });

/** Registra un costo de actividad económica. */
export const registrarCostoActividad = (body) => request('/api/pwa-costo-actividad', { method: 'POST', body });

/** Lista de extractos bancarios cargados (o las líneas de uno, con extracto_id). */
export const getExtractos = (params = {}) => request('/api/pwa-extracto', { params });

/** Carga un extracto bancario en CSV. */
export const subirExtracto = (body) => request('/api/pwa-extracto', { method: 'POST', body });

/** Propone cruces de conciliación para un extracto (solo lectura). */
export const getPropuestasConciliacion = (extracto_id) =>
  request('/api/pwa-conciliacion', { params: { extracto_id } });

/** Confirma un cruce (o el elegido manualmente ante ambigüedad) → marca conciliado. */
export const confirmarCruce = (body) => request('/api/pwa-conciliacion', { method: 'POST', body });

/** Propone la materialización de las líneas `solo_extracto` de un extracto (solo lectura). */
export const getPropuestasBackfill = (extracto_id) =>
  request('/api/pwa-backfill', { params: { extracto_id } });

/** Contabiliza (crea + asienta) las líneas de backfill aceptadas por el usuario. */
export const materializarBackfill = (body) => request('/api/pwa-backfill', { method: 'POST', body });

/** Reporte mensual de aportes IBC por persona (Fase 3.2, solo lectura). */
export const getAportes = (params = {}) => request('/api/pwa-aportes', { params });

/** Hoja de trabajo de renta por cédulas + patrimonio a 31-dic, por persona (issue #130, solo lectura). */
export const getRentaAnual = (params = {}) => request('/api/pwa-renta-anual', { params });

/** "Cierre del mes" (issue #118): resumen consolidado para la cita financiera de la pareja. */
export const getCierreMes = (params = {}) => request('/api/pwa-cierre-mes', { params });

/** Intenta que SilvIA le mande el resumen del mes por WhatsApp (opcional, puede degradar). */
export const enviarResumenCierreMes = (body = {}) =>
  request('/api/pwa-cierre-mes', { method: 'POST', body: { accion: 'enviar_resumen', ...body } });

/** Reporte mensual de aportes al fondo común del hogar (issue #113): por persona, cuota y % cumplido. */
export const getAportesHogar = (params = {}) => request('/api/pwa-aportes-hogar', { params });

/** Registra un aporte al fondo común (solo owners). */
export const registrarAporteHogar = (body) => request('/api/pwa-aportes-hogar', { method: 'POST', body });

/** Plan de cuentas (PUC). Opcional ?clase=1..6. */
export const getPlanCuentas = (params = {}) => request('/api/pwa-plan-cuentas', { params });

/** Agrega una cuenta nueva de Activo o Pasivo al plan de cuentas (solo owners). */
export const crearCuentaPlan = (body) => request('/api/pwa-plan-cuentas', { method: 'POST', body });

/** Cuentas del catálogo con sus metadatos de dueño/bolsillo/cuenta PUC (issue #112). */
export const getCuentasMeta = () => request('/api/pwa-cuentas-meta');

/** Fija los metadatos (dueño/bolsillo/cuenta_puc) de una cuenta. Solo owners. */
export const guardarCuentaMeta = (body) => request('/api/pwa-cuentas-meta', { method: 'POST', body });

/** Apertura existente de una entidad (o null). */
export const getApertura = (params = {}) => request('/api/pwa-apertura', { params });

/** Guarda el asiento de apertura (saldos iniciales). */
export const guardarApertura = (body) => request('/api/pwa-apertura', { method: 'POST', body });

/** Libro Mayor de una cuenta (T5, solo lectura). Requiere {cuenta}, opcional desde/hasta/entidad_id. */
export const getMayor = (params = {}) => request('/api/pwa-mayor', { params });

/** Balance de Comprobación (T5, solo lectura). Opcional desde/hasta/entidad_id. */
export const getComprobacion = (params = {}) => request('/api/pwa-comprobacion', { params });

/** Metas financieras con su progreso (issue #117, solo lectura). */
export const getMetas = (params = {}) => request('/api/pwa-metas', { params });

/** Crea una meta nueva. Solo owners. */
export const crearMeta = (body) => request('/api/pwa-metas', { method: 'POST', body: { accion: 'crear', ...body } });

/** Edita una meta existente (monto objetivo, cuentas vinculadas, activa/inactiva, etc). Solo owners. */
export const editarMeta = (body) => request('/api/pwa-metas', { method: 'POST', body: { accion: 'editar', ...body } });

/** Presupuesto vs. ejecutado por categoría de un mes (issue #135, solo lectura). Opcional {anio, mes}. */
export const getPresupuesto = (params = {}) => request('/api/pwa-presupuesto', { params });

/** Fija (crea o actualiza) el presupuesto de una categoría en un mes. Solo owners. */
export const guardarPresupuesto = (body) => request('/api/pwa-presupuesto', { method: 'POST', body });

/** Estado de Resultados (T6, solo lectura). Opcional desde/hasta/entidad_id. */
export const getEstadoResultados = (params = {}) => request('/api/pwa-estado-resultados', { params });

/** Balance General a una fecha (T7, solo lectura). Opcional fecha/entidad_id. */
export const getBalanceGeneral = (params = {}) => request('/api/pwa-balance-general', { params });

/** Patrimonio por persona (Luis/Carolina/Común/consolidado, issue #115). Opcional fecha. */
export const getPatrimonioPersonas = (params = {}) => request('/api/pwa-patrimonio', { params });

/** "Mi patrimonio": neto + evolución mensual de la persona logueada (issue #115). Opcional meses/fecha. */
export const getMiPatrimonio = (params = {}) => request('/api/pwa-mi-patrimonio', { params });

/** Pagos del mes (issue #73): catálogo + estado de un (anio, mes), y pendientes del mes anterior. */
export const getPagosDelMes = (params = {}) => request('/api/pwa-pagos', { params });

/** Historial de pagos: resumen por mes (últimos N) + acumulado por quién asume. */
export const getHistorialPagos = (meses = 6) => request('/api/pwa-pagos', { params: { historial: 1, meses } });

/** Marca un pago fijo como pagado en su mes (solo owners). */
export const marcarPagoFijo = (body) => request('/api/pwa-pagos', { method: 'POST', body: { accion: 'marcar', ...body } });

/** Desmarca un pago fijo (vuelve a pendiente, solo owners). */
export const desmarcarPagoFijo = (body) => request('/api/pwa-pagos', { method: 'POST', body: { accion: 'desmarcar', ...body } });

/** Agrega un pago fijo nuevo al catálogo (solo owners). */
export const crearPagoFijo = (body) => request('/api/pwa-pagos', { method: 'POST', body: { accion: 'crear', ...body } });

/** Edita (o desactiva, con {activo:false}) un pago fijo existente (solo owners). */
export const editarPagoFijo = (body) => request('/api/pwa-pagos', { method: 'POST', body: { accion: 'editar', ...body } });

/** Préstamos entre Luis y Carolina (issue #77): lista + saldo neto por moneda. */
export const getPrestamos = (params = {}) => request('/api/pwa-prestamos', { params });

/** Registra un préstamo (o un abono, con "de"/"para" invertidos). Solo owners. */
export const crearPrestamo = (body) => request('/api/pwa-prestamos', { method: 'POST', body: { accion: 'crear', ...body } });

/** Marca (o desmarca, con {saldado:false}) un préstamo como saldado. Solo owners. */
export const marcarPrestamoSaldado = (body) => request('/api/pwa-prestamos', { method: 'POST', body: { accion: 'marcar_saldado', ...body } });

/** "Pagar con mi plata algo del otro" (issue #116): registra el pago + el préstamo en un solo toque. Solo owners. */
export const pagarDeudaOtro = (body) => request('/api/pwa-prestamos', { method: 'POST', body: { accion: 'pagar_deuda_otro', ...body } });

/** Solicitudes de mejoras (issue #78): lista issues abiertos con label `autobuild`. */
export const getSolicitudes = () => request('/api/pwa-solicitudes');

/** Envía una solicitud de mejora nueva (crea el issue en GitHub). Solo owners. */
export const crearSolicitud = (body) => request('/api/pwa-solicitudes', { method: 'POST', body });

/** Cierre mensual (issue #92): lista los periodos cerrados. Opcional {anio}. */
export const getPeriodosCerrados = (params = {}) => request('/api/pwa-cierre', { params });

/** Cierra un periodo (congela sus asientos). Solo owners, sensible. */
export const cerrarPeriodo = (body) => request('/api/pwa-cierre', { method: 'POST', body });
