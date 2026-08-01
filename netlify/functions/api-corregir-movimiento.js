/**
 * POST /api/corregir-movimiento — Corrige/reclasifica un movimiento YA registrado
 * (carril token de servicio, para SilvIA). Evita el duplicado que ocurría cuando
 * una "corrección" se hacía re-registrando el gasto.
 *
 * Body: { id?, monto?, texto?/comercio?, categoria?, subcategoria?, tipo?, descripcion? }
 *  - Con `id`: corrige ese movimiento.
 *  - Sin `id`: lo ubica por `monto` (±1, últimos 45 días); si hay varios devuelve
 *    los candidatos para que SilvIA pregunte cuál.
 * Auth: Bearer DCDG_API_TOKEN + header X-DCDG-User (correo autorizado).
 */
import { makeCorregirMovimientoHandler } from './_lib/handlers.js';

export default makeCorregirMovimientoHandler();

export const config = { path: '/api/corregir-movimiento' };
