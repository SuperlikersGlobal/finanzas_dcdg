/**
 * _lib/extracto-pdf.js — Estructura el TEXTO de un extracto bancario en líneas
 * normalizadas, usando Claude. Reusa el mismo shape que `parseCsvExtracto` para
 * compartir el flujo de guardado (insertExtracto / insertExtractoLineas).
 *
 * El descifrado del PDF protegido y la extracción de texto ocurren EN EL
 * NAVEGADOR (`app/src/utils/pdfExtract.js`): la contraseña (cédula del titular /
 * NIT en Bancolombia) NUNCA llega al servidor. Acá solo llega el texto legible.
 */
import { parseMonto, normalizarFecha } from '../../../app/src/utils/formatters.js';
import { callAnthropic } from './anthropic.js';

// El modelo devuelve UNA LÍNEA POR TRANSACCIÓN (no JSON): la mitad de tokens de
// salida que un JSON, y si la respuesta se corta solo se pierde la última línea
// (no se rompe todo el parseo). Clave para caber en el límite de ~10 s de las
// funciones síncronas de Netlify (el cuello de botella es el TIEMPO de
// generación, no solo el modelo). Formato exacto: FECHA|DESCRIPCION|MONTO
const SYSTEM = `Eres un extractor de transacciones de extractos bancarios colombianos (p. ej. Bancolombia). Recibes el TEXTO plano de un extracto y devuelves UNA LÍNEA POR TRANSACCIÓN con este formato EXACTO separado por barras verticales:
FECHA|DESCRIPCION|MONTO
Reglas:
- FECHA en formato YYYY-MM-DD (si a una fila le falta el año, dedúcelo del periodo del extracto).
- MONTO: número entero en pesos con signo, SIN separador de miles ni símbolo. NEGATIVO para débitos/retiros/cargos/pagos; POSITIVO para créditos/consignaciones/abonos/depósitos.
- DESCRIPCION en una sola línea, sin barras verticales.
- Una transacción por línea. NADA más: sin encabezados, sin saldos/totales, sin JSON, sin viñetas, sin explicaciones.
- Si no hay transacciones, no devuelvas nada.`;

const MAX_TEXT = 60000;

// Modelo RÁPIDO (Haiku) + salida acotada, para no pasar el timeout de Netlify.
// Configurable con EXTRACTO_MODEL.
const FAST_MODEL = process.env.EXTRACTO_MODEL || 'claude-haiku-4-5-20251001';
const MAX_OUT_TOKENS = 4096;

/** Parsea un monto con signo tolerando separadores de miles (el signo aparte). */
function parseMontoSigno(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const neg = /^-/.test(s) || /^\(.*\)$/.test(s); // "-45000" o "(45000)"
  const abs = s.replace(/^[+-]/, '').replace(/^\((.*)\)$/, '$1');
  const n = parseMonto(abs);
  if (n == null) return null;
  return neg ? -Math.abs(n) : n;
}

/**
 * Parsea la salida delimitada del modelo (una línea `FECHA|DESC|MONTO` por
 * transacción) al shape de líneas del extracto. Puro y testeable.
 * @returns {{lineas: Array, errores: string[]}}
 */
export function parseDelimLineas(text) {
  const lineas = [];
  const errores = [];
  const rows = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // Un campo "parece monto" si es solo dígitos/separadores/signo/paréntesis (NO
  // texto). Sirve para detectar la columna del monto sin depender del ORDEN: el
  // modelo a veces devuelve FECHA|MONTO|DESCRIPCION en vez de FECHA|DESCRIPCION|MONTO
  // (visto en ARQ/DolarApp), y así ambos casos funcionan.
  const pareceMonto = (s) => /^[-+(]?\s*\$?\s*[\d][\d.,\s]*\)?$/.test(String(s || '').trim());
  rows.forEach((row, i) => {
    if (!row.includes('|')) return; // ignora líneas que no son transacciones
    const parts = row.split('|').map((p) => p.trim());
    const fechaRaw = parts[0] || '';
    // Monto: entre los campos 1..N, el último (derecha→izquierda) que parezca número.
    let montoIdx = -1; let monto = null;
    for (let j = parts.length - 1; j >= 1; j--) {
      if (!pareceMonto(parts[j])) continue;
      const cand = parseMontoSigno(parts[j]);
      if (cand != null) { montoIdx = j; monto = cand; break; }
    }
    if (!fechaRaw || monto == null) { errores.push(`Línea ${i + 1}: falta fecha o monto ("${row.slice(0, 48)}")`); return; }
    const descripcion = parts.filter((_, k) => k !== 0 && k !== montoIdx).join(' ').trim() || null;
    lineas.push({
      fecha: normalizarFecha(fechaRaw),
      descripcion,
      monto,
      tipo: monto < 0 ? 'debito' : 'credito',
      referencia: null,
    });
  });
  return { lineas, errores };
}

/**
 * Estructura el texto de un extracto en líneas usando Claude.
 * `deps` permite inyectar callAnthropic en tests (sin red).
 * @returns {Promise<{lineas: Array, errores: string[]}>}
 */
export async function parseExtractoPdfText(texto, deps = {}) {
  const _call = deps.callAnthropic || callAnthropic;
  const clean = String(texto || '').trim();
  if (!clean) return { lineas: [], errores: ['Texto del extracto vacío'] };
  const raw = await _call({
    content: [{ type: 'text', text: `Texto del extracto bancario:\n\n${clean.slice(0, MAX_TEXT)}` }],
    system: SYSTEM,
    model: FAST_MODEL,
    maxTokens: MAX_OUT_TOKENS,
  });
  return parseDelimLineas(raw);
}
