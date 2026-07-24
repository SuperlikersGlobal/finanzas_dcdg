import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escanearBandeja, resumirDigest, digestTexto } from '../netlify/functions/_lib/captura-scan.js';

// Correos de prueba (el fetcher se inyecta, así que no toca IMAP).
const CORREOS = [
  { message_id: 'g1', from: 'banco', subject: 's', body: 'gasto A' },
  { message_id: 'i1', from: 'banco', subject: 's', body: 'ingreso A' },
  { message_id: 't1', from: 'banco', subject: 's', body: 'transfer A' },
  { message_id: 'x1', from: 'banco', subject: 's', body: 'ruido A' },
  { message_id: 'd1', from: 'banco', subject: 's', body: 'ya existia A' },
  { message_id: 'e1', from: 'banco', subject: 's', body: 'explota A' },
];

// Doble de capturarCorreo: enruta por message_id a cada rama posible.
async function capturarFake({ message_id }) {
  switch (message_id) {
    case 'g1':
      return { registrado: true, id: 101, fecha: '2026-07-10', categoria: 'Alimentación',
        subcategoria: 'Mercado', monto_fmt: '$35.740', tx: { comercio: 'TIENDA D1', cuenta: '2331', dueno: 'Luis' } };
    case 'i1':
      return { registrado: false, pendiente: 'ingreso', tx: { monto: 730000, moneda: 'COP', cuenta: '5688', remitente: 'CINDY', ahinoa: true, fecha: '2026-07-14' } };
    case 't1':
      return { registrado: false, pendiente: 'transferencia', tx: { monto: 33200, cuenta: '0965', destino: '3004694463', fecha: '2026-07-15' } };
    case 'x1':
      return { registrado: false, skip: 'ruido/seguridad' };
    case 'd1':
      return { registrado: false, ya_existia: true, id: 55 };
    case 'e1':
      throw new Error('boom');
    default:
      return { registrado: false, skip: 'desconocido' };
  }
}

test('escanearBandeja: agrega registrados, pendientes, ya-existían, excluidos y errores', async () => {
  const contab = [];
  const digest = await escanearBandeja({
    since: new Date('2026-07-01'),
    fetcher: async () => CORREOS,
    capturar: capturarFake,
    contabilizar: async (id) => contab.push(id),
  });

  assert.equal(digest.total, 6);
  assert.equal(digest.registrados.length, 1);
  assert.equal(digest.pendientes.length, 2);
  assert.equal(digest.yaExistian, 1);   // d1
  assert.equal(digest.excluidos, 1);    // x1 (skip)
  assert.equal(digest.errores.length, 1);
  assert.equal(digest.errores[0].message_id, 'e1');

  // Solo el gasto registrado con id se contabiliza (no el ya-existía sin alta).
  assert.deepEqual(contab, [101]);

  const reg = digest.registrados[0];
  assert.equal(reg.categoria, 'Alimentación');
  assert.equal(reg.comercio, 'TIENDA D1');
  assert.equal(reg.cuenta, '2331');

  const ing = digest.pendientes.find((p) => p.clase === 'ingreso');
  assert.equal(ing.ahinoa, true);
  assert.equal(ing.cuenta, '5688');
});

test('escanearBandeja: la contabilización que falla no tumba el barrido', async () => {
  const digest = await escanearBandeja({
    since: new Date('2026-07-01'),
    fetcher: async () => [CORREOS[0]],
    capturar: capturarFake,
    contabilizar: async () => { throw new Error('sin plan de cuentas'); },
  });
  assert.equal(digest.registrados.length, 1);
  assert.equal(digest.errores.length, 0); // el fallo de contabilización es best-effort
});

test('resumirDigest: contadores compactos para logs', async () => {
  const digest = await escanearBandeja({
    since: new Date('2026-07-01'), fetcher: async () => CORREOS, capturar: capturarFake, contabilizar: async () => {},
  });
  const r = resumirDigest(digest);
  assert.deepEqual(r, { total: 6, registrados: 1, pendientes: 2, yaExistian: 1, excluidos: 1, errores: 1 });
});

test('digestTexto: arma un resumen legible con registrados y pendientes', async () => {
  const digest = await escanearBandeja({
    since: new Date('2026-07-01'), fetcher: async () => CORREOS, capturar: capturarFake, contabilizar: async () => {},
  });
  const txt = digestTexto(digest);
  assert.match(txt, /Captura por correo — 6 correo/);
  assert.match(txt, /Registrados \(1\)/);
  assert.match(txt, /TIENDA D1/);
  assert.match(txt, /Pendientes de confirmar \(2\)/);
  assert.match(txt, /\[ingreso\].*Ahinoa/);
  assert.match(txt, /ya estaban: 1/);
});

test('escanearBandeja: bandeja vacía → digest en cero', async () => {
  const digest = await escanearBandeja({ since: new Date(), fetcher: async () => [], capturar: capturarFake, contabilizar: async () => {} });
  assert.equal(digest.total, 0);
  assert.equal(digest.registrados.length, 0);
  assert.deepEqual(resumirDigest(digest), { total: 0, registrados: 0, pendientes: 0, yaExistian: 0, excluidos: 0, errores: 0 });
});
