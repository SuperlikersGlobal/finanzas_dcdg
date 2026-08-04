/**
 * GET /api/pwa-tasas — Tasas de cambio del día (base USD) para convertir el
 * viaje/tarjeta a COP o USD. Auth login Google. Fuente: open.er-api.com.
 */
import { pwaTasasHandler } from './_lib/handlers.js';

export default pwaTasasHandler;

export const config = { path: '/api/pwa-tasas' };
