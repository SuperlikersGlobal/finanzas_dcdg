/**
 * ui/tarjeta.js — Uso de la tarjeta Jeeves/iWin.
 *
 * Muestra en qué se ha usado la tarjeta Jeeves de iWin, separando lo
 * FAMILIAR/personal (adelanto de honorarios, cuenta en el presupuesto) de lo de
 * la EMPRESA/iWin (costo de iWin: se rastrea pero no cuenta en el presupuesto
 * familiar), por rubro y por moneda. Fuente de verdad = Postgres (vía backend).
 */

import { getUsoTarjeta } from '../services/finanzas.js';
import { formatMoneda } from '../utils/formatters.js';

const V = (id) => document.getElementById(id);

let _wired = false;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const esEmpresa = (b) => /empresa|iwin/i.test(String(b || ''));

/** Suma por (beneficiario, moneda) → chips de total. */
function totalesHTML(porBenef) {
  if (!porBenef || !porBenef.length) return '<div class="empty">Sin movimientos con la tarjeta Jeeves en el rango.</div>';
  const fam = porBenef.filter((r) => !esEmpresa(r.beneficiario));
  const emp = porBenef.filter((r) => esEmpresa(r.beneficiario));
  const bloque = (titulo, filas, color) => {
    if (!filas.length) return '';
    const chips = filas.map((r) => `<span class="uso-chip">${formatMoneda(r.monto, r.moneda)} <small>(${r.n})</small></span>`).join('');
    return `<div class="uso-benef"><div class="uso-benef-ttl" style="color:${color}">${titulo}</div><div class="uso-chips">${chips}</div></div>`;
  };
  return bloque('Familia (personal · adelanto)', fam, 'var(--brand, #2E5FA3)')
       + bloque('Empresa (iWin · no cuenta en presupuesto)', emp, '#0F6E56');
}

/** Desglose por rubro, agrupado por beneficiario. */
function categoriasHTML(porCat) {
  if (!porCat || !porCat.length) return '';
  const fam = porCat.filter((r) => !esEmpresa(r.beneficiario));
  const emp = porCat.filter((r) => esEmpresa(r.beneficiario));
  const fila = (r) => `<div class="uso-row"><span>${esc(r.categoria)}</span><span class="uso-amt">${formatMoneda(r.monto, r.moneda)}</span></div>`;
  const grupo = (titulo, filas) => filas.length
    ? `<div class="uso-cat-ttl">${titulo}</div>${filas.map(fila).join('')}` : '';
  return grupo('Familia', fam) + grupo('Empresa (iWin)', emp);
}

function itemsHTML(movs) {
  if (!movs || !movs.length) return '';
  return movs.map((m) => {
    const tag = esEmpresa(m.beneficiario)
      ? '<span class="uso-tag uso-tag-emp">iWin</span>'
      : '<span class="uso-tag uso-tag-fam">Familia</span>';
    const cat = [m.categoria, m.subcategoria].filter(Boolean).join(' · ');
    return `<div class="uso-item">
      <div class="uso-item-l"><strong>${esc(m.descripcion || cat || 'Movimiento')}</strong>
        <span class="uso-item-sub">${esc(m.fecha || '')}${cat ? ' · ' + esc(cat) : ''}</span></div>
      <div class="uso-item-r">${tag}<span class="uso-amt">${formatMoneda(m.monto, m.moneda)}</span></div>
    </div>`;
  }).join('');
}

async function cargar() {
  const desde = (V('uso-desde') || {}).value || '';
  const hasta = (V('uso-hasta') || {}).value || '';
  const cont = V('uso-body');
  cont.innerHTML = '<div class="empty">Cargando…</div>';
  try {
    const r = await getUsoTarjeta({ desde, hasta });
    const totales = totalesHTML(r.por_beneficiario);
    const cats = categoriasHTML(r.por_categoria);
    const items = itemsHTML(r.movimientos);
    cont.innerHTML = `
      <div class="card"><div class="card-ttl">Total por beneficiario</div>${totales}</div>
      ${cats ? `<div class="card"><div class="card-ttl">Por rubro</div>${cats}</div>` : ''}
      ${items ? `<div class="card"><div class="card-ttl">Movimientos (${r.movimientos.length})</div>${items}</div>` : ''}`;
  } catch (e) {
    cont.innerHTML = `<div class="empty">No se pudo cargar: ${esc(e.message)}</div>`;
  }
}

export function renderTarjeta() {
  if (!_wired) {
    _wired = true;
    const btn = V('uso-cargar');
    if (btn) btn.addEventListener('click', cargar);
  }
  cargar();
}
