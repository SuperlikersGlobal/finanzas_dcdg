/**
 * ui/cierre.js — Cierre mensual (issue #92, T12b, sub-issue de #52).
 *
 * SENSIBLE: cerrar un periodo congela sus asientos — `crearAsiento` rechaza
 * después cualquier fecha dentro de ese mes (los ajustes van con fecha del
 * mes siguiente). Por eso pide confirmación explícita antes de llamar al
 * backend, además del gate de "solo owners" del servidor.
 */

import { getPeriodosCerrados, cerrarPeriodo } from '../services/finanzas.js';

const V = (id) => document.getElementById(id);
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

let _wired = false;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function filaPeriodoHTML(p) {
  const mes = MESES[Number(p.mes) - 1] || p.mes;
  return `<div class="h-item"><div class="h-name">🔒 ${esc(mes)} ${esc(p.anio)}</div></div>`;
}

async function cargar() {
  try {
    const r = await getPeriodosCerrados();
    const periodos = r.periodos || [];
    V('cierre-lista').innerHTML = periodos.length ? periodos.map(filaPeriodoHTML).join('') : '<div class="empty">Sin periodos cerrados</div>';
  } catch (e) {
    V('cierre-lista').innerHTML = `<div class="empty" style="color:var(--red)">Error: ${esc(e.message)}</div>`;
  }
}

async function cerrar() {
  const msg = V('cierre-msg');
  const anio = Number(V('cierre-anio').value);
  const mes = Number(V('cierre-mes').value);
  if (!anio || !mes) { msg.textContent = 'Elige año y mes.'; msg.style.color = 'var(--red)'; return; }
  const etiqueta = `${MESES[mes - 1]} ${anio}`;
  if (!confirm(`¿Cerrar ${etiqueta}? Después de cerrarlo no se podrán registrar ni ajustar asientos con fecha en ese mes — los ajustes van con fecha del mes siguiente. Esta acción no se deshace desde la PWA.`)) {
    return;
  }
  msg.textContent = 'Cerrando…'; msg.style.color = 'var(--gray-d)';
  try {
    const r = await cerrarPeriodo({ anio, mes });
    msg.textContent = r.periodo.ya_estaba_cerrado ? `${etiqueta} ya estaba cerrado.` : `✓ ${etiqueta} cerrado.`;
    msg.style.color = 'var(--green)';
    await cargar();
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? (e.message || 'Solo Luis o Carolina pueden cerrar un periodo.')
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
  }
}

/** Llamado por main.js al navegar a la pantalla de Cierre mensual. */
export async function renderCierre() {
  await cargar();
  if (!_wired) {
    _wired = true;
    V('scr-cierre').addEventListener('click', (e) => {
      if (e.target.closest('[data-act="cerrarPeriodo"]')) cerrar();
    });
  }
}
