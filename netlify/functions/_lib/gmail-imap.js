/**
 * _lib/gmail-imap.js — Lector IMAP de notificaciones bancarias (Gmail / Google
 * Workspace). Es la "capa correcta" de la captura por correo: corre en el
 * servidor (Netlify Scheduled Function), que sí tiene salida a internet, en vez
 * de una sesión de Claude (sin egress y con el token de Gmail que expira).
 *
 * Autentica con una **App Password** de 16 caracteres guardada como secreto en
 * el env de Netlify (GMAIL_IMAP_USER / GMAIL_IMAP_PASSWORD). Abre la bandeja en
 * SOLO LECTURA: no marca ni etiqueta nada — la idempotencia por message-id
 * (`registrarMovimiento`) evita duplicados aunque un correo se relea.
 *
 * `imapflow` y `mailparser` se importan de forma perezosa: los tests inyectan un
 * `fetcher` falso y no necesitan el paquete instalado.
 */
import { env, requireEnv } from './env.js';

/** Remitentes de notificaciones que capturamos (banco + DolarApp/ARQ). */
export const REMITENTES_BANCO = [
  'alertasynotificaciones@an.notificacionesbancolombia.com',
  'alertasynotificaciones@bancolombia.com.co',
  'notificaciones@bancolombia.com.co',
  'no-reply@arqfinance.com',
  'no-reply@dolarapp.com',
];

/** ¿Están las credenciales IMAP configuradas? (para degradar con gracia). */
export function imapConfigured() {
  return !!(env('GMAIL_IMAP_USER') && env('GMAIL_IMAP_PASSWORD'));
}

function imapOpts() {
  return {
    host: env('GMAIL_IMAP_HOST', 'imap.gmail.com'),
    port: Number(env('GMAIL_IMAP_PORT', '993')),
    secure: true,
    auth: { user: requireEnv('GMAIL_IMAP_USER'), pass: requireEnv('GMAIL_IMAP_PASSWORD') },
    logger: false,
  };
}

/** Texto plano del correo (cae al HTML sin etiquetas si no hay parte de texto). */
function cuerpoDe(parsed) {
  if (parsed.text && parsed.text.trim()) return parsed.text;
  if (parsed.html) return String(parsed.html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return '';
}

/**
 * Trae los correos bancarios recibidos desde `since` (Date; granularidad de día
 * en IMAP). Devuelve `[{ message_id, from, subject, body }]`, deduplicado por
 * Message-ID. `mailbox` por defecto INBOX; para un backfill que incluya correos
 * archivados, apuntar a "[Gmail]/All Mail" vía GMAIL_IMAP_MAILBOX.
 */
export async function fetchCorreosBancarios({ since, senders = REMITENTES_BANCO, limit = 300 } = {}) {
  const { ImapFlow } = await import('imapflow');
  const { simpleParser } = await import('mailparser');
  const mailbox = env('GMAIL_IMAP_MAILBOX', 'INBOX');
  const client = new ImapFlow(imapOpts());
  const out = [];
  const vistos = new Set();

  await client.connect();
  try {
    await client.mailboxOpen(mailbox, { readOnly: true });
    for (const sender of senders) {
      const criterio = { from: sender };
      if (since) criterio.since = since;
      let uids = [];
      try {
        uids = await client.search(criterio, { uid: true });
      } catch (e) {
        console.error('[gmail-imap] search', sender, e.message);
        continue;
      }
      for (const uid of uids) {
        if (out.length >= limit) break;
        let msg;
        try {
          msg = await client.fetchOne(uid, { source: true }, { uid: true });
        } catch (e) {
          console.error('[gmail-imap] fetch', uid, e.message);
          continue;
        }
        if (!msg || !msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const message_id = parsed.messageId || `imap:${mailbox}:${uid}`;
        if (vistos.has(message_id)) continue;
        vistos.add(message_id);
        out.push({
          message_id,
          from: (parsed.from && parsed.from.text) || sender,
          subject: parsed.subject || '',
          body: cuerpoDe(parsed),
        });
      }
    }
  } finally {
    try { await client.logout(); } catch (_) { /* best-effort */ }
  }
  return out;
}
