/**
 * POST /api/anular-movimiento — Anula (borrado suave + reverso contable) un
 * movimiento YA registrado (carril token de servicio, para SilvIA).
 *
 * Body: { id?, monto?, texto?/comercio?, motivo? }
 *  - Con `id`: anula ese movimiento.
 *  - Sin `id`: lo ubica por `monto` (±1, últimos 45 días); si hay varios devuelve
 *    los candidatos para que SilvIA pregunte cuál.
 * Auth: Bearer DCDG_API_TOKEN + header X-DCDG-User (correo autorizado).
 */
import { makeAnularMovimientoHandler } from './_lib/handlers.js';

export default makeAnularMovimientoHandler();

export const config = { path: '/api/anular-movimiento' };
