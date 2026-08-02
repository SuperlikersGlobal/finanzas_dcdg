/**
 * GET/POST /api/tarjeta — Uso de la tarjeta Jeeves/iWin.
 *
 * Devuelve qué se ha pagado con la tarjeta separado por beneficiario
 * (Familia = personal/adelanto vs Empresa = costo de iWin), por rubro y por
 * moneda. Sirve tanto a SilvIA (WhatsApp) como al PWA.
 *
 * Body/Query: { desde?, hasta? } (YYYY-MM-DD; sin fechas = todo el histórico).
 * Auth: Bearer DCDG_API_TOKEN + header X-DCDG-User, o sesión Google del PWA.
 */
import { makeTarjetaHandler } from './_lib/handlers.js';

export default makeTarjetaHandler();

export const config = { path: '/api/tarjeta' };
