import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDelimLineas, parseExtractoPdfText } from '../netlify/functions/_lib/extracto-pdf.js';

test('parseDelimLineas: signo → tipo, y arma el shape de líneas', () => {
  const { lineas, errores } = parseDelimLineas(
    '2026-07-03|PAGO NEQUI|-50000\n2026-07-04|CONSIGNACION|120000',
  );
  assert.equal(errores.length, 0);
  assert.equal(lineas.length, 2);
  assert.equal(lineas[0].tipo, 'debito');
  assert.equal(lineas[0].monto, -50000);
  assert.equal(lineas[0].descripcion, 'PAGO NEQUI');
  assert.equal(lineas[1].tipo, 'credito');
  assert.equal(lineas[1].monto, 120000);
});

test('parseDelimLineas: tolera separador de miles con signo ("-1.234.567")', () => {
  const { lineas } = parseDelimLineas('2026-07-05|RETIRO|-1.234.567');
  assert.equal(lineas.length, 1);
  assert.equal(lineas[0].monto, -1234567);
});

test('parseDelimLineas: descripción con espacios internos se conserva', () => {
  const { lineas } = parseDelimLineas('2026-07-05|COMPRA EXITO CALLE 80|-45000');
  assert.equal(lineas[0].descripcion, 'COMPRA EXITO CALLE 80');
});

test('parseDelimLineas: ignora líneas de ruido (sin barra) y avisa las inválidas', () => {
  const { lineas, errores } = parseDelimLineas(
    'SALDO ANTERIOR 100000\n2026-07-05|OK|-10\n2026-07-06|SIN MONTO|abc',
  );
  assert.equal(lineas.length, 1);          // solo la válida
  assert.equal(errores.length, 1);         // la de monto inválido
});

test('parseDelimLineas: entrada vacía → sin líneas, sin lanzar', () => {
  assert.deepEqual(parseDelimLineas(''), { lineas: [], errores: [] });
  assert.deepEqual(parseDelimLineas(null), { lineas: [], errores: [] });
});

test('parseExtractoPdfText: texto vacío → error, sin llamar al modelo', async () => {
  let llamado = false;
  const r = await parseExtractoPdfText('   ', { callAnthropic: async () => { llamado = true; return ''; } });
  assert.equal(r.lineas.length, 0);
  assert.equal(llamado, false);
  assert.match(r.errores[0], /vac/i);
});

test('parseExtractoPdfText: usa modelo rápido y estructura la salida (inyectado)', async () => {
  const fakeCall = async ({ content, system, model }) => {
    assert.ok(system.includes('extractos bancarios'));
    assert.ok(content[0].text.includes('MOVIMIENTO'));
    assert.ok(model, 'debe pasar un modelo (rápido)');
    return '2026-07-06|COMPRA|-9900\n2026-07-07|ABONO|15000';
  };
  const r = await parseExtractoPdfText('... MOVIMIENTO 06/07 COMPRA -9.900 ...', { callAnthropic: fakeCall });
  assert.equal(r.lineas.length, 2);
  assert.equal(r.lineas[0].tipo, 'debito');
  assert.equal(r.lineas[1].tipo, 'credito');
});

test('parseDelimLineas: agnóstico al orden — FECHA|MONTO|DESCRIPCION (ARQ/DolarApp)', () => {
  const { lineas, errores } = parseDelimLineas(
    '2026-07-03|-10700|TDC Montecarmelo\n2026-07-05|25000|Pago recibido',
  );
  assert.equal(errores.length, 0);
  assert.equal(lineas.length, 2);
  assert.equal(lineas[0].monto, -10700);
  assert.equal(lineas[0].descripcion, 'TDC Montecarmelo');
  assert.equal(lineas[0].tipo, 'debito');
  assert.equal(lineas[1].monto, 25000);
  assert.equal(lineas[1].descripcion, 'Pago recibido');
  assert.equal(lineas[1].tipo, 'credito');
});

test('parseDelimLineas: no confunde una descripción con dígitos por el monto', () => {
  const { lineas } = parseDelimLineas('2026-07-03|Compra 3 panes D1|-8900');
  assert.equal(lineas.length, 1);
  assert.equal(lineas[0].monto, -8900);
  assert.equal(lineas[0].descripcion, 'Compra 3 panes D1');
});
