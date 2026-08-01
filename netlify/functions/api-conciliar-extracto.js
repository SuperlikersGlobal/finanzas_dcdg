/**
 * POST /api/conciliar-extracto — Concilia un extracto bancario reportado por
 * SilvIA (carril token de servicio). Recibe las transacciones ya extraídas del
 * PDF (por la visión de Claude en el CRM), las guarda, las cruza con lo ya
 * registrado, auto-concilia los matches claros y devuelve las que NO están
 * registradas para que SilvIA pregunte de qué fueron.
 *
 * Body: { cuenta, lineas?: [{fecha,descripcion,monto}], texto?, periodo?,
 *         fecha_desde?, fecha_hasta?, saldo_inicial?, saldo_final?, moneda? }
 *  `monto` con signo: negativo = débito (gasto), positivo = crédito (ingreso).
 * Auth: Bearer DCDG_API_TOKEN + header X-DCDG-User (correo autorizado).
 */
import { makeConciliarExtractoHandler } from './_lib/handlers.js';

export default makeConciliarExtractoHandler();

export const config = { path: '/api/conciliar-extracto' };
