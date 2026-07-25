/**
 * GET /api/capturar-diagnostico?token=<DCDG_API_TOKEN>&dias=5
 *
 * Diagnóstico READ-ONLY de la captura por correo (IMAP): conexión, carpetas,
 * carpeta usada, y correos del banco encontrados en los últimos `dias`. No
 * registra nada. Pensado para abrirse en el navegador (por eso acepta el token
 * por query) cuando no se pueden leer los logs de producción.
 *
 * OJO: el token da acceso; trata la URL como sensible (no la compartas).
 */
import { diagnosticoImap } from './_lib/gmail-imap.js';
import { diagnosticoParseo } from './_lib/captura-scan.js';
import { requireEnv } from './_lib/env.js';

export default async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get('token')
    || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let expected;
  try { expected = requireEnv('DCDG_API_TOKEN'); }
  catch { return new Response('Servidor sin DCDG_API_TOKEN', { status: 500 }); }
  if (!token || token !== expected) {
    return new Response(JSON.stringify({ error: 'No autorizado. Usa ?token=<DCDG_API_TOKEN>' }), {
      status: 401, headers: { 'content-type': 'application/json' },
    });
  }
  const dias = Math.min(60, Math.max(1, Number(url.searchParams.get('dias')) || 5));
  try {
    // ?parse=1 → corre el parser sobre los correos hallados (sin escribir en DB)
    // para ver qué reconoce y qué descarta.
    if (url.searchParams.get('parse')) {
      const limit = Math.min(60, Math.max(1, Number(url.searchParams.get('limit')) || 20));
      const rep = await diagnosticoParseo({ dias: Math.min(dias, 7), limit });
      return new Response(JSON.stringify(rep, null, 2), {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    const rep = await diagnosticoImap({ dias });
    return new Response(JSON.stringify(rep, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }, null, 2), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }
};

export const config = { path: '/api/capturar-diagnostico' };
