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
/**
 * Carpeta IMAP a leer. Si `GMAIL_IMAP_MAILBOX` viene en el env, se respeta. Si
 * no, se busca la carpeta "Todos los correos" de Gmail por su flag de uso
 * especial `\All` (su nombre está localizado: "[Gmail]/All Mail", "[Gmail]/Todos
 * los mensajes", …). Así se incluyen los correos ARCHIVADOS o con etiqueta que
 * los filtros de Gmail sacan del INBOX (típico con los avisos del banco). Cae a
 * INBOX si no encuentra la carpeta.
 */
/**
 * Diagnóstico READ-ONLY de la captura por correo: conecta al IMAP, lista las
 * carpetas, resuelve la de "Todos los correos", y busca correos del banco en los
 * últimos `dias`. Reporta cada paso y CUALQUIER error (login, carpeta, búsqueda)
 * como texto, sin registrar nada. Sirve para saber POR QUÉ no captura cuando no
 * podemos leer los logs de producción.
 */
export async function diagnosticoImap({ dias = 5 } = {}) {
  const rep = {
    configurado: imapConfigured(),
    user: env('GMAIL_IMAP_USER', null),
    host: env('GMAIL_IMAP_HOST', 'imap.gmail.com'),
    mailbox_env: env('GMAIL_IMAP_MAILBOX', null),
    conecta: false,
    mailbox_usada: null,
    carpetas: [],
    remitentes: REMITENTES_BANCO,
    ventana_dias: dias,
    total_encontrados: 0,
    muestra: [],
    error: null,
  };
  if (!rep.configurado) { rep.error = 'Faltan GMAIL_IMAP_USER / GMAIL_IMAP_PASSWORD en el entorno.'; return rep; }

  const { ImapFlow } = await import('imapflow');
  const { simpleParser } = await import('mailparser');
  const client = new ImapFlow(imapOpts());
  try {
    await client.connect();
    rep.conecta = true;
    try {
      const lista = await client.list();
      rep.carpetas = (lista || []).map((m) => ({ path: m.path, specialUse: m.specialUse || null }));
    } catch (e) { rep.carpetas_error = e.message; }

    const mailbox = await resolverMailbox(client);
    rep.mailbox_usada = mailbox;
    await client.mailboxOpen(mailbox, { readOnly: true });

    const since = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
    for (const sender of REMITENTES_BANCO) {
      let uids = [];
      try {
        uids = await client.search({ from: sender, since }, { uid: true });
      } catch (e) { rep.muestra.push({ sender, error: e.message }); continue; }
      rep.total_encontrados += uids.length;
      for (const uid of uids.slice(-4)) {
        try {
          const msg = await client.fetchOne(uid, { source: true }, { uid: true });
          const parsed = await simpleParser(msg.source);
          rep.muestra.push({
            sender,
            from: (parsed.from && parsed.from.text) || sender,
            subject: parsed.subject || '',
            fecha: parsed.date ? new Date(parsed.date).toISOString().slice(0, 10) : null,
          });
        } catch (e) { rep.muestra.push({ sender, uid, error: e.message }); }
      }
    }
  } catch (e) {
    rep.error = e.message; // aquí sale el fallo de login IMAP (App Password / Workspace).
  } finally {
    try { await client.logout(); } catch (_) { /* best-effort */ }
  }
  return rep;
}

export async function resolverMailbox(client) {
  const explicito = env('GMAIL_IMAP_MAILBOX', null);
  if (explicito) return explicito;
  try {
    const lista = await client.list();
    const todos = (lista || []).find((m) => m && m.specialUse === '\\All');
    if (todos && todos.path) return todos.path;
  } catch (e) {
    console.error('[gmail-imap] list', e.message);
  }
  return 'INBOX';
}

export async function fetchCorreosBancarios({ since, senders = REMITENTES_BANCO, limit = 300, newest = false } = {}) {
  const { ImapFlow } = await import('imapflow');
  const { simpleParser } = await import('mailparser');
  const client = new ImapFlow(imapOpts());
  const out = [];
  const vistos = new Set();

  await client.connect();
  let mailbox = 'INBOX';
  try {
    mailbox = await resolverMailbox(client);
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
      // `search` devuelve UIDs ascendentes (más viejos primero). Para diagnósticos
      // que quieren lo RECIENTE, se invierte antes de aplicar el límite.
      if (newest) uids = [...uids].reverse();
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
