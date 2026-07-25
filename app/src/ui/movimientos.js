/**
 * ui/movimientos.js — Pantalla "Movimientos": la lista detallada y filtrable,
 * separada del Panel (que es el resumen). Filtros: periodo, persona (toda la
 * familia / Luis / Carolina), categoría (llega pre-seleccionada al hacer drill
 * down desde el Panel) y texto. Muestra el total de lo filtrado + la lista.
 *
 * Reusa el backend existente (`/api/pwa-resumen` y `/api/pwa-movimientos`, que ya
 * aceptan `quien`, `categoria`, `texto`, `desde`, `hasta`).
 */
import { getResumen, getMovimientos, anularMovimiento, recategorizarMovimiento } from '../services/finanzas.js';
import { currentUser } from '../services/auth.js';
import { formatCOP, formatMoneda } from '../utils/formatters.js';
import { periodRange } from './dashboard.js';
import { CATEGORIAS } from '../config/categories.js';

const V = (id) => document.getElementById(id);
const ROLES_ESCRITURA = new Set(['owner', 'admin_financiero', 'tesoreria', 'contador']);
const esOwner = () => ROLES_ESCRITURA.has((currentUser() || {}).rol);

// Estado del filtro (persiste entre navegaciones dentro de la sesión).
let _f = { periodo: 'mes', quien: '', categoria: '', texto: '' };
let _wired = false;

/** Fija filtros antes de abrir (drill-down desde el Panel). */
export function setFiltroMovimientos(f = {}) { _f = { ..._f, ...f }; }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const PERIODOS = [['mes', 'Este mes'], ['mespasado', 'Mes pasado'], ['anio', 'Año']];
const PERSONAS = [['', 'Toda la familia'], ['Luis', 'Luis'], ['Carolina', 'Caro']];

function segHTML(id, opciones, valor) {
  return `<div class="seg" data-seg="${id}">${opciones.map(([k, l]) =>
    `<button class="seg-btn${k === valor ? ' on' : ''}" data-val="${esc(k)}">${esc(l)}</button>`).join('')}</div>`;
}

function origenLabel(m) {
  const o = String(m.origen || '').toLowerCase();
  if (o.includes('correo')) return '📧 Automático';
  if (o.includes('silvia')) return '💬 SilvIA';
  if (o.includes('app')) return '📱 App';
  return o ? '✍️ Reportado' : '';
}

function movsHTML(movs, owner) {
  if (!movs || !movs.length) return '<div class="empty">Sin movimientos con estos filtros</div>';
  return movs.map((m) => {
    const fecha = String(m.fecha || '').slice(0, 10);
    const fix = owner ? `<button class="sec-link mov-fix" data-mov-id="${esc(m.id)}" style="margin-top:4px">Corregir</button>` : '';
    const og = origenLabel(m);
    const meta = [m.categoria || '—', m.subcategoria, fecha, og].filter(Boolean).map(esc).join(' · ');
    return `<div class="h-item">
      <div><div class="h-name">${esc(m.descripcion)}</div><div class="h-meta">${meta}</div>${fix}</div>
      <div><div class="h-amt">${esc(formatMoneda(Number(m.monto) || 0, m.moneda))}</div><div class="h-who">${esc(m.quien_pago || '')}${m.metodo_pago ? ' · ' + esc(m.metodo_pago) : ''}</div></div>
    </div>`;
  }).join('');
}

function chipCategoria() {
  if (!_f.categoria) return '';
  return `<div class="mov-chip">Categoría: <strong>${esc(_f.categoria)}</strong> <button class="mov-chip-x" data-act="movClearCat" aria-label="Quitar filtro">✕</button></div>`;
}

async function load() {
  V('mov-body').innerHTML = '<div class="proc-wrap" style="min-height:120px"><div class="spin"></div><div class="proc-msg">Cargando…</div></div>';
  const { desde, hasta } = periodRange(_f.periodo);
  const periodo = `${desde}..${hasta}`;
  const q = { quien: _f.quien || undefined, categoria: _f.categoria || undefined, texto: _f.texto || undefined };
  try {
    const [res, movsRes] = await Promise.all([
      getResumen({ periodo, ...q }),
      getMovimientos({ desde, hasta, limit: 300, ...q }),
    ]);
    const total = Number(res.total) || 0;
    const n = (movsRes.movimientos || []).length;
    V('mov-body').innerHTML = `
      <div class="card dash-total-card">
        <div class="dash-total-lbl">${esc(_f.categoria || 'Total filtrado')}${_f.quien ? ' · ' + esc(_f.quien) : ''}</div>
        <div class="dash-total">${esc(res.total_fmt || formatCOP(total))}</div>
        <div class="dash-total-sub">${n} movimiento${n === 1 ? '' : 's'}</div>
      </div>
      ${chipCategoria()}
      <div class="card">
        <div class="card-ttl">Movimientos</div>
        ${movsHTML(movsRes.movimientos, esOwner())}
      </div>`;
  } catch (e) {
    const msg = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (Luis o Carolina) para ver los movimientos.'
      : (e.message || 'No se pudieron cargar los movimientos.');
    V('mov-body').innerHTML = `<div class="card"><div class="empty" style="color:var(--red)">${esc(msg)}</div></div>`;
  }
}

async function corregir(id) {
  const r = (prompt('Corregir movimiento:\n\n• "anular" para anularlo.\n• Una FECHA (AAAA-MM-DD).\n• Una CATEGORÍA válida.') || '').trim();
  if (!r) return;
  try {
    if (r.toLowerCase() === 'anular') {
      if (!confirm('¿Anular este movimiento? Se reversa su asiento.')) return;
      await anularMovimiento(Number(id));
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(r)) {
      await recategorizarMovimiento({ id: Number(id), fecha: r });
    } else if (CATEGORIAS.includes(r)) {
      await recategorizarMovimiento({ id: Number(id), categoria: r });
    } else {
      alert(`"${r}" no es válido. Categorías:\n${CATEGORIAS.join(', ')}`);
      return;
    }
    load();
  } catch (e) {
    alert((e.status === 401 || e.status === 403) ? 'Sin permiso para corregir.' : ('Error: ' + (e.message || 'no se pudo')));
  }
}

// Acción para el chip (limpiar categoría). Registrada global por main.js.
export function movClearCat() { _f.categoria = ''; renderMovimientos(); }

/** Llamado por main.js al entrar a la pantalla. */
export function renderMovimientos() {
  const head = V('mov-filtros');
  if (head) {
    head.innerHTML = `
      ${segHTML('periodo', PERIODOS, _f.periodo)}
      ${segHTML('quien', PERSONAS, _f.quien)}
      <input id="mov-buscar" class="inp" placeholder="Buscar comercio o descripción…" value="${esc(_f.texto)}" style="margin-top:8px">`;
  }
  if (!_wired) {
    _wired = true;
    const scr = V('scr-movimientos');
    scr.addEventListener('click', (e) => {
      const seg = e.target.closest('.seg-btn');
      if (seg) {
        const cont = seg.closest('[data-seg]');
        const campo = cont && cont.dataset.seg;
        if (campo) {
          _f[campo] = seg.dataset.val;
          cont.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b === seg));
          load();
        }
        return;
      }
      const fx = e.target.closest('.mov-fix');
      if (fx) { corregir(fx.dataset.movId); return; }
    });
    scr.addEventListener('input', (e) => {
      if (e.target.id === 'mov-buscar') {
        _f.texto = e.target.value.trim();
        clearTimeout(scr._t);
        scr._t = setTimeout(load, 350);
      }
    });
  }
  load();
}
