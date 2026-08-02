/**
 * POST /api/viaje — Viajes (negocios/personal) para agrupar gastos y ver cuánto
 * se lleva por rubro (carril token de servicio, para SilvIA).
 *
 * Body: { accion: 'iniciar'|'cerrar'|'resumen'|'listar', nombre?, tipo?, quien?,
 *         entidad_id?, notas?, viaje_id? }
 * Mientras un viaje está activo, los gastos que la persona reporta (SilvIA/App)
 * se etiquetan solos al viaje.
 * Auth: Bearer DCDG_API_TOKEN + header X-DCDG-User (correo autorizado).
 */
import { makeViajeHandler } from './_lib/handlers.js';

export default makeViajeHandler();

export const config = { path: '/api/viaje' };
