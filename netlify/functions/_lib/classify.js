/**
 * _lib/classify.js — Clasificación backend (reglas DCDG + fallback Claude).
 *
 * Reutiliza la FUENTE ÚNICA de reglas (app/src/config/rules.js) para no
 * duplicar la lógica. Estrategia:
 *   1. Reglas determinísticas (barato, testeable) → si matchean, listo.
 *   2. Fallback al modelo Anthropic solo si no hay match.
 *
 * Fase 1.5 (config-como-datos): las reglas se leen primero de Postgres
 * (`reglas`, vía `config-datos.js`); si la DB no responde o aún no se
 * sembró, cae a las `RULES` hardcodeadas de rules.js (mismo comportamiento
 * de siempre). Ver docs/migracion-db.md.
 */

import { classifyByRules } from '../../../app/src/config/rules.js';
import { NOMBRES_CUENTAS, PERSONAS } from '../../../app/src/config/accounts.js';
import { callAnthropic, extractJson } from './anthropic.js';
import { reglasConFallback } from './config-datos.js';

function systemPrompt(categorias) {
  return [
    'Eres el clasificador de gastos de la familia DCDG (Colombia, COP).',
    'Devuelve SOLO JSON: { "categoria","subcategoria","quien_pago","metodo_pago",',
    '"monto","tarjeta_ultimos4","iwin_prestamo","confianza" }.',
    `Categorías: ${categorias.join(', ')}.`,
    `Cuentas válidas: ${NOMBRES_CUENTAS.join(', ')}.`,
    `"quien_pago" ∈ {${PERSONAS.join(', ')}}. "monto" número COP. iwin_prestamo=true si pagó con TC iWin/Jeeves.`,
  ].join('\n');
}

/**
 * Clasifica una descripción de gasto.
 * @param {string} descripcion
 * @param {{ usarModelo?: boolean }} [opts]  si false, solo reglas (sin costo).
 * @returns {Promise<Object>} clasificación normalizada.
 */
export async function clasificar(descripcion, { usarModelo = true } = {}) {
  const base = {
    categoria: '', subcategoria: '', quien_pago: '', metodo_pago: '',
    monto: null, tarjeta_ultimos4: '', iwin_prestamo: false, confianza: 0, fuente: '',
  };

  const reglas = await reglasConFallback();
  const porRegla = classifyByRules(descripcion, reglas);
  if (porRegla) {
    return {
      ...base,
      categoria: porRegla.categoria,
      subcategoria: porRegla.subcategoria,
      metodo_pago: porRegla.metodo_pago || '',
      iwin_prestamo: !!porRegla.iwin_prestamo,
      confianza: 0.9,
      fuente: 'reglas',
      _regla: porRegla.regla,
    };
  }

  if (!usarModelo) return { ...base, fuente: 'sin-clasificar' };

  const categorias = [...new Set(reglas.map((r) => r.categoria))].sort();
  const raw = await callAnthropic({
    system: systemPrompt(categorias),
    content: [{ type: 'text', text: `Clasifica este gasto:\n"""${descripcion}"""` }],
  });
  const out = extractJson(raw);
  return { ...base, ...out, fuente: 'modelo' };
}
