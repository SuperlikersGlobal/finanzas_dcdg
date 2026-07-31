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
import { diagnosticoParseo, diagnosticoScan, escanearBandeja } from './_lib/captura-scan.js';
import { preguntarPendientes } from './_lib/silvia-preguntar.js';
import { resumen } from './_lib/finanzas.js';
import { renombrarCategoria, anularMontosNaN, corregirMonedaCuentasUSD, diagBuscarMovimientos, updateMovimientoCampos } from './_lib/repo.js';
import { requireEnv, env } from './_lib/env.js';

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
    // ?envcheck=1 → reporta qué env vars del carril de preguntas ve la función en
    // runtime (sin exponer valores completos), para depurar "no configurados".
    if (url.searchParams.get('envcheck')) {
      const u = env('SILVIA_FINANZAS_PREGUNTA_URL', '');
      return new Response(JSON.stringify({
        url_configurada: !!u,
        url_prefijo: u ? u.slice(0, 45) : null,
        secret_configurado: !!env('SILVIA_FINANZAS_PREGUNTA_SECRET'),
        autobuild_secret_configurado: !!env('AUTOBUILD_NOTIFY_SECRET'),
        auth_secret_configurado: !!env('AUTH_SECRET'),
      }, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8' } });
    }
    // ?preguntar=1&desde=&hasta= → escanea la ventana y DISPARA las preguntas por
    // WhatsApp (vía SilvIA) de los pendientes preguntables. Para probar el carril
    // de preguntas end-to-end sin esperar el cron. Devuelve el detalle (a quién,
    // enviado, y el motivo si falló → dice si el secret/URL están mal).
    if (url.searchParams.get('preguntar')) {
      const desde = url.searchParams.get('desde');
      const hasta = url.searchParams.get('hasta');
      const since = desde ? new Date(`${desde}T00:00:00Z`) : new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const before = hasta ? new Date(new Date(`${hasta}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000) : undefined;
      const digest = await escanearBandeja({ since, before, limit: 40, newest: true });
      const pre = await preguntarPendientes(digest.pendientes);
      return new Response(JSON.stringify({ ok: true, pendientes: digest.pendientes.length, ...pre }, null, 2), {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    // ?scan=1 → corre el pipeline real (REGISTRA en la DB) sobre los N correos
    // más recientes, y devuelve el digest. Para probar el registro de punta a
    // punta, independiente del cron.
    // ?corregir_fecha=<id>:<YYYY-MM-DD> → fija la fecha de un movimiento (arreglar
    // un año mal inferido por SilvIA, p. ej. 2025 en vez de 2026).
    if (url.searchParams.get('corregir_fecha')) {
      const [idStr, fecha] = String(url.searchParams.get('corregir_fecha')).split(':');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return new Response(JSON.stringify({ ok: false, error: 'usa corregir_fecha=<id>:YYYY-MM-DD' }), { status: 400, headers: { 'content-type': 'application/json' } });
      const row = await updateMovimientoCampos(Number(idStr), { fecha });
      return new Response(JSON.stringify({ ok: true, corregido: row ? { id: row.id, fecha: row.fecha, descripcion: row.descripcion } : null }, null, 2), {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }

    // ?buscar=<texto> → lista movimientos que coincidan (incluye anulados), para
    // depurar por qué algo "registrado" no aparece en el Panel.
    if (url.searchParams.get('buscar')) {
      const rows = await diagBuscarMovimientos(url.searchParams.get('buscar'));
      return new Response(JSON.stringify({ ok: true, n: rows.length, movimientos: rows }, null, 2), {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }

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
      const usd = await corregirMonedaCuentasUSD();
      return new Response(JSON.stringify({
        ok: true,
        categoria_renombradas: renombradas,
        nan_anuladas: nanAnuladas,
        usd_revertidos_a_cop: usd.revertidos,
        usd_reetiquetados: usd.marcados.length,
        usd_detalle: usd.marcados.map((r) => ({ fecha: r.fecha, descripcion: r.descripcion, monto: r.monto, cuenta: r.metodo_pago })),
      }, null, 2), {
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
