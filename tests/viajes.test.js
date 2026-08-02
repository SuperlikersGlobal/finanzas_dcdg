import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearViaje, viajeActivo, cerrarViaje, resetViajesSchemaParaTests } from '../netlify/functions/_lib/viajes.js';

// Postgres falseado en memoria para las queries de viajes.
function fakeDb() {
  const viajes = [];
  let seq = 1;
  const query = async (text, params = []) => {
    const t = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
    if (/create table|alter table/.test(t)) return [];
    if (t.startsWith('update viajes set activo=false') && t.includes('where activo and quien')) {
      viajes.filter((v) => v.activo && v.quien === params[0]).forEach((v) => { v.activo = false; });
      return [];
    }
    if (t.startsWith('update viajes set activo=false') && t.includes('where id')) {
      const v = viajes.find((x) => x.id === Number(params[0]));
      if (!v) return [];
      v.activo = false; return [v];
    }
    if (t.startsWith('insert into viajes')) {
      const v = { id: seq++, nombre: params[0], tipo: params[1], quien: params[2], entidad_id: params[3], notas: params[4], activo: true };
      viajes.push(v); return [v];
    }
    if (t.includes('from viajes where activo and quien')) {
      return viajes.filter((v) => v.activo && v.quien === params[0]).slice(-1);
    }
    if (t.includes('from viajes where activo')) {
      return viajes.filter((v) => v.activo).slice(-1);
    }
    return [];
  };
  return { query, viajes };
}

test('crearViaje: normaliza el tipo (familiar → personal)', async () => {
  resetViajesSchemaParaTests();
  const db = fakeDb();
  const v1 = await crearViaje({ nombre: 'Bogotá', tipo: 'negocios', quien: 'Luis' }, db);
  assert.equal(v1.tipo, 'negocios');
  const v2 = await crearViaje({ nombre: 'Playa', tipo: 'familiar', quien: 'Luis' }, db);
  assert.equal(v2.tipo, 'personal');
});

test('un solo viaje activo por persona: iniciar otro cierra el anterior', async () => {
  resetViajesSchemaParaTests();
  const db = fakeDb();
  await crearViaje({ nombre: 'Viaje A', quien: 'Luis' }, db);
  await crearViaje({ nombre: 'Viaje B', quien: 'Luis' }, db);
  const activo = await viajeActivo('Luis', db);
  assert.equal(activo.nombre, 'Viaje B');
  assert.equal(db.viajes.filter((v) => v.quien === 'Luis' && v.activo).length, 1);
});

test('cerrarViaje: cierra el activo de la persona', async () => {
  resetViajesSchemaParaTests();
  const db = fakeDb();
  await crearViaje({ nombre: 'Viaje C', quien: 'Carolina' }, db);
  const cerrado = await cerrarViaje({ quien: 'Carolina' }, db);
  assert.equal(cerrado.nombre, 'Viaje C');
  assert.equal(await viajeActivo('Carolina', db), null);
});
