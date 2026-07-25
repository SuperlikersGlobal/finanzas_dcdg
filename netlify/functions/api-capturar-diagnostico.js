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
import { diagnosticoParseo, diagnosticoScan } from './_lib/captura-scan.js';
import { resumen } from './_lib/finanzas.js';
import { renombrarCategoria, anularMontosNaN } from './_lib/repo.js';
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
    // ?scan=1 → corre el pipeline real (REGISTRA en la DB) sobre los N correos
    // más recientes, y devuelve el digest. Para probar el registro de punta a
    // punta, independiente del cron.
    if (url.searchParams.get('scan')) {
      const limit = Math.min(30, Math.max(1, Number(url.searchParams.get('limit')) || 12));
      const desde = url.searchParams.get('desde') || undefined; // YYYY-MM-DD (opcional)
      const hasta = url.searchParams.get('hasta') || undefined; // YYYY-MM-DD (inclusivo)
      const rep = await diagnosticoScan({ desde, hasta, dias: Math.min(dias, 7), limit });
      return new Response(JSON.stringify(rep, null, 2), {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    // ?limpiar=1 → mantenimiento: unifica la categoría duplicada y anula filas NaN.
    if (url.searchParams.get('limpiar')) {
      const renombradas = await renombrarCategoria('Gastos Luhijo-Luciano', 'Gastos Luhijo - Luciano');
      const nanAnuladas = await anularMontosNaN();
      return new Response(JSON.stringify({ ok: true, categoria_renombradas: renombradas, nan_anuladas: nanAnuladas }, null, 2), {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    // ?resumen=1 → devuelve el resumen del backend TAL CUAL (total + por_categoria
    // completo) para ver si el "$0" viene del servidor o de un frontend viejo en
    // caché. ?periodo=mes | YYYY-MM | YYYY-MM-DD..YYYY-MM-DD.
    if (url.searchParams.get('resumen')) {
      const rep = await resumen({ periodo: url.searchParams.get('periodo') || 'mes' });
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
