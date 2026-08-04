/**
 * utils/formatters.js — Formateadores de moneda, fechas y montos DCDG.
 * Módulo puro (testeable con node --test).
 */

/** Formatea un número como pesos colombianos: 45000 → "$45.000". */
export function formatCOP(n) {
  const num = Number(n) || 0;
  return '$' + Math.round(num).toLocaleString('es-CO');
}

/**
 * Formatea un monto según su moneda: COP → "$45.000"; USD → "US$ 3,899";
 * cualquier otra (MXN, NIO, EUR…) muestra su código ISO → "MXN 3,907" para no
 * confundirla con pesos colombianos.
 */
export function formatMoneda(n, moneda) {
  const m = String(moneda || 'COP').toUpperCase();
  if (m === 'COP') return formatCOP(n);
  const num = (Number(n) || 0).toLocaleString('en-US');
  return m === 'USD' ? `US$ ${num}` : `${m} ${num}`;
}

/**
 * Parsea montos escritos por humanos a número.
 * Soporta: "45.000", "45,000", "$120.000", "120mil", "1.2M", "45k".
 * @returns {number|null}
 */
export function parseMonto(input) {
  if (input == null) return null;
  if (typeof input === 'number') return input;
  let s = String(input).toLowerCase().trim().replace(/\$/g, '').replace(/\s/g, '');
  if (!s) return null;

  // Sufijos: mil / k / m (millón)
  const mult = /(\d+(?:[.,]\d+)?)(mil|k|m|millon|millones)$/.exec(s);
  if (mult) {
    const base = parseFloat(mult[1].replace(',', '.'));
    const factor = mult[2] === 'k' || mult[2] === 'mil' ? 1_000 : 1_000_000;
    return Math.round(base * factor);
  }

  // Miles con punto y decimales con coma (formato CO): "1.234.567,89"
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
    return Math.round(parseFloat(s));
  }
  // Miles con coma (formato US): "1,234,567"
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    s = s.replace(/,/g, '');
    return Math.round(parseFloat(s));
  }
  // Número simple
  const n = parseFloat(s.replace(',', '.'));
  return Number.isNaN(n) ? null : Math.round(n);
}

/** Fecha de hoy en formato YYYY-MM-DD (zona local). */
export function hoyISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Normaliza una fecha (Date | 'YYYY-MM-DD' | 'DD/MM' ) a YYYY-MM-DD. */
export function normalizarFecha(input, anioRef = new Date().getFullYear()) {
  if (!input) return hoyISO();
  if (input instanceof Date) return hoyISO(input);
  const s = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dm = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s);
  if (dm) {
    const d = dm[1].padStart(2, '0');
    const m = dm[2].padStart(2, '0');
    let y = dm[3] || String(anioRef);
    if (y.length === 2) y = '20' + y;
    return `${y}-${m}-${d}`;
  }
  return hoyISO();
}

/**
 * Corrige un "año off-by-one" en fechas de recibos SIN año explícito: si un
 * comercio dice "27 de jul" y el lector (SilvIA) infiere mal el año, la fecha
 * cae ~1 año en el pasado (p. ej. 2025-07-27 registrado el 2026-07-28). Solo se
 * corrige la ventana estrecha ~1 año atrás cuya versión +1 año NO queda en el
 * futuro; una compra genuinamente vieja (varios meses) NO se toca.
 */
export function corregirAnioProbable(iso, hoy = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return iso;
  const DIA = 86400000;
  const f = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const hoyUTC = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const diasAtras = (hoyUTC - f) / DIA;
  if (diasAtras >= 300 && diasAtras <= 430) {
    const masUno = Date.UTC(Number(m[1]) + 1, Number(m[2]) - 1, Number(m[3]));
    if (masUno <= hoyUTC + 2 * DIA) return `${Number(m[1]) + 1}-${m[2]}-${m[3]}`;
  }
  return iso;
}

/** Extrae el número de mes (1-12) de una fecha ISO. */
export function mesDeISO(iso) {
  const m = /^\d{4}-(\d{2})-\d{2}$/.exec(String(iso || ''));
  return m ? Number(m[1]) : new Date().getMonth() + 1;
}

/** Últimos 4 dígitos de una tarjeta a partir de texto libre. */
export function ultimos4(input) {
  const m = /(\d{4})\D*$/.exec(String(input || '').replace(/\s/g, ''));
  return m ? m[1] : '';
}
