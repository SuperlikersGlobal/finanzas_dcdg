/**
 * GET|POST /api/pwa-cierre — Cierre mensual (issue #92, T12b, sub-issue de
 * #52). GET es de lectura para todo el equipo; POST (cerrar un periodo) es
 * solo owners (Luis/Carolina). SENSIBLE: congela los asientos del periodo.
 */
import { pwaCierreHandler } from './_lib/handlers.js';

export default pwaCierreHandler;

export const config = { path: '/api/pwa-cierre' };
