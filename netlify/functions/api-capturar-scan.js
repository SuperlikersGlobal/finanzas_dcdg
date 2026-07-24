/**
 * POST /api/capturar-scan — Barrido manual de la bandeja de correo (backfill /
 * on-demand). Lee las notificaciones bancarias por IMAP desde `desde`, registra
 * los gastos (asiento automático) y devuelve el digest. Idempotente por
 * message-id. Auth: Bearer DCDG_API_TOKEN + header X-DCDG-User.
 * Body: { desde?: 'YYYY-MM-DD' }.  Ej. backfill: { "desde": "2026-07-01" }.
 */
import { makeCapturarScanHandler } from './_lib/handlers.js';

export default makeCapturarScanHandler();

export const config = { path: '/api/capturar-scan' };
