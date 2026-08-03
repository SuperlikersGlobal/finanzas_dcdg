/**
 * ui/dashboard.js — Dashboard de finanzas de la PWA.
 *
 * Lee de la DB (Neon) vía el backend y muestra: total del periodo, desglose por
 * categoría (barras) y últimos movimientos. Fuente de verdad = Postgres.
 * Sin librerías externas (barras con divs, tematizables claro/oscuro).
 */

import { getResumen, getMovimientos, anularMovimiento, recategorizarMovimiento } from '../services/finanzas.js';
import { currentUser } from '../services/auth.js';
import { formatCOP, formatMoneda } from '../utils/formatters.js';
import { CATEGORIAS } from '../config/categories.js';

const V = (id) => document.getElementById(id);
// Roles con acceso de escritura (owner + equipo financiero/contable). Igual que
// el gate del backend (`ROLES_ESCRITURA` en handlers.js): deja escribir a Luis/
// Carolina y al equipo (admin_financiero/tesoreria/contador); solo_lectura no.
const ROLES_ESCRITURA = new Set(['owner', 'admin_financiero', 'tesoreria', 'contador']);
const esOwner = () => ROLES_ESCRITURA.has((currentUser() || {}).rol);

// Paleta para las categorías (se cicla). Usa los tonos de la marca DCDG.
const PALETTE = ['#2E5FA3', '#0F6E56', '#F0A500', '#534AB7', '#C0392B', '#1A7A4A', '#5DCAA5', '#854F0B'];

let _wired = false;
let _periodo = 'mes';
let _quien = ''; // '' = toda la familia | 'Luis' | 'Carolina'

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Devuelve { param, desde, hasta, label } para el periodo seleccionado. */
export function periodRange(key, hoy = new Date()) {
  if (key === 'mespasado') {
    const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
    return { desde: iso(ini), hasta: iso(fin), label: 'Mes pasado' };
  }
  if (key === 'anio') {
    // Todo el año calendario (1 ene – 31 dic), NO solo hasta hoy: así un
    // movimiento mal fechado en un mes futuro (p. ej. un recibo leído como
    // septiembre por error) sigue siendo visible y se puede corregir/anular.
    const ini = new Date(hoy.getFullYear(), 0, 1);
    const fin = new Date(hoy.getFullYear(), 11, 31);
    return { desde: iso(ini), hasta: iso(fin), label: String(hoy.getFullYear()) };
  }
  // mes en curso (default): hasta FIN DE MES, no `hoy`. Si no, un movimiento
  // fechado más adelante en el mes queda oculto — p. ej. un recibo que SilvIA
  // marcó en UTC y cae "mañana" por la diferencia horaria (Colombia UTC−5),
  // como AutohausAZ 2026-07-28 que no salía estando el visor en el 27. Mismo
  // criterio que 'mespasado'/'anio'.
  const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
  return { desde: iso(ini), hasta: iso(fin), label: 'Este mes' };
}

/** Devuelve el rango equivalente del periodo INMEDIATAMENTE ANTERIOR al seleccionado. */
export function periodRangeAnterior(key, hoy = new Date()) {
  if (key === 'mespasado') {
    const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1);
    const fin = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 0);
    return { desde: iso(ini), hasta: iso(fin), label: 'Hace 2 meses' };
  }
  if (key === 'anio') {
    const ini = new Date(hoy.getFullYear() - 1, 0, 1);
    const fin = new Date(hoy.getFullYear() - 1, hoy.getMonth(), hoy.getDate());
    return { desde: iso(ini), hasta: iso(fin), label: String(hoy.getFullYear() - 1) };
  }
  // mes en curso → el mes calendario anterior completo
  const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
  return { desde: iso(ini), hasta: iso(fin), label: 'Mes anterior' };
}

/** % de variación de `actual` vs `anterior` (null si no hay base de comparación). */
export function variacionPct(actual, anterior) {
  const a = Number(actual) || 0;
  const b = Number(anterior) || 0;
  if (!b) return null;
  return ((a - b) / Math.abs(b)) * 100;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function segHTML() {
  const opts = [['mes', 'Este mes'], ['mespasado', 'Mes pasado'], ['anio', 'Año']];
  return `<div class="seg">${opts.map(([k, l]) =>
    `<button class="seg-btn${k === _periodo ? ' on' : ''}" data-per="${k}">${l}</button>`).join('')}</div>`;
}

// Filtro por persona (toda la familia / Luis / Caro). El backend filtra por quien_pago.
function segPersonaHTML() {
  const opts = [['', 'Todos'], ['Luis', 'Luis'], ['Carolina', 'Caro']];
  return `<div class="seg" style="margin-top:8px">${opts.map(([k, l]) =>
    `<button class="seg-btn${k === _quien ? ' on' : ''}" data-quien="${k}">${l}</button>`).join('')}</div>`;
}

/** HTML del indicador de variación (▲/▼ + %). `compact` omite el sufijo "vs. …". */
export function variacionHTML(actual, anterior, { compact = false, sufijo = '' } = {}) {
  const pct = variacionPct(actual, anterior);
  if (pct == null) return '';
  const bajo = pct <= 0;
  const cls = bajo ? 'var-down' : 'var-up';
  const arrow = bajo ? '▼' : '▲';
  const texto = `${arrow} ${Math.abs(pct).toFixed(compact ? 0 : 1)}%${sufijo}`;
  return `<span class="${compact ? 'bar-var' : 'dash-var'} ${cls}">${texto}</span>`;
}

function barsHTML(porCategoria, porCategoriaAnterior) {
  if (!porCategoria || !porCategoria.length) return '<div class="empty">Sin gastos en este periodo</div>';
  const max = Math.max(...porCategoria.map((c) => Number(c.monto) || 0)) || 1;
  const prevMap = new Map((porCategoriaAnterior || []).map((c) => [c.categoria, Number(c.monto) || 0]));
  return porCategoria.map((c, i) => {
    const monto = Number(c.monto) || 0;
    const pct = Math.max(2, Math.round((monto / max) * 100));
    const color = PALETTE[i % PALETTE.length];
    const varHtml = prevMap.has(c.categoria) ? variacionHTML(monto, prevMap.get(c.categoria), { compact: true }) : '';
    return `<div class="bar-row dash-cat-row" data-cat="${esc(c.categoria)}" title="Ver movimientos de ${esc(c.categoria)}">
      <div class="bar-head"><span class="bar-cat">${esc(c.categoria)} ›</span><span class="bar-amt">${esc(c.monto_fmt || formatCOP(monto))} ${varHtml}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
    </div>`;
  }).join('');
}

function comerciosHTML(top) {
  if (!top || !top.length) return '<div class="empty">Sin datos en este periodo</div>';
  return top.map((c) => `<div class="h-item">
      <div><div class="h-name">${esc(c.descripcion)}</div></div>
      <div><div class="h-amt">${esc(c.monto_fmt || formatCOP(Number(c.monto) || 0))}</div></div>
    </div>`).join('');
}

/** Etiqueta hogar/personal (#114) para el historial: "🏡 Hogar" o "👤 Personal de X". */
function tipoGastoLabel(m) {
  if (m.tipo_gasto === 'personal') return `👤 Personal${m.tipo_gasto_persona ? ' de ' + m.tipo_gasto_persona : ''}`;
  if (m.tipo_gasto === 'hogar') return '🏡 Hogar';
  return '';
}

/** De dónde salió el movimiento: 📧 automático (correo del banco) vs 💬/📱 reportado. */
function origenLabel(m) {
  const o = String(m.origen || '').toLowerCase();
  if (o.includes('correo')) return '📧 Automático';
  if (o.includes('silvia')) return '💬 SilvIA';
  if (o.includes('app')) return '📱 App';
  return o ? '✍️ Reportado' : '';
}

function movsHTML(movs, owner) {
  if (!movs || !movs.length) return '<div class="empty">Sin movimientos en este periodo</div>';
  return movs.map((m) => {
    const fecha = String(m.fecha || '').slice(0, 10);
    const fix = owner
      ? `<button class="sec-link mov-fix" data-mov-id="${esc(m.id)}" style="margin-top:4px">Corregir</button>`
      : '';
    const tg = tipoGastoLabel(m);
    const og = origenLabel(m);
    return `<div class="h-item">
      <div><div class="h-name">${esc(m.descripcion)}</div><div class="h-meta">${esc(m.categoria || '—')}${m.subcategoria ? ' · ' + esc(m.subcategoria) : ''} · ${esc(fecha)}${tg ? ' · ' + esc(tg) : ''}${og ? ' · ' + esc(og) : ''}</div>${fix}</div>
      <div><div class="h-amt">${esc(formatMoneda(Number(m.monto) || 0, m.moneda))}</div><div class="h-who">${esc(m.quien_pago || '')}${m.metodo_pago ? ' · ' + esc(m.metodo_pago) : ''}</div></div>
    </div>`;
  }).join('');
}

function skeleton() {
  V('dash-body').innerHTML = '<div class="proc-wrap" style="min-height:180px"><div class="spin"></div><div class="proc-msg">Cargando…</div></div>';
}

async function load() {
  skeleton();
  const { desde, hasta, label } = periodRange(_periodo);
  const anterior = periodRangeAnterior(_periodo);
  const periodo = `${desde}..${hasta}`;
  const periodoAnterior = `${anterior.desde}..${anterior.hasta}`;
  const q = _quien ? { quien: _quien } : {};
  try {
    const [res, movsRes, resAnterior] = await Promise.all([
      getResumen({ periodo, ...q }),
      getMovimientos({ desde, hasta, limit: 20, excluir_viajes: 1, ...q }),
      getResumen({ periodo: periodoAnterior, ...q }),
    ]);
    const total = Number(res.total) || 0;
    const totalAnterior = Number(resAnterior.total) || 0;
    const varTotal = variacionHTML(total, totalAnterior, { sufijo: ` vs. ${esc(anterior.label)}` });
    V('dash-body').innerHTML = `
      <div class="card dash-total-card dash-total-open" title="Ver todos los movimientos">
        <div class="dash-total-lbl">${esc(label)}${_quien ? ' · ' + esc(_quien) : ''}</div>
        <div class="dash-total">${esc(res.total_fmt || formatCOP(total))}</div>
        <div class="dash-total-sub">${res.movimientos || 0} movimiento${res.movimientos === 1 ? '' : 's'}${varTotal ? ` · ${varTotal}` : ''} · toca para ver ›</div>
      </div>
      <div class="card">
        <div class="card-ttl">Por categoría</div>
        ${barsHTML(res.por_categoria, resAnterior.por_categoria)}
      </div>
      <div class="card">
        <div class="card-ttl">En qué más se fue la plata</div>
        ${comerciosHTML(res.top_comercios)}
      </div>
      <div class="card">
        <div class="card-ttl">Movimientos del periodo</div>
        ${movsHTML(movsRes.movimientos, esOwner())}
      </div>`;
  } catch (e) {
    const msg = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (Luis o Carolina) para ver el dashboard.'
      : (e.message || 'No se pudo cargar el dashboard.');
    V('dash-body').innerHTML = `<div class="card"><div class="empty" style="color:var(--red)">${esc(msg)}</div>
      <button class="btn btn-s" data-act="dashReload" style="margin-top:12px">Reintentar</button></div>`;
  }
}

/** Anular o recategorizar un movimiento (solo owners). MVP con prompt/confirm. */
async function corregir(id) {
  const r = (prompt('Corregir movimiento:\n\n• Escribe "anular" para anularlo (se reversa su asiento contable).\n• Escribe una FECHA (AAAA-MM-DD, ej: 2026-07-09) para corregir la fecha.\n• Escribe una CATEGORÍA válida para recategorizarlo.') || '').trim();
  if (!r) return;
  const fechaMatch = r.replace(/^fecha\s+/i, '').trim();
  try {
    if (r.toLowerCase() === 'anular') {
      if (!confirm('¿Anular este movimiento? Se reversa su asiento; la fila no se borra (queda como anulada).')) return;
      await anularMovimiento(Number(id));
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(fechaMatch)) {
      // Fecha suelta (con o sin el prefijo "fecha "). Se detecta por el formato
      // AAAA-MM-DD para que escribir solo la fecha NO se tome como categoría.
      await recategorizarMovimiento({ id: Number(id), fecha: fechaMatch });
    } else if (CATEGORIAS.includes(r)) {
      await recategorizarMovimiento({ id: Number(id), categoria: r });
    } else {
      alert(`"${r}" no es una categoría válida.\n\nCategorías válidas:\n${CATEGORIAS.join(', ')}\n\n(O escribe "anular", o una fecha AAAA-MM-DD.)`);
      return;
    }
    load();
  } catch (e) {
    alert((e.status === 401 || e.status === 403)
      ? 'Tu rol no tiene permiso para corregir movimientos.'
      : ('Error: ' + (e.message || 'no se pudo corregir')));
  }
}

/** Llamado por main.js al navegar a la pantalla del dashboard. */
export function renderDashboard() {
  const sel = V('dash-seg');
  if (sel) sel.innerHTML = segHTML() + segPersonaHTML();
  if (!_wired) {
    _wired = true;
    const scr = V('scr-dash');
    scr.addEventListener('click', (e) => {
      const per = e.target.closest('[data-per]');
      if (per) {
        _periodo = per.dataset.per;
        per.parentElement.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b === per));
        load();
        return;
      }
      const qb = e.target.closest('[data-quien]');
      if (qb) {
        _quien = qb.dataset.quien;
        qb.parentElement.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b === qb));
        load();
        return;
      }
      // Drill-down: categoría o total → pantalla Movimientos con el filtro puesto.
      const cat = e.target.closest('.dash-cat-row');
      if (cat) {
        if (window.__movFiltro) window.__movFiltro({ categoria: cat.dataset.cat, quien: _quien, periodo: _periodo });
        if (window.__nav) window.__nav('movimientos');
        return;
      }
      if (e.target.closest('.dash-total-open')) {
        if (window.__movFiltro) window.__movFiltro({ categoria: '', quien: _quien, periodo: _periodo });
        if (window.__nav) window.__nav('movimientos');
        return;
      }
      const fx = e.target.closest('.mov-fix');
      if (fx) { corregir(fx.dataset.movId); return; }
      if (e.target.closest('[data-act="dashReload"]')) load();
    });
  }
  load();
}
