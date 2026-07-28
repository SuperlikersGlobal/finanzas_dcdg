import test from 'node:test';
import assert from 'node:assert/strict';
import { monedaDeCuenta } from '../app/src/config/accounts.js';

test('monedaDeCuenta: infiere USD de la tarjeta 7730 (Mercury Delca2)', () => {
  assert.equal(monedaDeCuenta({ tarjeta_ultimos4: '7730' }), 'USD');
});

test('monedaDeCuenta: infiere USD de "TC 7730 Delca2" (4 dígitos embebidos)', () => {
  assert.equal(monedaDeCuenta({ metodo_pago: 'TC 7730 Delca2' }), 'USD');
});

test('monedaDeCuenta: infiere USD por palabra clave (DollarApp / iWin / Delca2)', () => {
  assert.equal(monedaDeCuenta({ metodo_pago: 'DollarApp' }), 'USD');
  assert.equal(monedaDeCuenta({ metodo_pago: 'TC iWin (Superlikers)' }), 'USD');
  assert.equal(monedaDeCuenta({ metodo_pago: 'Retiro socios Delca2' }), 'USD');
});

test('monedaDeCuenta: cuentas en pesos → COP', () => {
  assert.equal(monedaDeCuenta({ tarjeta_ultimos4: '2331' }), 'COP'); // Bcol 0965 Luis
  assert.equal(monedaDeCuenta({ metodo_pago: 'Bcol 0965' }), 'COP');
});

test('monedaDeCuenta: desconocido → null (el llamador cae a su default)', () => {
  assert.equal(monedaDeCuenta({ metodo_pago: 'Efectivo' }), null);
  assert.equal(monedaDeCuenta({}), null);
});
