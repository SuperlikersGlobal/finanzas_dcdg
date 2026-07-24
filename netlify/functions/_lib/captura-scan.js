/**
 * _lib/captura-scan.js — Orquestador del barrido de la bandeja: trae las
 * notificaciones bancarias por IMAP, las captura una a una (`capturarCorreo`) y
 * contabiliza los gastos registrados. Devuelve un "digest" con lo registrado,
 * lo pendiente (ingresos/transferencias que rutea la persona/SilvIA), y los
 * contadores de lo ya-existente / excluido / con error.
 *
 * Lo usan el cron horario (`captura-cron.js`) y el endpoint manual de backfill
 * (`/api/capturar-scan`). Todo es idempotente: releer un correo no duplica nada.
 *
 * Las dependencias pesadas (IMAP, contabilización) se inyectan para poder
 * probar la agregación con dobles sin tocar red ni base de datos.
 */
import { fetchCorreosBancarios } from './gmail-imap.js';
import { capturarCorreo } from './captura-correo.js';
import { contabilizarMovimiento } from './contabilizar.js';

function entradaRegistrado(r) {
  const tx = r.tx || {};
  return {
    fecha: r.fecha,
    categoria: r.categoria || null,
    subcategoria: r.subcategoria || null,
    monto_fmt: r.monto_fmt || null,
    comercio: tx.comercio || tx.destino || null,
    cuenta: tx.cuenta || null,
    dueno: tx.dueno || null,
    actualizado: !!r.actualizado,
  };
}

function entradaPendiente(r) {
  const tx = r.tx || {};
  return {
    clase: r.pendiente,
    monto: tx.monto,
    moneda: tx.moneda || 'COP',
    cuenta: tx.cuenta || null,
    dueno: tx.dueno || null,
    remitente: tx.remitente || null,
    destino: tx.destino || null,
    fecha: tx.fecha || null,
    ahinoa: !!tx.ahinoa,
  };
}

/**
 * Barre la bandeja desde `since` y captura cada correo. Devuelve el digest.
 * @param {object} opts
 * @param {Date}   opts.since          desde cuándo traer (granularidad de día).
 * @param {func}   [opts.fetcher]      trae los correos (inyectable en tests).
 * @param {func}   [opts.capturar]     captura un correo (inyectable en tests).
 * @param {func}   [opts.contabilizar] contabiliza un movimiento por id (idem).
 */
export async function escanearBandeja({
  since,
  fetcher = fetchCorreosBancarios,
  capturar = capturarCorreo,
  contabilizar = contabilizarMovimiento,
} = {}) {
  const correos = await fetcher({ since });
  const digest = {
    total: correos.length,
    registrados: [],
    pendientes: [],
    yaExistian: 0,
    excluidos: 0,
    errores: [],
  };

  for (const c of correos) {
    try {
      const r = await capturar(c);
      if (r.registrado) {
        if (r.id) {
          // Contabilización best-effort: nunca tumba el barrido.
          try { await contabilizar(r.id); }
          catch (e) { console.error('[captura-scan] contabilizar', r.id, e.message); }
        }
        digest.registrados.push(entradaRegistrado(r));
      } else if (r.pendiente) {
        digest.pendientes.push(entradaPendiente(r));
      } else if (r.ya_existia) {
        digest.yaExistian++;
      } else {
        // skip del parser (ruido/iWin/seguridad), motivo de negocio o posible duplicado.
        digest.excluidos++;
      }
    } catch (e) {
      digest.errores.push({ message_id: c.message_id, error: e.message });
    }
  }
  return digest;
}

/** Versión compacta del digest para logs. */
export function resumirDigest(d) {
  return {
    total: d.total,
    registrados: d.registrados.length,
    pendientes: d.pendientes.length,
    yaExistian: d.yaExistian,
    excluidos: d.excluidos,
    errores: d.errores.length,
  };
}

const fmtMonto = (m, moneda = 'COP') =>
  m == null ? '' : `${moneda === 'USD' ? 'US$' : '$'}${Number(m).toLocaleString('es-CO')}`;

/** Texto legible del digest (para el aviso por WhatsApp / push). */
export function digestTexto(d) {
  const L = [`📥 Captura por correo — ${d.total} correo(s)`];

  if (d.registrados.length) {
    L.push('', `✅ Registrados (${d.registrados.length}):`);
    for (const r of d.registrados) {
      const cat = [r.categoria, r.subcategoria].filter(Boolean).join('/');
      const cta = r.cuenta ? ` *${r.cuenta}` : '';
      L.push(`  · ${r.fecha || ''} ${cat} ${r.monto_fmt || ''} — ${r.comercio || ''}${cta}${r.actualizado ? ' (actualizado)' : ''}`);
    }
  }

  if (d.pendientes.length) {
    L.push('', `🟡 Pendientes de confirmar (${d.pendientes.length}):`);
    for (const p of d.pendientes) {
      const cta = p.cuenta ? ` *${p.cuenta}` : '';
      const quien = p.remitente || p.destino || p.dueno || '';
      const nota = p.ahinoa ? ' (Ahinoa)' : '';
      L.push(`  · [${p.clase}] ${fmtMonto(p.monto, p.moneda)}${cta} ${quien}${nota} ${p.fecha || ''}`.replace(/\s+/g, ' ').trimEnd());
    }
  }

  const cola = [];
  if (d.yaExistian) cola.push(`↺ ya estaban: ${d.yaExistian}`);
  if (d.excluidos) cola.push(`excluidos: ${d.excluidos}`);
  if (d.errores.length) cola.push(`errores: ${d.errores.length}`);
  if (cola.length) L.push('', cola.join(' · '));

  return L.join('\n');
}
