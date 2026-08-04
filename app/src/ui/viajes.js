/**
 * ui/viajes.js — Sección Viajes de la PWA.
 *
 * Lista los viajes (activos y cerrados) y, al abrir uno, muestra el detalle de
 * sus gastos: totales por moneda, desglose por rubro, quién paga (iWin
 * reembolsable vs personal) y los movimientos. Se puede ver "Original" (cada
 * moneda por su lado) o convertido a COP / USD a la tasa del día. Los owners
 * pueden sacar un movimiento del viaje (des-etiquetar, sin anularlo).
 */

import { getViajes, getResumenViaje, getTasas, sacarDeViaje, cerrarViaje } from '../services/finanzas.js';
import { currentUser } from '../services/auth.js';
import { formatMoneda, convertirMoneda } from '../utils/formatters.js';

const V = (id) => document.getElementById(id);
const ROLES_ESCRITURA = new Set(['owner', 'admin_financiero', 'tesoreria', 'contador']);
const esOwner = () => ROLES_ESCRITURA.has((currentUser() || {}).rol);

let _wired = false;
let _sel = null;       // viaje_id abierto (detalle) o null (lista)
let _ver = 'orig';     // 'orig' | 'COP' | 'USD'
let _tasas = null;     // { rates, fecha } cacheado
let _resumen = null;   // último resumen cargado (para re-render sin refetch)
// Tasa USD→COP editable por el usuario (la TRM de la fuente puede diferir de la
// del mercado/oficial). Persiste en el dispositivo. Si está, manda sobre la fuente.
let _trm = Number(localStorage.getItem('dcdg_trm')) || null;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
const esEmpresa = (p) => /iwin|empresa|reembols/i.test(String(p || ''));

// Tasa USD→COP de la fuente (COP por 1 USD).
const trmFuente = () => (_tasas && _tasas.rates && _tasas.rates.COP) || null;
// Tasas efectivas: las de la fuente, pero con la TRM editada por el usuario si la puso.
function tasasEfectivas() {
  if (!_tasas || !_tasas.rates) return null;
  const r = { ..._tasas.rates };
  if (_trm > 0) r.COP = _trm;
  return r;
}
// Convierte a la vista actual; null si falta la tasa de esa moneda.
const conv = (monto, moneda) => convertirMoneda(monto, moneda, _ver, tasasEfectivas());

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

function segHTML() {
  const b = (val, txt) => `<button class="vj-seg-b${_ver === val ? ' on' : ''}" data-ver="${val}">${txt}</button>`;
  let extra = '';
  if (_ver !== 'orig' && _tasas) {
    const fuente = trmFuente();
    const val = Math.round(_trm > 0 ? _trm : (fuente || 0));
    const nota = _trm > 0
      ? `personalizada${fuente ? ` · fuente ${Math.round(fuente).toLocaleString('es-CO')}` : ''}`
      : `tasa del día${_tasas.fecha ? ' · ' + esc(String(_tasas.fecha).slice(0, 16)) : ''}`;
    extra = `<div class="vj-rate">
      <span>1 US$ = $</span>
      <input id="vj-trm" type="number" inputmode="numeric" step="1" min="1" value="${val}">
      <span>COP</span>
      ${_trm > 0 ? '<button class="vj-rate-reset" data-rate-reset title="Volver a la tasa de la fuente">↺</button>' : ''}
      <span class="vj-seg-note" style="margin:0">${nota}</span>
    </div>`;
  }
  return `<div class="vj-seg">${b('orig', 'Original')}${b('COP', 'En COP')}${b('USD', 'En USD')}</div>${extra}`;
}

// Totales: chips por moneda (orig) o un solo total convertido.
function totalesHTML(porMoneda) {
  if (!porMoneda || !porMoneda.length) return '<div class="empty">Sin gastos aún.</div>';
  if (_ver === 'orig') {
    return `<div class="vj-chips">${porMoneda.map((m) => `<span class="vj-chip">${formatMoneda(m.total, m.moneda)} <small>(${m.n})</small></span>`).join('')}</div>`;
  }
  let suma = 0; let n = 0; const faltan = [];
  porMoneda.forEach((m) => { const c = conv(m.total, m.moneda); if (c == null) faltan.push(m.moneda); else { suma += c; n += m.n; } });
  const nota = faltan.length ? `<div class="vj-seg-note">Sin tasa para: ${esc(faltan.join(', '))} (no incluidas)</div>` : '';
  return `<div class="vj-chips"><span class="vj-chip">${formatMoneda(suma, _ver)} <small>(${n})</small></span></div>${nota}`;
}

// Re-agrupa filas [{clave, moneda, monto}] a la vista actual (suma sobre monedas).
function agrupaConvertido(rows, claveField) {
  const map = new Map();
  const faltan = new Set();
  rows.forEach((r) => {
    const k = r[claveField] || '—';
    const c = conv(r.monto, r.moneda);
    if (c == null) { faltan.add(r.moneda); return; }
    map.set(k, (map.get(k) || 0) + c);
  });
  return { filas: [...map.entries()].sort((a, b) => b[1] - a[1]), faltan: [...faltan] };
}

function rubrosHTML(porCat) {
  if (!porCat || !porCat.length) return '';
  if (_ver === 'orig') {
    return porCat.map((r) => `<div class="vj-row"><span>${esc(r.categoria)}</span><span class="vj-amt">${formatMoneda(r.monto, r.moneda)}</span></div>`).join('');
  }
  const { filas, faltan } = agrupaConvertido(porCat, 'categoria');
  const nota = faltan.length ? `<div class="vj-seg-note">Sin tasa para: ${esc(faltan.join(', '))}</div>` : '';
  return filas.map(([cat, monto]) => `<div class="vj-row"><span>${esc(cat)}</span><span class="vj-amt">${formatMoneda(monto, _ver)}</span></div>`).join('') + nota;
}

function pagadorHTML(porPag) {
  if (!porPag || !porPag.length) return '';
  if (_ver === 'orig') {
    return porPag.map((p) => {
      const cls = esEmpresa(p.pagador) ? 'vj-tag-emp' : 'vj-tag-fam';
      return `<div class="vj-row"><span class="vj-tag ${cls}">${esc(p.pagador)}</span><span class="vj-amt">${formatMoneda(p.monto, p.moneda)}</span></div>`;
    }).join('');
  }
  const { filas } = agrupaConvertido(porPag, 'pagador');
  return filas.map(([pag, monto]) => {
    const cls = esEmpresa(pag) ? 'vj-tag-emp' : 'vj-tag-fam';
    return `<div class="vj-row"><span class="vj-tag ${cls}">${esc(pag)}</span><span class="vj-amt">${formatMoneda(monto, _ver)}</span></div>`;
  }).join('');
}

function movsHTML(movs, owner) {
  if (!movs || !movs.length) return '<div class="empty">Sin movimientos.</div>';
  return movs.map((m) => {
    const cat = [m.categoria, m.subcategoria].filter(Boolean).join(' · ');
    const btn = owner ? `<button class="vj-sacar" data-sacar="${m.id}" title="Sacar del viaje">Sacar</button>` : '';
    let amt = formatMoneda(m.monto, m.moneda);
    let orig = '';
    if (_ver !== 'orig' && String(m.moneda || 'COP').toUpperCase() !== _ver) {
      const c = conv(m.monto, m.moneda);
      if (c != null) { orig = `<span class="vj-orig">${amt}</span>`; amt = formatMoneda(c, _ver); }
    }
    return `<div class="vj-mov">
      <div class="vj-mov-l"><strong>${esc(m.descripcion || cat || 'Movimiento')}</strong>
        <span class="vj-item-sub">${esc(String(m.fecha || '').slice(0, 10))}${cat ? ' · ' + esc(cat) : ''}${m.metodo_pago ? ' · ' + esc(m.metodo_pago) : ''}</span></div>
      <div class="vj-mov-r">${orig}<span class="vj-amt">${amt}</span>${btn}</div>
    </div>`;
  }).join('');
}

function pintarDetalle() {
  const r = _resumen;
  if (!r || !r.viaje) { V('viajes-body').innerHTML = '<div class="empty">Viaje no encontrado.</div>'; return; }
  const v = r.viaje;
  const rubros = rubrosHTML(r.por_categoria);
  const pag = pagadorHTML(r.por_pagador);
  const cerrarBtn = (esOwner() && v.activo) ? `<button class="btn btn-s" data-cerrar="${v.id}" style="margin-top:8px">Cerrar viaje</button>` : '';
  V('viajes-body').innerHTML = `
    <button class="btn btn-s" data-volver="1" style="margin-bottom:10px">← Todos los viajes</button>
    <div class="card">
      <div class="card-ttl">${esc(v.nombre)} ${v.activo ? '🧳' : '✓'}</div>
      <div class="vj-item-sub" style="margin-bottom:8px">${v.tipo === 'personal' ? 'Personal/familiar' : 'Negocios'}${v.quien ? ' · ' + esc(v.quien) : ''}</div>
      ${segHTML()}
      ${totalesHTML(r.por_moneda)}
      ${cerrarBtn}
    </div>
    ${rubros ? `<div class="card"><div class="card-ttl">Por rubro</div>${rubros}</div>` : ''}
    ${pag ? `<div class="card"><div class="card-ttl">Quién paga</div>${pag}</div>` : ''}
    <div class="card"><div class="card-ttl">Movimientos (${(r.movimientos || []).length})</div>${movsHTML(r.movimientos, esOwner())}</div>`;
}

async function cargarLista() {
  _sel = null; _resumen = null;
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
  V('viajes-body').innerHTML = '<div class="empty">Cargando…</div>';
  try {
    _resumen = await getResumenViaje(id);
    pintarDetalle();
  } catch (e) {
    V('viajes-body').innerHTML = `<div class="empty">No se pudo cargar: ${esc(e.message)}</div>`;
  }
}

// Cambia la vista (orig/COP/USD); trae la tasa si hace falta y re-pinta.
async function cambiarVista(ver) {
  if (ver === _ver) return;
  if (ver !== 'orig' && !_tasas) {
    const btnBar = document.querySelector('.vj-seg');
    if (btnBar) btnBar.insertAdjacentHTML('afterend', '<div class="vj-seg-note" id="vj-tasa-cargando">Cargando tasa del día…</div>');
    try {
      const t = await getTasas();
      _tasas = { rates: t.rates, fecha: t.fecha };
    } catch (e) {
      const n = V('vj-tasa-cargando');
      if (n) n.textContent = 'No se pudo obtener la tasa del día: ' + e.message;
      return;
    }
  }
  _ver = ver;
  pintarDetalle();
}

export function renderViajes() {
  if (!_wired) {
    _wired = true;
    // Edición de la tasa USD→COP: recalcula todo con el valor que ponga el usuario.
    V('viajes-body').addEventListener('change', (e) => {
      if (e.target && e.target.id === 'vj-trm') {
        const v = Number(e.target.value);
        if (v > 0) { _trm = v; localStorage.setItem('dcdg_trm', String(v)); pintarDetalle(); }
      }
    });
    V('viajes-body').addEventListener('click', async (e) => {
      if (e.target.closest('[data-rate-reset]')) { _trm = null; localStorage.removeItem('dcdg_trm'); pintarDetalle(); return; }
      const ver = e.target.closest('[data-ver]');
      if (ver) { await cambiarVista(ver.dataset.ver); return; }
      const open = e.target.closest('[data-open]');
      if (open) { _ver = 'orig'; await cargarDetalle(Number(open.dataset.open)); return; }
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
  _ver = 'orig';
  cargarLista();
}
