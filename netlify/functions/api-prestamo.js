/**
 * GET/POST /api/prestamo — Préstamos/abonos Luis↔Carolina para SilvIA (carril
 * token de servicio). Mismo backend con asiento que usa la PWA.
 *
 * GET o POST {accion:'saldo'} → saldo neto. POST {de, para, monto, …} → registra.
 * Auth: Bearer DCDG_API_TOKEN + header X-DCDG-User.
 */
import { makePrestamoHandler } from './_lib/handlers.js';

export default makePrestamoHandler();

export const config = { path: '/api/prestamo' };
