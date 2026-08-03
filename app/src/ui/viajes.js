/**
 * ui/viajes.js — Sección Viajes de la PWA.
 *
 * Lista los viajes (activos y cerrados) y, al abrir uno, muestra el detalle de
 * sus gastos: totales por moneda, desglose por rubro, quién paga (iWin
 * reembolsable vs personal) y los movimientos. Los owners pueden sacar un
 * movimiento del viaje (des-etiquetar, sin anularlo). Fuente = Postgres.
 */

import { getViajes, getResumenViaje, sacarDeViaje, cerrarViaje } from '../services/finanzas.js';
import { currentUser } from '../services/auth.js';
import { formatMoneda } from '../utils/formatters.js';

const V = (id) => document.getElementById(id);
const ROLES_ESCRITURA = new Set(['owner', 'admin_financiero', 'tesoreria', 'contador']);
const esOwner = () => ROLES_ESCRITURA.has((currentUser() || {}).rol);

let _wired = false;
let _sel = null; // viaje_id abierto (detalle) o null (lista)

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const esEmpresa = (p) => /iwin|empresa|reembols/i.test(String(p || ''));

function listaHTML(viajes) {
  if (!viajes || !viajes.length) return '<div class="empty">Aún no hay viajes. Inícialos por SilvIA ("me voy de viaje a …").</div>';
  return viajes.map((v) => {
    const est = v.activo ? '<span class="vj-badge vj-badge-on">Activo</span>' : '<span class="vj-badge">Cerrado</span>';
    const tipo = v.tipo === 'personal' ? 'Personal/familiar' : 'Negocios';
    const fechas = [v.fecha_inicio, v.fecha_fin].filter(Boolean).map((d) => String(d).slice(0, 10)).join(' → ');
    return `<button class="vj-item" data-open="${v.id}">
      <div class="vj-item-l"><strong>${esc(v.nombre)}</strong>
        <span class="vj-item-sub">${tipo}${v.quien ? ' · ' + esc(v.quien) : ''}${fechas ? ' · ' + esc(fechas) : ''}</span></div>
      <div class="vj-item-r">${est}<span class="vj-chev">›</span></div>
    </button>`;
  }).join('');
}

function totalesHTML(porMoneda) {
  if (!porMoneda || !porMoneda.length) return '<div class="empty">Sin gastos aún.</div>';
  return `<div class="vj-chips">${porMoneda.map((m) =>
    `<span class="vj-chip">${formatMoneda(m.total, m.moneda)} <small>(${m.n})</small></span>`).join('')}</div>`;
}

function rubrosHTML(porCat) {
  if (!porCat || !porCat.length) return '';
  return porCat.map((r) => `<div class="vj-row"><span>${esc(r.categoria)}</span><span class="vj-amt">${formatMoneda(r.monto, r.moneda)}</span></div>`).join('');
}

function pagadorHTML(porPag) {
  if (!porPag || !porPag.length) return '';
  return porPag.map((p) => {
    const cls = esEmpresa(p.pagador) ? 'vj-tag-emp' : 'vj-tag-fam';
    return `<div class="vj-row"><span class="vj-tag ${cls}">${esc(p.pagador)}</span><span class="vj-amt">${formatMoneda(p.monto, p.moneda)}</span></div>`;
  }).join('');
}

function movsHTML(movs, owner) {
  if (!movs || !movs.length) return '<div class="empty">Sin movimientos.</div>';
  return movs.map((m) => {
    const cat = [m.categoria, m.subcategoria].filter(Boolean).join(' · ');
    const btn = owner ? `<button class="vj-sacar" data-sacar="${m.id}" title="Sacar del viaje">Sacar</button>` : '';
    return `<div class="vj-mov">
      <div class="vj-mov-l"><strong>${esc(m.descripcion || cat || 'Movimiento')}</strong>
        <span class="vj-item-sub">${esc(String(m.fecha || '').slice(0, 10))}${cat ? ' · ' + esc(cat) : ''}${m.metodo_pago ? ' · ' + esc(m.metodo_pago) : ''}</span></div>
      <div class="vj-mov-r"><span class="vj-amt">${formatMoneda(m.monto, m.moneda)}</span>${btn}</div>
    </div>`;
  }).join('');
}

async function cargarLista() {
  _sel = null;
  const cont = V('viajes-body');
  cont.innerHTML = '<div class="empty">Cargando…</div>';
  try {
    const r = await getViajes();
    cont.innerHTML = `<div class="card"><div class="card-ttl">Viajes</div>${listaHTML(r.viajes)}</div>`;
  } catch (e) {
    cont.innerHTML = `<div class="empty">No se pudo cargar: ${esc(e.message)}</div>`;
  }
}

async function cargarDetalle(id) {
  _sel = id;
  const cont = V('viajes-body');
  cont.innerHTML = '<div class="empty">Cargando…</div>';
  try {
    const r = await getResumenViaje(id);
    if (!r || !r.viaje) { cont.innerHTML = '<div class="empty">Viaje no encontrado.</div>'; return; }
    const v = r.viaje;
    const rubros = rubrosHTML(r.por_categoria);
    const pag = pagadorHTML(r.por_pagador);
    const cerrarBtn = (esOwner() && v.activo) ? `<button class="btn btn-s" data-cerrar="${v.id}" style="margin-top:8px">Cerrar viaje</button>` : '';
    cont.innerHTML = `
      <button class="btn btn-s" data-volver="1" style="margin-bottom:10px">← Todos los viajes</button>
      <div class="card">
        <div class="card-ttl">${esc(v.nombre)} ${v.activo ? '🧳' : '✓'}</div>
        <div class="vj-item-sub" style="margin-bottom:8px">${v.tipo === 'personal' ? 'Personal/familiar' : 'Negocios'}${v.quien ? ' · ' + esc(v.quien) : ''}</div>
        ${totalesHTML(r.por_moneda)}
        ${cerrarBtn}
      </div>
      ${rubros ? `<div class="card"><div class="card-ttl">Por rubro</div>${rubros}</div>` : ''}
      ${pag ? `<div class="card"><div class="card-ttl">Quién paga</div>${pag}</div>` : ''}
      <div class="card"><div class="card-ttl">Movimientos (${(r.movimientos || []).length})</div>${movsHTML(r.movimientos, esOwner())}</div>`;
  } catch (e) {
    cont.innerHTML = `<div class="empty">No se pudo cargar: ${esc(e.message)}</div>`;
  }
}

export function renderViajes() {
  if (!_wired) {
    _wired = true;
    V('viajes-body').addEventListener('click', async (e) => {
      const open = e.target.closest('[data-open]');
      if (open) { await cargarDetalle(Number(open.dataset.open)); return; }
      if (e.target.closest('[data-volver]')) { await cargarLista(); return; }
      const sacar = e.target.closest('[data-sacar]');
      if (sacar) {
        if (!confirm('¿Sacar este movimiento del viaje? Sigue registrado como gasto normal.')) return;
        try { await sacarDeViaje(Number(sacar.dataset.sacar)); await cargarDetalle(_sel); }
        catch (err) { alert('No se pudo: ' + err.message); }
        return;
      }
      const cerrar = e.target.closest('[data-cerrar]');
      if (cerrar) {
        if (!confirm('¿Cerrar este viaje? Dejará de etiquetar gastos nuevos.')) return;
        try { await cerrarViaje(Number(cerrar.dataset.cerrar)); await cargarDetalle(_sel); }
        catch (err) { alert('No se pudo: ' + err.message); }
      }
    });
  }
  cargarLista();
}
