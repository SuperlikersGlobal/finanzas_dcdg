import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMontoCOP, parseMontoUS, parseFechaBanco, ultimos4, parseNotificacion,
} from '../netlify/functions/_lib/email-parse.js';

// --- Montos (los dos estilos que llegan de verdad) ---------------------------
test('parseMontoCOP: estilo colombiano y plano', () => {
  assert.equal(parseMontoCOP('$100.000,00'), 100000);
  assert.equal(parseMontoCOP('$9.714,12'), 9714.12);
  assert.equal(parseMontoCOP('$3.301.580,70'), 3301580.7);
  assert.equal(parseMontoCOP('$1161300.00'), 1161300); // plano con punto decimal
  assert.equal(parseMontoCOP('$749000'), 749000);
  // Miles con punto SIN decimal (formato Bancolombia): no truncar a 785.
  assert.equal(parseMontoCOP('$785.000'), 785000);
  assert.equal(parseMontoCOP('$50.000'), 50000);
  assert.equal(parseMontoCOP('$1.234.567'), 1234567);
  assert.equal(parseMontoCOP('$110.000'), 110000);
  assert.equal(parseMontoCOP(''), null);
});

test('parseMontoUS: estilo US de DolarApp', () => {
  assert.equal(parseMontoUS('12,919,288'), 12919288);
  assert.equal(parseMontoUS('3899.99'), 3899.99);
  assert.equal(parseMontoUS('4,000'), 4000);
});

test('parseFechaBanco: DD/MM/AAAA y DD/MM/AA → ISO', () => {
  assert.equal(parseFechaBanco('el 18/07/2026 a las 12:14'), '2026-07-18');
  assert.equal(parseFechaBanco('el 05/07/26 a las 12:04'), '2026-07-05');
});

test('ultimos4: extrae los últimos 4 dígitos', () => {
  assert.equal(ultimos4('*55400000965'), '0965');
  assert.equal(ultimos4('**2953'), '2953');
  assert.equal(ultimos4('0965'), '0965');
});

// --- parseNotificacion sobre correos REALES ----------------------------------
const banco = (body) => ({ from: 'alertasynotificaciones@an.notificacionesbancolombia.com', subject: 'Alertas y Notificaciones', body });

test('compra con débito → gasto, comercio, cuenta y dueño', () => {
  const r = parseNotificacion(banco('Compraste $100.000,00 en EDS LA CASTELLANA con tu T.Deb *4550, el 18/07/2026 a las 12:14.'));
  assert.equal(r.clase, 'gasto');
  assert.equal(r.monto, 100000);
  assert.equal(r.comercio, 'EDS LA CASTELLANA');
  assert.equal(r.cuenta, '4550');
  assert.equal(r.dueno, 'Carolina');
  assert.equal(r.fecha, '2026-07-18');
});

test('pago a comercio → gasto (AXA medicina, cuenta de Luis)', () => {
  const r = parseNotificacion(banco('Pagaste $1161300.00 a AXA COLPATRIA MEDICINA PREPAGA desde tu producto 0965 el 16/07/2026 10:51:37.'));
  assert.equal(r.clase, 'gasto');
  assert.equal(r.monto, 1161300);
  assert.equal(r.comercio, 'AXA COLPATRIA MEDICINA PREPAGA');
  assert.equal(r.dueno, 'Luis');
});

test('transferencia salida a cuenta externa → transferencia con destino', () => {
  const r = parseNotificacion(banco('Transferiste $33200.00 desde tu cuenta 0965 a la cuenta *3004694463 el 15/07/2026 a las 11:47.'));
  assert.equal(r.clase, 'transferencia');
  assert.equal(r.direccion, 'salida');
  assert.equal(r.cuenta, '0965');
  assert.equal(r.cuenta_destino, '4463');
  assert.equal(r.monto, 33200);
});

test('ingreso a 5688 → Ahinoa (Carolina)', () => {
  const r = parseNotificacion(banco('Carolina, recibiste una transferencia de CINDY LORENA CHAVARRIA PEREZ por $730000.00 en tu cuenta *5688 conectada a la llave @granados5675 el 14/07/2026'));
  assert.equal(r.clase, 'ingreso');
  assert.equal(r.monto, 730000);
  assert.equal(r.remitente, 'CINDY LORENA CHAVARRIA PEREZ');
  assert.equal(r.cuenta, '5688');
  assert.equal(r.ahinoa, true);
});

test('ingreso a la cuenta del hijo (2953) → bolsillo educación', () => {
  const r = parseNotificacion(banco('Recibiste una transferencia por $87000 de CAROLINA DIAZ GRANADOS en tu cuenta **2953, el 15/07/2026 a las 13:23.'));
  assert.equal(r.clase, 'ingreso');
  assert.equal(r.cuenta, '2953');
  assert.equal(r.dueno, 'Hijo');
  assert.equal(r.bolsillo, 'educacion');
});

test('transferencia con destino nombrado (FVC Colombia)', () => {
  const r = parseNotificacion(banco('CAROLINA, transferiste $1400000.00 a la llave 0090601940 desde tu cuenta *5688 a FVC COLOMBIA el 05/07/26 a las 12:04.'));
  assert.equal(r.clase, 'transferencia');
  assert.equal(r.destino, 'FVC COLOMBIA');
  assert.equal(r.monto, 1400000);
});

test('pago por Botón Bancolombia a comercio (Wompi)', () => {
  const r = parseNotificacion(banco('Notificación Transaccional Bancolombia: Transferiste $71655.00 por Boton Bancolombia a Wompi SAS desde producto *5688. 14/07/2026 09:13:05'));
  assert.equal(r.clase, 'gasto');
  assert.equal(r.comercio, 'Wompi SAS');
  assert.equal(r.cuenta, '5688');
});

test('PSE desde cuenta de iWin (5401) → se descarta', () => {
  const r = parseNotificacion(banco('Bancolombia: Pagaste $37804000.00 por PSE a DIAN PSE desde tu producto *5401 el 21/07/2026 a las 09:38:35.'));
  assert.ok(r.skip);
  assert.match(r.skip, /iWin/);
});

test('ruido de seguridad (OTP) → se descarta', () => {
  const r = parseNotificacion(banco('Este es tu código LUIS Bancolombia te comparte el codigo OTP 408558 que necesitas para completar tu accion.'));
  assert.equal(r.skip, 'ruido/seguridad');
});

test('DolarApp: enviaste COP → transferencia USD→COP entre cuentas propias', () => {
  const r = parseNotificacion({ from: 'no-reply@arqfinance.com', subject: 'Enviaste 12,919,288 COP a Luis Alberto Del Castillo',
    body: 'Has realizado una transferencia a Luis Alberto Del Castillo. Hemos debitado 3899.99 USDc de tu saldo.' });
  assert.equal(r.clase, 'transferencia');
  assert.equal(r.monto, 12919288);
  assert.equal(r.moneda, 'COP');
  assert.equal(r.monto_usdc, 3899.99);
});

test('DolarApp: recibiste USD de Delca2 → ingreso en USD', () => {
  const r = parseNotificacion({ from: 'no-reply@arqfinance.com', subject: 'Recibiste 4,000 USD de DELCA2 LLC',
    body: 'Has recibido 4000 USD de DELCA2 LLC. Hemos adicionado 3997 USDc a tu saldo.' });
  assert.equal(r.clase, 'ingreso');
  assert.equal(r.monto, 4000);
  assert.equal(r.moneda, 'USD');
  assert.match(r.remitente, /DELCA2/);
});

test('marketing de DolarApp → se descarta', () => {
  const r = parseNotificacion({ from: 'no-reply@arqfinance.com', subject: 'Invita a tus amigos y gana $30 USDc', body: '¿Tienes amigos que viajen?' });
  assert.equal(r.skip, 'ruido/seguridad');
});
