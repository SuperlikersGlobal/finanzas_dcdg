/**
 * _lib/silvia-preguntar.js — Pieza 4: pregunta por WhatsApp (vía SilvIA) los
 * movimientos que la captura no puede clasificar sola.
 *
 * El cron de captura detecta un pendiente "preguntable" (v1: transferencias
 * salientes, que pueden ser gasto, préstamo o traslado) y le pregunta a la
 * **persona dueña de la cuenta**: cuenta de Carolina → se le pregunta a Carolina;
 * cuenta de Luis → a Luis. SilvIA ya tiene las tools (`registrar_gasto`,
 * `registrar_transferencia`) para registrar la respuesta.
 *
 * Best-effort: nunca lanza ni bloquea la captura. Idempotente por message-id
 * (SilvIA no re-pregunta lo mismo aunque el cron corra cada hora).
 */
import { env } from './env.js';

// Cuentas de Carolina (a ella se le pregunta por sus movimientos).
const CUENTAS_CARO = new Set(['5688', '4550', '3164', '9354']);

/** ¿A quién se le pregunta por este movimiento? (dueño de la cuenta). */
export function aQuienPreguntar(tx = {}) {
  if (tx.dueno === 'Carolina') return { username: 'carodz2@gmail.com', nombre: 'Carolina' };
  if (tx.dueno === 'Luis') return { username: 'luis@iwin.im', nombre: 'Luis' };
  if (tx.cuenta && CUENTAS_CARO.has(tx.cuenta)) return { username: 'carodz2@gmail.com', nombre: 'Carolina' };
  return { username: 'luis@iwin.im', nombre: 'Luis' }; // por defecto, Luis
}

/**
 * ¿Este pendiente amerita preguntar? v1: solo transferencias (SilvIA tiene tools
 * para resolverlas). Ingresos (necesitan carril de ingreso Ahinoa) y gastos por
 * QR sin comercio (necesitan recategorizar el ya-registrado) son fast-follows.
 */
export function esPreguntable(p = {}) {
  return p.clase === 'transferencia';
}

/** Pregunta un movimiento no identificado vía SilvIA. Nunca lanza. */
export async function preguntarSilvia({ transaccion, preguntarA, idempotency_key } = {}) {
  const url = env('SILVIA_FINANZAS_PREGUNTA_URL', null);
  const secret = env('SILVIA_FINANZAS_PREGUNTA_SECRET', null) || env('AUTOBUILD_NOTIFY_SECRET', null);
  if (!url || !secret) return { enviado: false, motivo: 'SILVIA_FINANZAS_PREGUNTA_URL/SECRET no configurados.' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-finanzas-secret': secret, 'content-type': 'application/json' },
      body: JSON.stringify({ transaccion, preguntarA, idempotency_key }),
    });
    if (!res.ok) return { enviado: false, motivo: `SilvIA respondió ${res.status}` };
    return { enviado: true };
  } catch (e) {
    return { enviado: false, motivo: e.message };
  }
}

/**
 * Recorre los pendientes y pregunta por los "preguntables" a la persona dueña.
 * `preguntar` es inyectable para tests. Devuelve contadores.
 */
export async function preguntarPendientes(pendientes = [], { preguntar = preguntarSilvia } = {}) {
  const res = { preguntados: 0, omitidos: 0, fallidos: 0 };
  for (const p of pendientes) {
    if (!esPreguntable(p)) { res.omitidos++; continue; }
    const r = await preguntar({
      transaccion: p,
      preguntarA: aQuienPreguntar(p),
      idempotency_key: p.message_id ? `email:${p.message_id}` : undefined,
    });
    if (r && r.enviado) res.preguntados++; else res.fallidos++;
  }
  return res;
}
