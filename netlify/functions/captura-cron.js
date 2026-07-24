/**
 * captura-cron.js — Barrido horario de la bandeja (Netlify Scheduled Function).
 *
 * Es el reemplazo robusto de la rutina de Claude para monitorear los bancos: al
 * correr en el servidor tiene salida a internet y no depende de conectores que
 * expiran. Lee las notificaciones bancarias por IMAP (ventana rodante de ~2
 * días; la idempotencia por message-id evita reprocesar), registra los gastos
 * con su asiento y avisa el digest por SilvIA. Ingresos y transferencias van al
 * digest para que la persona los confirme.
 *
 * Sin GMAIL_IMAP_USER/PASSWORD configurados degrada con gracia (no falla).
 */
import { escanearBandeja, resumirDigest, digestTexto } from './_lib/captura-scan.js';
import { imapConfigured } from './_lib/gmail-imap.js';
import { notificarSilvia } from './_lib/silvia-notify.js';
import { env } from './_lib/env.js';

const VENTANA_MS = 2 * 24 * 60 * 60 * 1000; // relee ~2 días; idempotente.

/**
 * Desde cuándo barrer. Normalmente una ventana rodante de ~2 días; si está la
 * variable CAPTURA_BACKFILL_DESDE (YYYY-MM-DD) hace un barrido amplio de una vez
 * (para el backfill inicial) — se quita esa variable cuando ya corrió. Puro.
 */
export function calcularDesde({ backfillDesde, ahora, ventanaMs = VENTANA_MS }) {
  if (backfillDesde) {
    const d = new Date(`${backfillDesde}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return { since: d, backfill: true };
  }
  return { since: new Date(ahora - ventanaMs), backfill: false };
}

export default async () => {
  if (!imapConfigured()) {
    console.log('[captura-cron] IMAP sin configurar (GMAIL_IMAP_USER/GMAIL_IMAP_PASSWORD). Nada que hacer.');
    return new Response(JSON.stringify({ ok: true, motivo: 'imap-no-config' }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const { since, backfill } = calcularDesde({ backfillDesde: env('CAPTURA_BACKFILL_DESDE'), ahora: Date.now() });
  try {
    const digest = await escanearBandeja({ since });
    const resumen = { ...resumirDigest(digest), backfill, desde: since.toISOString().slice(0, 10) };
    console.log('[captura-cron]', JSON.stringify(resumen));
    // Avisa solo si hubo novedades accionables (evita ruido horario).
    if (digest.registrados.length || digest.pendientes.length || digest.errores.length) {
      await notificarSilvia(digestTexto(digest));
    }
    return new Response(JSON.stringify({ ok: true, ...resumen }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    console.error('[captura-cron] fallo:', e.message);
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};

// Cron: cada hora en el minuto 0 (UTC).
export const config = { schedule: '@hourly' };
