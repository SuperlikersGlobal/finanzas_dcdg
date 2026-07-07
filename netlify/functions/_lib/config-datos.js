/**
 * _lib/config-datos.js — Config-como-datos (Fase 1.5): categorías y reglas de
 * clasificación leídas de Postgres (`categorias`/`reglas`), con los arrays
 * hardcodeados de `app/src/config/{categories,rules}.js` como *semilla*
 * inicial (ver `scripts/seed-config-datos.js`) y como *fallback* si la DB no
 * responde (sin `DATABASE_URL`, error de red) o todavía no se sembró (tabla
 * vacía).
 *
 * No reemplaza esos archivos: siguen siendo la fuente de la semilla y el
 * salvavidas si Postgres falla. Decisión abierta (ver PR): si este fallback
 * se queda permanente o es solo transición mientras se valida el modelo.
 */

import { listReglas, listCategorias } from './repo.js';
import { RULES } from '../../../app/src/config/rules.js';
import { CATS } from '../../../app/src/config/categories.js';

/**
 * Reglas de clasificación activas, en el mismo shape que `RULES` (con `match`
 * como array de keywords) para que `classifyByRules` funcione igual venga de
 * la DB o del array hardcodeado.
 * @param {Object} [sqlArg]  cliente inyectable (tests).
 * @returns {Promise<Array>} nunca lanza; cae a `RULES` si la DB no responde o
 *   está vacía (aún no sembrada).
 */
export async function reglasConFallback(sqlArg) {
  try {
    const rows = await listReglas(sqlArg);
    if (!rows || !rows.length) return RULES;
    // Agrupa filas por (categoria, subcategoria, metodo_pago, iwin_prestamo):
    // la siembra inserta una fila por keyword, así que varios patrones de la
    // misma regla original vuelven a quedar juntos, como en RULES.
    const porClave = new Map();
    for (const r of rows) {
      const clave = [r.categoria, r.subcategoria || '', r.metodo_pago || '', !!r.iwin_prestamo].join('|');
      if (!porClave.has(clave)) {
        porClave.set(clave, {
          id: clave,
          match: [],
          categoria: r.categoria,
          subcategoria: r.subcategoria || '',
          ...(r.metodo_pago ? { metodo_pago: r.metodo_pago } : {}),
          ...(r.iwin_prestamo ? { iwin_prestamo: true } : {}),
        });
      }
      porClave.get(clave).match.push(r.patron);
    }
    return [...porClave.values()];
  } catch (_) {
    return RULES; // DB no configurada / no responde → fallback.
  }
}

/**
 * Categorías/subcategorías activas, en el mismo shape que `CATS`
 * (`{ categoria: [subcategoria, ...] }`).
 * @param {Object} [sqlArg]  cliente inyectable (tests).
 * @returns {Promise<Object>} nunca lanza; cae a `CATS` si la DB no responde o
 *   está vacía (aún no sembrada).
 */
export async function categoriasConFallback(sqlArg) {
  try {
    const rows = await listCategorias(sqlArg);
    if (!rows || !rows.length) return CATS;
    const cats = {};
    for (const r of rows) {
      if (!cats[r.categoria]) cats[r.categoria] = [];
      if (r.subcategoria) cats[r.categoria].push(r.subcategoria);
    }
    return cats;
  } catch (_) {
    return CATS; // DB no configurada / no responde → fallback.
  }
}
