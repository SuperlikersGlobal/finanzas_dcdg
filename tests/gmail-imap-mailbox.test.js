import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolverMailbox } from '../netlify/functions/_lib/gmail-imap.js';

const fakeClient = (mailboxes, { throws = false } = {}) => ({
  list: async () => { if (throws) throw new Error('boom'); return mailboxes; },
});

test('resolverMailbox: respeta GMAIL_IMAP_MAILBOX si está en el env', async () => {
  process.env.GMAIL_IMAP_MAILBOX = '[Gmail]/Todos los mensajes';
  const mb = await resolverMailbox(fakeClient([]));
  assert.equal(mb, '[Gmail]/Todos los mensajes');
  delete process.env.GMAIL_IMAP_MAILBOX;
});

test('resolverMailbox: sin env, encuentra "Todos los correos" por specialUse \\All (idioma español)', async () => {
  delete process.env.GMAIL_IMAP_MAILBOX;
  const mb = await resolverMailbox(fakeClient([
    { path: 'INBOX', specialUse: undefined },
    { path: '[Gmail]/Todos los mensajes', specialUse: '\\All' },
    { path: '[Gmail]/Enviados', specialUse: '\\Sent' },
  ]));
  assert.equal(mb, '[Gmail]/Todos los mensajes');
});

test('resolverMailbox: sin env, encuentra "All Mail" (idioma inglés)', async () => {
  delete process.env.GMAIL_IMAP_MAILBOX;
  const mb = await resolverMailbox(fakeClient([
    { path: 'INBOX' }, { path: '[Gmail]/All Mail', specialUse: '\\All' },
  ]));
  assert.equal(mb, '[Gmail]/All Mail');
});

test('resolverMailbox: cae a INBOX si no hay carpeta \\All', async () => {
  delete process.env.GMAIL_IMAP_MAILBOX;
  const mb = await resolverMailbox(fakeClient([{ path: 'INBOX' }]));
  assert.equal(mb, 'INBOX');
});

test('resolverMailbox: cae a INBOX si list() falla', async () => {
  delete process.env.GMAIL_IMAP_MAILBOX;
  const mb = await resolverMailbox(fakeClient([], { throws: true }));
  assert.equal(mb, 'INBOX');
});
