#!/usr/bin/env node
/**
 * scripts/seed-config-datos.js — Siembra inicial de `categorias`/`reglas`
 * (Fase 1.5, config-como-datos) a partir de los arrays hardcodeados de
 * `app/src/config/{categories,rules}.js`.
 *
 * Uso (una sola vez, contra Neon — paso manual del dueño, igual que
 * `sql/schema.sql`):
 *
 *   DATABASE_URL="postgresql://…" node scripts/seed-config-datos.js
 *
 * Idempotente: se puede volver a correr sin duplicar filas.
 *   - `categorias` se compara contra lo que ya hay en la tabla antes de
 *     insertar (además de su unique(categoria,subcategoria) como red de
 *     seguridad).
 *   - `reglas` NO tiene una llave única sobre `patron` (a propósito: varias
 *     reglas legítimas podrían compartir keyword en el futuro), así que este
 *     script compara por (patron, categoria) contra lo ya sembrado antes de
 *     insertar.
 *
 * Alcance: SOLO toca `categorias`/`reglas` (catálogo de configuración, mismo
 * contenido que ya vive versionado en el código). Nunca toca `movimientos`,
 * `ingresos` ni ningún dato financiero real — no es una migración de datos,
 * es cargar un catálogo de referencia vacío por primera vez.
 */
import { getSql } from '../netlify/functions/_lib/db.js';
import { listCategorias, listReglas, insertCategoria, insertRegla } from '../netlify/functions/_lib/repo.js';
import { CATS } from '../app/src/config/categories.js';
import { RULES } from '../app/src/config/rules.js';

/** Inserta las categorías/subcategorías de `CATS` que aún no existan. */
export async function seedCategorias(sql) {
  const existentes = await listCategorias(sql);
  const yaExiste = new Set(existentes.map((r) => `${r.categoria}|${r.subcategoria || ''}`));
  let nuevas = 0;
  for (const [categoria, subs] of Object.entries(CATS)) {
    for (const subcategoria of subs) {
      const clave = `${categoria}|${subcategoria}`;
      if (yaExiste.has(clave)) continue;
      await insertCategoria({ categoria, subcategoria }, sql);
      yaExiste.add(clave);
      nuevas++;
    }
  }
  return nuevas;
}

/**
 * Inserta las reglas de `RULES` que aún no existan: una fila por keyword
 * (`match[]`), con `prioridad` = índice de la regla original en `RULES` (para
 * preservar el mismo orden "primera que matchea gana" al leer de la DB).
 */
export async function seedReglas(sql) {
  const existentes = await listReglas(sql);
  const yaExiste = new Set(existentes.map((r) => `${r.patron}|${r.categoria}`));
  let nuevas = 0;
  for (let i = 0; i < RULES.length; i++) {
    const r = RULES[i];
    for (const patron of r.match) {
      const clave = `${patron}|${r.categoria}`;
      if (yaExiste.has(clave)) continue;
      await insertRegla({
        patron,
        categoria: r.categoria,
        subcategoria: r.subcategoria,
        metodo_pago: r.metodo_pago || null,
        iwin_prestamo: !!r.iwin_prestamo,
        prioridad: i,
      }, sql);
      yaExiste.add(clave);
      nuevas++;
    }
  }
  return nuevas;
}

async function main() {
  const sql = await getSql();
  const nuevasCategorias = await seedCategorias(sql);
  const nuevasReglas = await seedReglas(sql);
  console.log(`Semilla config-como-datos: +${nuevasCategorias} categorías, +${nuevasReglas} reglas.`);
}

// Solo corre automáticamente si se ejecuta directamente (`node scripts/seed-config-datos.js`),
// no cuando otro módulo (p. ej. un test) importa `seedCategorias`/`seedReglas`.
const esMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (esMain) {
  main().catch((e) => {
    console.error('Error sembrando config-como-datos:', e.message);
    process.exitCode = 1;
  });
}
