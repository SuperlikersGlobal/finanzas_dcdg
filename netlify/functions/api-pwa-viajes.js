/**
 * GET/POST /api/pwa-viajes — Viajes para la PWA (auth login Google).
 *   GET               → lista de viajes.
 *   GET ?viaje_id=NN  → resumen del viaje (por rubro, por pagador, movimientos).
 *   POST { accion }   → sacar/agregar un movimiento del viaje o cerrarlo (owners).
 */
import { pwaViajesHandler } from './_lib/handlers.js';

export default pwaViajesHandler;

export const config = { path: '/api/pwa-viajes' };
