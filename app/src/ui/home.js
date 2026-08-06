/**
 * ui/home.js — Home (tablero) · rediseño 1a "Tablero de tarjetas".
 *
 * Cambios frente a la versión anterior:
 *  · avisa de los pagos vencidos arriba, con monto, y alimenta el contador
 *    de la pestaña Pagos (y de la barra lateral);
 *  · la cifra de "falta pagar" es la principal y lleva barra de avance;
 *  · los saldos de bancos pasan a tarjeta secundaria.
 *
 * Los datos vienen de los mismos servicios; nada de la API cambia. Los
 * campos que puede no traer el resumen (total_vencido, n_pagados, n_total)
 * se leen a la defensiva: si faltan, la barra de avance simplemente no sale.
 */

import { getComprobacion, getPagosDelMes, getResumen } from '../services/finanzas.js';
import { formatCOP } from '../utils/formatters.js';
import { periodRange, periodRangeAnterior, variacionHTML } from './dashboard.js';

const V = (id) => document.getElementById(id);

// Cuentas "hoja" de bancos/efectivo del plan de cuentas (clase 1). Las de CxC
// (1305/1310/1315) no son saldo bancario, se excluyen a propósito.
const CUENTAS_BANCO = ['1105', '1110'];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function show(id, on) {
  const el = V(id);
  if (el) el.style.display = on ? '' : 'none';
}

/** Contador de vencidos en la tab bar y en la barra lateral. */
function setVencidos(n) {
  ['tab-badge', 'rail-badge'].forEach((id) => {
    const el = V(id);
    if (!el) return;
    el.textContent = n;
    el.style.display = n ? '' : 'none';
  });
}

function saldosHTML(cuentas) {
  const bancos = (cuentas || []).filter((c) => CUENTAS_BANCO.includes(c.codigo));
  if (!bancos.length) {
    return `<div class="empty">Aún sin saldo de apertura.</div>
      <button class="chip chip-up" data-go="apertura" style="border:none;cursor:pointer;margin-top:10px">Montar apertura →</button>`;
  }
  const total = bancos.reduce((s, c) => s + (Number(c.saldo) || 0), 0);
  const filas = bancos.map((c) => `<div class="h-item">
    <div class="h-name">${esc(c.nombre)}</div><div class="h-amt">${formatCOP(c.saldo)}</div>
  </div>`).join('');
  return `${filas}<div class="h-item" style="border-top:1.5px solid var(--border-2)">
    <div class="h-name">Total</div><div class="h-amt">${formatCOP(total)}</div>
  </div>`;
}

function pagosMesHTML(resumen) {
  if (!resumen) return '<div class="empty">Sin datos</div>';
  return `<div class="num-hero">${formatCOP(resumen.total_pendiente)}</div>`;
}

/** Aviso de vencidos + barra de avance del mes. */
function pintarEstadoMes(resumen, pendientes) {
  const vencidos = Number(resumen && resumen.n_vencidos) || 0;
  setVencidos(vencidos);

  if (vencidos) {
    V('home-alerta-txt').textContent = `${vencidos} pago${vencidos === 1 ? '' : 's'} vencido${vencidos === 1 ? '' : 's'}`;
    const monto = Number(resumen.total_vencido) || (pendientes || [])
      .filter((p) => p.vencido)
      .reduce((s, p) => s + (Number(p.monto) || 0), 0);
    V('home-alerta-monto').textContent = monto ? `${formatCOP(monto)} sin pagar` : '';
    show('home-alerta', true);
  } else {
    show('home-alerta', false);
  }

  const pagados = Number(resumen && resumen.n_pagados);
  const total = Number(resumen && (resumen.n_total || resumen.n_pagos));
  if (Number.isFinite(pagados) && Number.isFinite(total) && total > 0) {
    const pct = Math.round((pagados / total) * 100);
    V('home-prog').firstElementChild.style.width = `${pct}%`;
    V('home-prog-txt').textContent = `${pagados} de ${total} pagos hechos`;
    V('home-prog-pct').textContent = `${pct} %`;
    show('home-prog', true);
    show('home-prog-lbl', true);
  } else {
    show('home-prog', false);
    show('home-prog-lbl', false);
  }
}

function pagosAnterioresHTML(pendientes) {
  const n = (pendientes || []).length;
  if (!n) return '';
  const total = pendientes.reduce((s, p) => s + (Number(p.monto) || 0), 0);
  return `<div class="h-item" data-go="pagos" style="cursor:pointer">
    <div><div class="h-name">${n} pago${n === 1 ? '' : 's'} sin marcar pagado</div>
      <div class="h-meta">Del mes anterior</div></div>
    <div style="display:flex;align-items:center;gap:10px">
      <div class="h-amt">${formatCOP(total)}</div>
      <svg class="ico ico-sm" style="color:var(--muted)"><use href="#i-chevron"></use></svg>
    </div>
  </div>`;
}

async function cargarSaldosYPagos() {
  try {
    const [comp, pagos] = await Promise.all([getComprobacion({}), getPagosDelMes({})]);
    V('home-saldos').innerHTML = saldosHTML(comp.cuentas);
    V('home-pagos-mes').innerHTML = pagosMesHTML(pagos.resumen);
    pintarEstadoMes(pagos.resumen, pagos.pendientes);

    const antHtml = pagosAnterioresHTML(pagos.pendientes_mes_anterior);
    show('home-pagos-ant-card', !!antHtml);
    if (antHtml) V('home-pagos-ant').innerHTML = antHtml;
  } catch (e) {
    const msg = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (Luis o Carolina) para ver el tablero.'
      : (e.message || 'No se pudo cargar el tablero.');
    V('home-saldos').innerHTML = `<div class="empty" style="color:var(--alert)">${esc(msg)}</div>`;
    V('home-pagos-mes').innerHTML = '<div class="empty">—</div>';
    show('home-alerta', false);
    show('home-prog', false);
    show('home-prog-lbl', false);
    show('home-pagos-ant-card', false);
    setVencidos(0);
  }
}

async function cargarComparativo() {
  try {
    const { desde, hasta, label } = periodRange('mes');
    const anterior = periodRangeAnterior('mes');
    const [res, resAnterior] = await Promise.all([
      getResumen({ periodo: `${desde}..${hasta}` }),
      getResumen({ periodo: `${anterior.desde}..${anterior.hasta}` }),
    ]);
    const total = Number(res.total) || 0;
    const totalAnterior = Number(resAnterior.total) || 0;
    const varHtml = variacionHTML(total, totalAnterior, { sufijo: ` vs. ${esc(anterior.label)}` });
    V('home-comparativo').innerHTML = `<div class="num">${esc(res.total_fmt || formatCOP(total))}</div>
      <div class="meta" style="margin-top:4px">${esc(label)}</div>
      <div style="margin-top:10px">${varHtml}</div>`;
  } catch (_) {
    V('home-comparativo').innerHTML = '<div class="empty">Sin datos</div>';
  }
}

/** Llamado por main.js al navegar (o abrir) el Home. */
export function renderHome() {
  V('home-saldos').innerHTML = '<div class="empty">Cargando…</div>';
  V('home-pagos-mes').innerHTML = '<div class="empty">Cargando…</div>';
  V('home-comparativo').innerHTML = '<div class="empty">Cargando…</div>';
  cargarSaldosYPagos();
  cargarComparativo();
}
