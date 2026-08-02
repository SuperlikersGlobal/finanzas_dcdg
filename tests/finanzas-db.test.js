import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setSqlForTests } from '../netlify/functions/_lib/db.js';
import { registrarMovimiento, resumen } from '../netlify/functions/_lib/finanzas.js';

// ---------------------------------------------------------------------------
// Fake mínimo de Postgres: implementa `sql.query(text, params)` para las pocas
// consultas que emite el flujo de registro (insert/on-conflict, dedup, update,
// empresas, eventos). Simula la restricción UNIQUE(idempotency_key).
// ---------------------------------------------------------------------------
function fakeDb({ cuentasMeta = [] } = {}) {
  const movimientos = [];
  const empresas = [];
  let seq = 0;
  const diasEntre = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

  async function query(text, params = []) {
    const t = text.replace(/\s+/g, ' ').trim();

    if (t.startsWith('insert into movimientos')) {
      // cols: fecha,tipo,categoria,subcategoria,descripcion,monto,moneda,
      //       metodo_pago,quien_pago,tarjeta,cuenta_destino,notas,origen,idempotency_key,
      //       estado_conciliacion,extracto_linea_id,tipo_gasto,tipo_gasto_persona,tipo_gasto_auto,
      //       monto_destino,moneda_destino
      const key = params[13];
      if (movimientos.some((m) => m.idempotency_key === key)) return []; // ON CONFLICT DO NOTHING
      const row = {
        id: ++seq, fecha: params[0], tipo: params[1], categoria: params[2],
        subcategoria: params[3], descripcion: params[4], monto: params[5], moneda: params[6],
        metodo_pago: params[7], quien_pago: params[8], tarjeta: params[9],
        cuenta_destino: params[10], notas: params[11], origen: params[12], idempotency_key: key,
        tipo_gasto: params[16], tipo_gasto_persona: params[17], tipo_gasto_auto: params[18],
        monto_destino: params[19], moneda_destino: params[20],
        creado_en: '2026-07-05T12:00:00Z', actualizado_en: null,
      };
      movimientos.push(row);
      return [row];
    }
    if (t.startsWith('select * from movimientos where idempotency_key')) {
      return movimientos.filter((m) => m.idempotency_key === params[0]).slice(0, 1);
    }
    if (t.startsWith('select id, fecha, descripcion, monto')) {
      // findPosibleDuplicado: monto between $1..$2, fecha ±$4 días
      const [lo, hi, fecha, dias] = params;
      return movimientos
        .filter((m) => m.monto >= lo && m.monto <= hi && diasEntre(m.fecha, fecha) <= dias)
        .sort((a, b) => b.id - a.id)
        .map((m) => ({ id: m.id, fecha: m.fecha, descripcion: m.descripcion, monto: m.monto, metodo_pago: m.metodo_pago, tarjeta: m.tarjeta }));
    }
    if (t.startsWith('update movimientos')) {
      const m = movimientos.find((x) => x.id === params[0]);
      if (!m) return [];
      if (params[1]) m.metodo_pago = params[1];
      if (params[2]) m.tarjeta = params[2];
      m.actualizado_en = '2026-07-05T12:05:00Z';
      return [m];
    }
    if (t.startsWith('insert into empresas_mov')) {
      const row = { id: ++seq, empresa: params[0], monto: params[6] };
      empresas.push(row);
      return [row];
    }
    if (t.startsWith('insert into eventos')) return [];
    if (t.startsWith('select nombre, dueno, bolsillo, cuenta_puc from cuentas_meta')) return cuentasMeta;
    return [];
  }

  return { query, _movimientos: movimientos, _empresas: empresas };
}

const base = {
  tipo: 'gasto', monto: 117781, descripcion: 'BOLD*Restaurante gre',
  categoria: 'Alimentación', subcategoria: 'Restaurante', fecha: '2026-07-04', quien_pago: 'Luis',
};

test('flujo dedup: alta → actualiza-cuenta → pregunta → fuerza', async () => {
  const db = fakeDb();
  setSqlForTests(db);

  // 1) Alta inicial SIN cuenta (como la foto del recibo).
  const r1 = await registrarMovimiento({ ...base });
  assert.equal(r1.registrado, true);
  assert.equal(db._movimientos.length, 1);

  // 2) Mismo gasto, ahora con la tarjeta Delca2 7730 → ACTUALIZA la fila (no duplica) + retiro.
  const r2 = await registrarMovimiento({ ...base, metodo_pago: 'Mercury Delca2 (7730)', tarjeta_ultimos4: '7730' });
  assert.equal(r2.actualizado, true);
  assert.equal(db._movimientos.length, 1, 'no debe crear otra fila');
  assert.ok(r2.retiro_delca2, 'debe registrar el retiro Delca2');
  assert.equal(db._movimientos[0].metodo_pago, 'Mercury Delca2 (7730)');

  // 3) Duplicado genuino (ya tiene la info) → pregunta, NO escribe.
  const r3 = await registrarMovimiento({ ...base, metodo_pago: 'Mercury Delca2 (7730)', tarjeta_ultimos4: '7730' });
  assert.equal(r3.registrado, false);
  assert.ok(r3.posible_duplicado);
  assert.equal(db._movimientos.length, 1);

  // 4) Con confirmar:true → fuerza una segunda fila.
  const r4 = await registrarMovimiento({ ...base, metodo_pago: 'Mercury Delca2 (7730)', tarjeta_ultimos4: '7730', confirmar: true });
  assert.equal(r4.registrado, true);
  assert.equal(db._movimientos.length, 2);

  setSqlForTests(null);
});

test('idempotencia: reintento exacto NO duplica (misma llave)', async () => {
  const db = fakeDb();
  setSqlForTests(db);

  const r1 = await registrarMovimiento({ ...base, metodo_pago: 'Bcol 0965', tarjeta_ultimos4: '2331' });
  assert.equal(r1.registrado, true);
  assert.equal(db._movimientos.length, 1);

  // Mismo evento reenviado (p. ej. reintento de red): misma idempotency_key.
  // El dedup humano no aplica aquí porque forzamos el mismo camino: quitamos la
  // detección previa insertando por llave. Verificamos con source_msg_id igual.
  const r2 = await registrarMovimiento({ ...base, metodo_pago: 'Bcol 0965', tarjeta_ultimos4: '2331', source_msg_id: 'wamid.X', confirmar: true });
  assert.equal(r2.registrado, true); // primera vez con esa llave explícita
  const r3 = await registrarMovimiento({ ...base, metodo_pago: 'Bcol 0965', tarjeta_ultimos4: '2331', source_msg_id: 'wamid.X', confirmar: true });
  assert.equal(r3.ya_existia, true, 'la misma source_msg_id no debe duplicar');
  assert.equal(r3.registrado, false);

  setSqlForTests(null);
});

test('transferencia USD entre cuentas: se registra como tipo transferencia, no como gasto', async () => {
  const db = fakeDb();
  setSqlForTests(db);

  const r = await registrarMovimiento({
    tipo: 'transferencia', monto: 4000, moneda: 'USD',
    cuenta_origen: 'Mercury Delca2 (7730)', cuenta_destino: 'DollarApp',
    fecha: '2026-07-06', quien_pago: 'Luis',
  });
  assert.equal(r.registrado, true);
  assert.equal(r.tipo, 'transferencia');
  assert.equal(r.moneda, 'USD');
  assert.equal(r.cuenta_origen, 'Mercury Delca2 (7730)');
  assert.equal(r.cuenta_destino, 'DollarApp');
  assert.match(r.mensaje, /USD 4,000/);

  const fila = db._movimientos[0];
  assert.equal(fila.tipo, 'transferencia');
  assert.equal(fila.categoria, 'Transferencia'); // no se clasifica como gasto
  assert.equal(fila.moneda, 'USD');
  assert.equal(fila.cuenta_destino, 'DollarApp');
  // No se registró ningún movimiento en EMPRESAS (no corre reglas iWin/Delca2).
  assert.equal(db._empresas.length, 0);

  setSqlForTests(null);
});

test('transferencia requiere cuenta de origen y destino', async () => {
  const db = fakeDb();
  setSqlForTests(db);
  await assert.rejects(
    () => registrarMovimiento({ tipo: 'transferencia', monto: 100, cuenta_origen: 'Nequi Luis', fecha: '2026-07-06' }),
    /origen y de destino/,
  );
  setSqlForTests(null);
});

// ---------------------------------------------------------------------------
// Transferencias entre monedas (#121): dos patas, USD↔COP, modelo pragmático.
// ---------------------------------------------------------------------------
test('transferencia USD→COP: guarda monto_destino/moneda_destino y calcula la tasa implícita', async () => {
  const db = fakeDb();
  setSqlForTests(db);

  const r = await registrarMovimiento({
    tipo: 'transferencia', monto: 3899, moneda: 'USD', monto_destino: 12919299, moneda_destino: 'COP',
    cuenta_origen: 'DollarApp', cuenta_destino: 'Bancolombia', fecha: '2026-07-09', quien_pago: 'Luis',
  });
  assert.equal(r.registrado, true);
  assert.equal(r.monto_destino, 12919299);
  assert.equal(r.moneda_destino, 'COP');
  assert.ok(Math.abs(r.tasa_implicita - 12919299 / 3899) < 1e-9);
  assert.match(r.mensaje, /tasa implícita/);

  const fila = db._movimientos[0];
  assert.equal(fila.monto, 3899);
  assert.equal(fila.moneda, 'USD');
  assert.equal(fila.monto_destino, 12919299);
  assert.equal(fila.moneda_destino, 'COP');

  setSqlForTests(null);
});

test('transferencia de una sola moneda: monto_destino/moneda_destino quedan null (retrocompatible)', async () => {
  const db = fakeDb();
  setSqlForTests(db);

  const r = await registrarMovimiento({
    tipo: 'transferencia', monto: 100000, moneda: 'COP',
    cuenta_origen: 'Nequi Luis', cuenta_destino: 'Bancolombia', fecha: '2026-07-09',
  });
  assert.equal(r.registrado, true);
  assert.equal(r.monto_destino, null);
  assert.equal(r.moneda_destino, null);
  assert.equal(r.tasa_implicita, null);
  assert.doesNotMatch(r.mensaje, /tasa implícita/);

  setSqlForTests(null);
});

test('transferencia con moneda_destino igual a moneda: se trata como una sola moneda', async () => {
  const db = fakeDb();
  setSqlForTests(db);

  const r = await registrarMovimiento({
    tipo: 'transferencia', monto: 4000, moneda: 'USD', monto_destino: 4000, moneda_destino: 'USD',
    cuenta_origen: 'DollarApp', cuenta_destino: 'Mercury Delca2 (7730)', fecha: '2026-07-09',
  });
  assert.equal(r.registrado, true);
  assert.equal(r.monto_destino, null);
  assert.equal(r.moneda_destino, null);

  setSqlForTests(null);
});

test('transferencia: monto_destino sin moneda_destino (o viceversa) es un error', async () => {
  const db = fakeDb();
  setSqlForTests(db);
  await assert.rejects(
    () => registrarMovimiento({
      tipo: 'transferencia', monto: 100, monto_destino: 400000,
      cuenta_origen: 'DollarApp', cuenta_destino: 'Bancolombia', fecha: '2026-07-09',
    }),
    /monto_destino y moneda_destino/,
  );
  setSqlForTests(null);
});

// ---------------------------------------------------------------------------
// Hogar vs. personal (#114): registrarMovimiento infiere tipo_gasto del
// bolsillo de la cuenta (cuentas_meta, #112), y respeta el override manual.
// ---------------------------------------------------------------------------
test('sin fila en cuentas_meta → tipo_gasto "hogar" (auto), comportamiento actual preservado', async () => {
  const db = fakeDb();
  setSqlForTests(db);
  const r = await registrarMovimiento({ ...base, metodo_pago: 'Bcol 0965' });
  assert.equal(r.registrado, true);
  assert.equal(r.tipo_gasto, 'hogar');
  assert.equal(db._movimientos[0].tipo_gasto, 'hogar');
  assert.equal(db._movimientos[0].tipo_gasto_auto, true);
  setSqlForTests(null);
});

test('cuenta con bolsillo "gasto_individual" → tipo_gasto "personal" del dueño (auto)', async () => {
  const db = fakeDb({
    cuentasMeta: [{ nombre: 'Serfinanza', dueno: 'carolina', bolsillo: 'gasto_individual', cuenta_puc: null }],
  });
  setSqlForTests(db);
  const r = await registrarMovimiento({ ...base, metodo_pago: 'Serfinanza' });
  assert.equal(r.registrado, true);
  assert.equal(r.tipo_gasto, 'personal');
  assert.equal(r.tipo_gasto_persona, 'Carolina');
  assert.equal(db._movimientos[0].tipo_gasto, 'personal');
  assert.equal(db._movimientos[0].tipo_gasto_persona, 'Carolina');
  setSqlForTests(null);
});

test('override manual "hogar" manda aunque la cuenta sea individual', async () => {
  const db = fakeDb({
    cuentasMeta: [{ nombre: 'Serfinanza', dueno: 'carolina', bolsillo: 'gasto_individual', cuenta_puc: null }],
  });
  setSqlForTests(db);
  const r = await registrarMovimiento({ ...base, metodo_pago: 'Serfinanza', tipo_gasto: 'hogar' });
  assert.equal(r.tipo_gasto, 'hogar');
  assert.equal(db._movimientos[0].tipo_gasto, 'hogar');
  assert.equal(db._movimientos[0].tipo_gasto_auto, false);
  setSqlForTests(null);
});

test('override manual "personal" con persona explícita manda sobre la cuenta común', async () => {
  const db = fakeDb();
  setSqlForTests(db);
  const r = await registrarMovimiento({ ...base, metodo_pago: 'Bcol 0965', tipo_gasto: 'personal', tipo_gasto_persona: 'Luis' });
  assert.equal(r.tipo_gasto, 'personal');
  assert.equal(r.tipo_gasto_persona, 'Luis');
  assert.equal(db._movimientos[0].tipo_gasto_auto, false);
  setSqlForTests(null);
});

// ---------------------------------------------------------------------------
// Fake de `movimientos` para las consultas de resumen() / queryResumen().
// ---------------------------------------------------------------------------
function fakeResumenDb(rows) {
  async function query(text) {
    const t = text.replace(/\s+/g, ' ').trim();
    if (t.startsWith('select coalesce(sum(monto)')) {
      const total = rows.reduce((s, r) => s + r.monto, 0);
      return [{ total, n: rows.length }];
    }
    if (t.startsWith("select coalesce(categoria,'Sin categoría')")) {
      const porCat = {};
      for (const r of rows) porCat[r.categoria] = (porCat[r.categoria] || 0) + r.monto;
      return Object.entries(porCat)
        .sort((a, b) => b[1] - a[1])
        .map(([categoria, monto]) => ({ categoria, monto }));
    }
    if (t.startsWith('select descripcion, sum(monto)')) {
      const porDesc = {};
      for (const r of rows) porDesc[r.descripcion] = (porDesc[r.descripcion] || 0) + r.monto;
      return Object.entries(porDesc)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([descripcion, monto]) => ({ descripcion, monto }));
    }
    return [];
  }
  return { query };
}

test('resumen: top_comercios agrupa por descripción, ordena y limita a 5', async () => {
  const rows = [
    { categoria: 'Alimentación', descripcion: 'Éxito', monto: 45000 },
    { categoria: 'Alimentación', descripcion: 'Éxito', monto: 30000 },
    { categoria: 'Ocio', descripcion: 'Cucinare', monto: 85000 },
    { categoria: 'Transporte', descripcion: 'Uber', monto: 18500 },
    { categoria: 'Salud', descripcion: 'Farmatodo', monto: 12000 },
    { categoria: 'Hogar', descripcion: 'Homecenter', monto: 9000 },
    { categoria: 'Otros', descripcion: 'Varios', monto: 5000 },
  ];
  setSqlForTests(fakeResumenDb(rows));

  const r = await resumen({ periodo: '2026-07-01..2026-07-31', hoy: new Date(2026, 6, 15) });
  assert.equal(r.top_comercios.length, 5);
  assert.deepEqual(r.top_comercios.map((c) => c.descripcion), ['Cucinare', 'Éxito', 'Uber', 'Farmatodo', 'Homecenter']);
  assert.equal(r.top_comercios[1].monto, 75000);
  assert.equal(r.top_comercios[1].monto_fmt, '$75.000');

  setSqlForTests(null);
});

test('gasto en MXN con tarjeta Jeeves + beneficiario empresa: preserva la moneda y no genera adelanto', async () => {
  const db = fakeDb();
  setSqlForTests(db);
  const r = await registrarMovimiento({
    tipo: 'gasto', monto: 3907.46, moneda: 'MXN', descripcion: 'Viva Aerobus MEX-MTY-MEX',
    categoria: 'Viajes', subcategoria: 'Tiquetes', fecha: '2026-07-30', quien_pago: 'Luis',
    metodo_pago: 'TC iWin (Superlikers)', tarjeta_ultimos4: '0530', beneficiario: 'empresa',
  });
  assert.equal(r.registrado, true);
  // La moneda explícita MXN se guarda tal cual (no se coacciona a COP ni a USD).
  assert.equal(db._movimientos[0].moneda, 'MXN');
  // beneficiario=empresa (costo de iWin) → NO adelanto de honorarios.
  assert.ok(!r.adelanto_empresas, 'no debe generar adelanto iWin');
  assert.equal(db._empresas.length, 0);

  setSqlForTests(null);
});
