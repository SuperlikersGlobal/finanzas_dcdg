/**
 * config/rules.js — Reglas de clasificación de gastos DCDG.
 *
 * Fuente única de verdad para la clasificación por comercio/descripción.
 * Módulo puro (sin APIs de navegador ni de Node) para poder:
 *   - Usarse en la PWA (import directo).
 *   - Reusarse en las Netlify Functions (netlify/functions/_lib/classify.js).
 *   - Testearse con `node --test` (tests/classify.test.js).
 *
 * Estas reglas dan una clasificación determinística por keyword ANTES de
 * (o en vez de) llamar a Claude. Cuando ninguna regla matchea, el llamador
 * cae al modelo de Anthropic. Ver sección 6 del documento de contexto.
 */

/** Normaliza texto: minúsculas y sin acentos, para matching robusto. */
export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    // Elimina marcas diacríticas combinantes (U+0300–U+036F) tras NFD.
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .trim();
}

/**
 * Reglas ordenadas. La primera cuyo `match` (algún keyword) aparezca en la
 * descripción normalizada gana. Los keywords ya están normalizados.
 *
 * @typedef {Object} Regla
 * @property {string} id
 * @property {string[]} match         keywords (sin acentos, minúsculas)
 * @property {string} categoria
 * @property {string} subcategoria
 * @property {string} [metodo_pago]   fuerza método de pago (p.ej. iWin)
 * @property {boolean} [iwin_prestamo] marca adelanto de honorarios Jeeves
 */
export const RULES = [
  // ── MERCADO ────────────────────────────────────────────────
  { id: 'mercado-d1', match: ['tienda d1', 'd1 '], categoria: 'Alimentación', subcategoria: 'Mercado' },
  { id: 'mercado-ara', match: ['ara '], categoria: 'Alimentación', subcategoria: 'Mercado' },
  { id: 'mercado-dollarcity', match: ['dollarcity', 'dollar city'], categoria: 'Alimentación', subcategoria: 'Mercado' },
  { id: 'mercado-olimpica', match: ['olimpica', 'olímpica', 'sto ', 'supertiendas'], categoria: 'Alimentación', subcategoria: 'Mercado' },
  { id: 'mercado-makro', match: ['makro'], categoria: 'Alimentación', subcategoria: 'Mercado' },
  { id: 'mercado-exito', match: ['exito', 'éxito', 'almacenes exito'], categoria: 'Alimentación', subcategoria: 'Mercado' },
  { id: 'mercado-oxxo', match: ['oxxo'], categoria: 'Alimentación', subcategoria: 'Mercado' },

  // ── RESTAURANTE ────────────────────────────────────────────
  { id: 'rest-cucinare', match: ['cucinare'], categoria: 'Alimentación', subcategoria: 'Restaurante' },
  { id: 'rest-fiordi', match: ['fiordi'], categoria: 'Alimentación', subcategoria: 'Restaurante' },
  { id: 'rest-kikelopez', match: ['kike lopez', 'kike lópez'], categoria: 'Alimentación', subcategoria: 'Restaurante' },
  { id: 'rest-crepes', match: ['crepes & waffles', 'crepes and waffles', 'crepes'], categoria: 'Alimentación', subcategoria: 'Restaurante' },
  { id: 'rest-narcobollo', match: ['narcobollo'], categoria: 'Alimentación', subcategoria: 'Restaurante' },

  // ── DOMICILIOS ─────────────────────────────────────────────
  { id: 'dom-rappi', match: ['rappi'], categoria: 'Alimentación', subcategoria: 'Domicilios' },
  { id: 'dom-ifood', match: ['ifood', 'i food'], categoria: 'Alimentación', subcategoria: 'Domicilios' },

  // ── TRANSPORTE ─────────────────────────────────────────────
  { id: 'tr-uber', match: ['uber'], categoria: 'Transporte', subcategoria: 'Uber-Taxi' },
  { id: 'tr-indriver', match: ['indriver', 'indrive'], categoria: 'Transporte', subcategoria: 'Uber-Taxi' },
  { id: 'tr-cabify', match: ['cabify'], categoria: 'Transporte', subcategoria: 'Uber-Taxi' },
  { id: 'tr-gasolina', match: ['eds ', 'terpel', 'biomax', 'estacion de servicio', 'estación de servicio'], categoria: 'Transporte', subcategoria: 'Gasolina-EDS' },
  { id: 'tr-peajes', match: ['flypass', 'f2x sas', 'f2x flypass', 'peaje'], categoria: 'Transporte', subcategoria: 'Peajes' },
  { id: 'tr-lavado', match: ['prontowash', 'lavadero', 'lavado'], categoria: 'Transporte', subcategoria: 'Vehículos-Lavado' },

  // ── SALUD ──────────────────────────────────────────────────
  { id: 'salud-farma', match: ['farmatodo', 'cruz verde', 'drogueria', 'droguería', 'farmacia'], categoria: 'Salud', subcategoria: 'Medicamentos' },
  { id: 'salud-cita', match: ['clinica', 'clínica', 'sanitas', 'consultorio', 'ips '], categoria: 'Salud', subcategoria: 'Citas Médicas' },

  // ── ENTRETENIMIENTO / SUSCRIPCIONES ────────────────────────
  { id: 'sub-streaming', match: ['netflix', 'spotify', 'amazon', 'apple.com', 'apple ', 'disney', 'youtube', 'hbo', 'max '], categoria: 'Entretenimiento', subcategoria: 'Suscripciones' },

  // ── HIJOS / COLEGIO ────────────────────────────────────────
  { id: 'biofood', match: ['biofood'], categoria: 'Gastos Luhijo-Luciano', subcategoria: 'Meriendas-Almuerzos Colegio' },
  { id: 'colegio', match: ['colegio aleman', 'colegio alemán', 'deutsche schule'], categoria: 'Educación', subcategoria: 'Colegio' },

  // ── BANCARIO ───────────────────────────────────────────────
  { id: 'banco', match: ['4x1000', '4 x 1000', 'cuota manejo', 'cuota de manejo', 'pse ', 'comision', 'comisión', 'gmf'], categoria: 'Gastos Bancarios', subcategoria: 'Comisiones' },

  // ── IWIN / CORPORATIVO (tarjeta Jeeves) ────────────────────
  { id: 'iwin', match: ['jeeves', 'tc iwin', 'iwin ', 'superlikers'], categoria: 'Corporativo', subcategoria: 'Adelanto Honorarios', metodo_pago: 'TC iWin (Superlikers)', iwin_prestamo: true },
];

/**
 * Clasifica una descripción/comercio con las reglas DCDG.
 * @param {string} descripcion  texto del comercio o descripción del gasto
 * @param {Regla[]} [rules]  lista de reglas a usar (default: RULES hardcodeadas).
 *   Permite que el llamador (p. ej. `_lib/classify.js`, Fase 1.5) inyecte reglas
 *   leídas de la DB sin duplicar el algoritmo de matching.
 * @returns {null | {categoria, subcategoria, metodo_pago?, iwin_prestamo?, regla, fuente:'reglas'}}
 */
export function classifyByRules(descripcion, rules = RULES) {
  const n = normalize(descripcion);
  if (!n) return null;
  for (const r of rules) {
    if (r.match.some((kw) => n.includes(normalize(kw)))) {
      const out = {
        categoria: r.categoria,
        subcategoria: r.subcategoria,
        regla: r.id,
        fuente: 'reglas',
      };
      if (r.metodo_pago) out.metodo_pago = r.metodo_pago;
      if (r.iwin_prestamo) out.iwin_prestamo = true;
      return out;
    }
  }
  return null;
}

/** Lista de categorías conocidas (para prompts y validaciones). */
export const CATEGORIAS = [...new Set(RULES.map((r) => r.categoria))].sort();
