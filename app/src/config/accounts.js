/**
 * config/accounts.js — Mapa de cuentas y tarjetas DCDG (sección 5 del doc).
 *
 * La fuente única de verdad en producción es la hoja `⚙️ CUENTAS` del Sheet.
 * Este mapa es un espejo local para resolver tarjeta→cuenta sin round-trip,
 * validar entradas y alimentar prompts. Manténlo sincronizado con la hoja.
 *
 * Módulo puro: reutilizable en PWA, Functions y tests.
 */

/**
 * @typedef {Object} Cuenta
 * @property {string} nombre        Nombre canónico de la cuenta (= Método de pago en Sheet)
 * @property {string} banco
 * @property {string} titular       Luis | Carolina | Familia | ...
 * @property {'COP'|'USD'} moneda
 * @property {string} tipo          Débito | Crédito personal | Crédito corporativo | Nequi | USD | Efectivo
 * @property {string[]} tarjetas    últimos 4 dígitos asociados
 * @property {string} cc            Centro de costo / núcleo
 */

/** @type {Cuenta[]} */
export const CUENTAS = [
  { nombre: 'Bcol 0965', banco: 'Bancolombia', titular: 'Luis', moneda: 'COP', tipo: 'Débito', tarjetas: ['2331'], cc: 'LADCC' },
  { nombre: 'Bcol 3355', banco: 'Bancolombia', titular: 'Luis', moneda: 'COP', tipo: 'Débito', tarjetas: ['6940'], cc: 'LADCC' },
  { nombre: 'Bcol 4549', banco: 'Bancolombia', titular: 'Carolina', moneda: 'COP', tipo: 'Débito', tarjetas: ['5773'], cc: 'LADCC' },
  { nombre: 'Bcol 3164', banco: 'Bancolombia', titular: 'Carolina', moneda: 'COP', tipo: 'Débito', tarjetas: ['4550'], cc: 'CMDG-Sebas' },
  { nombre: 'Bcol 5688', banco: 'Bancolombia', titular: 'Carolina', moneda: 'COP', tipo: 'Débito', tarjetas: ['1360'], cc: 'Ahinoa' },
  { nombre: 'TC iWin (Superlikers)', banco: 'Jeeves', titular: 'Superlikers', moneda: 'USD', tipo: 'Crédito corporativo', tarjetas: [], cc: 'LADCC' },
  { nombre: 'Nequi Luis', banco: 'Nequi', titular: 'Luis', moneda: 'COP', tipo: 'Nequi-Billetera', tarjetas: [], cc: 'LADCC' },
  { nombre: 'Nequi Carolina', banco: 'Nequi', titular: 'Carolina', moneda: 'COP', tipo: 'Nequi-Billetera', tarjetas: [], cc: 'CMDG' },
  { nombre: 'Mercury Delca2 (7730)', banco: 'Mercury', titular: 'Delca2 LLC (Luis/Carolina)', moneda: 'USD', tipo: 'Cuenta USD', tarjetas: ['7730'], cc: 'Delca2', cuenta: '202508119164' },
  { nombre: 'DollarApp', banco: 'DollarApp', titular: 'Luis', moneda: 'USD', tipo: 'Cuenta USD', tarjetas: [], cc: 'LADCC' },
];

/** Índice tarjeta(4 dígitos) → cuenta. */
const TARJETA_INDEX = (() => {
  const idx = new Map();
  for (const c of CUENTAS) for (const t of c.tarjetas) idx.set(t, c);
  return idx;
})();

/** Resuelve una cuenta a partir de los últimos 4 dígitos de la tarjeta. */
export function cuentaPorTarjeta(ultimos4) {
  if (!ultimos4) return null;
  return TARJETA_INDEX.get(String(ultimos4).trim()) || null;
}

/** Resuelve una cuenta por su nombre canónico (case-insensitive). */
export function cuentaPorNombre(nombre) {
  if (!nombre) return null;
  const n = String(nombre).toLowerCase().trim();
  return CUENTAS.find((c) => c.nombre.toLowerCase() === n) || null;
}

/**
 * Infiere la MONEDA ('USD' | 'COP') de la cuenta/tarjeta usada, para no marcar
 * como COP una compra pagada con una cuenta en dólares (Mercury Delca2 7730,
 * DollarApp, TC iWin) cuando el llamador no manda `moneda` explícita. Devuelve
 * null si no se puede determinar (el llamador cae a su default).
 */
export function monedaDeCuenta({ metodo_pago, tarjeta_ultimos4 } = {}) {
  // 1) Por últimos 4 explícitos de la tarjeta.
  const t = tarjeta_ultimos4 ? String(tarjeta_ultimos4).replace(/\D/g, '').slice(-4) : '';
  if (t) {
    const c = cuentaPorTarjeta(t);
    if (c && c.moneda) return c.moneda;
  }
  const s = String(metodo_pago || '').trim();
  if (s) {
    // 2) Por nombre canónico de cuenta.
    const porNombre = cuentaPorNombre(s);
    if (porNombre && porNombre.moneda) return porNombre.moneda;
    // 3) Por 4 dígitos embebidos en el texto (p. ej. "TC 7730 Delca2").
    const m = s.match(/\d{4}/);
    if (m) {
      const c = cuentaPorTarjeta(m[0]);
      if (c && c.moneda) return c.moneda;
    }
    // 4) Por palabras clave de cuentas USD (última red de seguridad).
    if (/delca2|mercury|dollarapp|dolar\s*app|jeeves|superlikers|corporativ/i.test(s)) return 'USD';
  }
  return null;
}

/** Lista de nombres de cuentas activas (para selects y prompts). */
export const NOMBRES_CUENTAS = CUENTAS.map((c) => c.nombre);

/** Personas que pueden figurar como "quién pagó". */
export const PERSONAS = ['Luis', 'Carolina'];

// ─────────────────────────────────────────────────────────────
// Compatibilidad con el monolito: nombres largos de método de pago
// (los mismos que usan el EmailBot y el prompt DCDG). Se usan en la PWA
// para el select de método de pago y la resolución tarjeta→cuenta.
// ─────────────────────────────────────────────────────────────

/** Mapa últimos 4 de tarjeta → nombre largo de cuenta (portado del monolito). */
export const TARJETAS_MAP = {
  '2331': 'Bcol Aho 0965 · Débito 2331 (Luis)',
  '6940': 'Bcol Aho 3355 · Débito 6940 (Luis)',
  '5773': 'Bcol Aho 4549 · Débito 5773 (Luis/DCDG)',
  '4550': 'Bcol Aho 3164 · Débito 4550 (Carolina)',
  '1360': 'Bcol Aho 5688 · Débito 1360 (Ahinoa)',
  '7730': 'Mercury Delca2 (7730)',
};

/**
 * Cuentas cargadas dinámicamente desde ⚙️ CUENTAS (estado mutable de la PWA).
 * Cada item: { name, banco, titular, moneda, tipo, tipoEspecial, activa, tarjeta }.
 */
let _cuentasDinamicas = [];

/** Reemplaza las cuentas dinámicas y enriquece TARJETAS_MAP con sus tarjetas. */
export function setCuentasDinamicas(lista) {
  _cuentasDinamicas = Array.isArray(lista) ? lista : [];
  for (const c of _cuentasDinamicas) {
    const t = String(c.tarjeta || '').trim();
    if (t && t !== '—' && t.length === 4) TARJETAS_MAP[t] = c.name;
  }
  return _cuentasDinamicas;
}

/** Devuelve las cuentas dinámicas actuales. */
export function getCuentasDinamicas() {
  return _cuentasDinamicas;
}

/**
 * Resuelve el nombre de cuenta a partir de los últimos 4 dígitos.
 * Portado de `resolveCard`: primero cuentas dinámicas, luego el mapa estático.
 */
export function resolveCard(digits) {
  const d = String(digits || '').trim();
  if (d.length !== 4) return null;
  for (const c of _cuentasDinamicas) {
    if (c.name && c.name.includes(d)) return c.name;
  }
  return TARJETAS_MAP[d] || null;
}

/**
 * ¿El nombre de cuenta corresponde a la tarjeta corporativa iWin?
 * Portado de `isIwinAccount`: primero por tipoEspecial en cuentas dinámicas,
 * luego por keywords en el nombre.
 */
export function isIwinAccount(accountName) {
  const acct = _cuentasDinamicas.find((c) => c.name === accountName);
  if (acct) return acct.tipoEspecial === 'iWin-Adelanto';
  const n = String(accountName || '').toLowerCase();
  return n.includes('iwin') || n.includes('jeeves') || n.includes('corporativo') || n.includes('superlikers');
}
