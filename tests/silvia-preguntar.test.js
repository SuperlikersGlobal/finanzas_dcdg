import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aQuienPreguntar, esPreguntable, preguntarPendientes } from '../netlify/functions/_lib/silvia-preguntar.js';

test('aQuienPreguntar: rutea por dueño explícito', () => {
  assert.equal(aQuienPreguntar({ dueno: 'Carolina' }).username, 'carodz2@gmail.com');
  assert.equal(aQuienPreguntar({ dueno: 'Luis' }).username, 'luis@iwin.im');
});

test('aQuienPreguntar: rutea por cuenta cuando no hay dueño', () => {
  assert.equal(aQuienPreguntar({ cuenta: '5688' }).username, 'carodz2@gmail.com'); // Caro
  assert.equal(aQuienPreguntar({ cuenta: '3164' }).nombre, 'Carolina');
  assert.equal(aQuienPreguntar({ cuenta: '0965' }).username, 'luis@iwin.im');       // Luis
});

test('aQuienPreguntar: por defecto Luis', () => {
  assert.equal(aQuienPreguntar({}).username, 'luis@iwin.im');
});

test('esPreguntable: v1 solo transferencias', () => {
  assert.equal(esPreguntable({ clase: 'transferencia' }), true);
  assert.equal(esPreguntable({ clase: 'ingreso' }), false);
  assert.equal(esPreguntable({ clase: 'gasto' }), false);
});

test('preguntarPendientes: pregunta solo las transferencias, con idempotency-key por message-id', async () => {
  const enviados = [];
  const pendientes = [
    { message_id: 'm1', clase: 'transferencia', monto: 749000, cuenta: '5688', dueno: 'Carolina', destino: '55496002953' },
    { message_id: 'm2', clase: 'ingreso', monto: 120000, cuenta: '5688', ahinoa: true },
    { message_id: 'm3', clase: 'transferencia', monto: 33200, cuenta: '0965', dueno: 'Luis' },
  ];
  const res = await preguntarPendientes(pendientes, {
    preguntar: async (arg) => { enviados.push(arg); return { enviado: true }; },
  });
  assert.equal(res.preguntados, 2);
  assert.equal(res.omitidos, 1); // el ingreso
  assert.equal(res.fallidos, 0);
  assert.equal(enviados[0].preguntarA.username, 'carodz2@gmail.com');
  assert.equal(enviados[0].idempotency_key, 'email:m1');
  assert.equal(enviados[1].preguntarA.username, 'luis@iwin.im');
});

test('preguntarPendientes: cuenta fallos sin lanzar', async () => {
  const res = await preguntarPendientes(
    [{ message_id: 'x', clase: 'transferencia', cuenta: '5688' }],
    { preguntar: async () => ({ enviado: false, motivo: 'no configurado' }) },
  );
  assert.equal(res.preguntados, 0);
  assert.equal(res.fallidos, 1);
});
