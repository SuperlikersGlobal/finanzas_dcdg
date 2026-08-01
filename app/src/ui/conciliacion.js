/**
 * ui/conciliacion.js — Pantalla de conciliación (fase 2 de docs/conciliacion.md,
 * issue #39). Junto al 🧾 de extractos: elige un extracto ya cargado, pide al
 * backend que PROPONGA cruces contra lo capturado (`movimientos`/`ingresos`
 * `provisional`) y deja que el usuario revise y confirme antes de escribir
 * `conciliado`. Nada se concilia sin esa confirmación explícita.
 *
 * Tres casos por línea (ver _lib/conciliacion.js):
 *  - match     → un solo candidato compatible → botón "Confirmar cruce".
 *  - ambiguo   → más de un candidato → el usuario elige cuál con un <select>
 *                antes de poder confirmar (nunca se auto-resuelve).
 *  - solo_extracto → nada capturado matchea → informativo, y además se puede
 *                "Contabilizar estas N líneas" (backfill, issue #72): revisa
 *                una propuesta de clasificación y las materializa como
 *                movimiento/ingreso ya contabilizado (ver `_lib/backfill.js`).
 *
 * Además, el caso inverso (issue #145): un movimiento/ingreso `provisional`
 * que el extracto no corrobora en absoluto (nunca fue candidato de ninguna
 * propuesta) se muestra en la sección "Capturado que el extracto no
 * corrobora" — solo informativo, sin acción asociada.
 */

import {
  getExtractos, getPropuestasConciliacion, confirmarCruce,
  getPropuestasBackfill, materializarBackfill, getCatalogos,
} from '../services/finanzas.js';
import { formatCOP } from '../utils/formatters.js';
import { CATEGORIAS, subcategorias } from '../config/categories.js';

const V = (id) => document.getElementById(id);

let _wired = false;
let _extractoId = null;

// ── Backfill de líneas `solo_extracto` (issue #72) ──────────────────────────
let _bf = [];          // propuestas de la corrida actual, editables por el usuario
let _bfCatalogos = null; // { entidades, cedulas } — se cargan solo si hace falta (ingresos)

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function extractoOptionsHTML(extractos, seleccionado) {
  if (!extractos.length) return '<option value="">Sin extractos cargados</option>';
  return extractos.map((e) => {
    const rango = [e.fecha_desde, e.fecha_hasta].filter(Boolean).map((f) => String(f).slice(0, 10)).join(' → ');
    const label = `${e.cuenta} · ${e.periodo || rango || '—'} (${e.n_lineas} línea${e.n_lineas === 1 ? '' : 's'})`;
    const sel = String(e.id) === String(seleccionado) ? ' selected' : '';
    return `<option value="${e.id}"${sel}>${esc(label)}</option>`;
  }).join('');
}

const CASO_LABEL = {
  match: '✓ cruce propuesto',
  ambiguo: '⚠ ambiguo — elige uno',
  solo_extracto: '— sin capturado',
};
const CASO_COLOR = {
  match: 'var(--green)',
  ambiguo: 'var(--gold)',
  solo_extracto: 'var(--gray-d)',
};

function cuadreHTML(cuadre) {
  if (!cuadre) return '';
  if (cuadre.cuadra) {
    return `<span style="color:var(--green)">✓ Cuadra</span> — saldo inicial ${formatCOP(cuadre.saldo_inicial)} + líneas = ${formatCOP(cuadre.saldo_calculado)} (saldo final del extracto: ${formatCOP(cuadre.saldo_final)})`;
  }
  return `<span style="color:var(--red)">⚠ No cuadra</span> — calculado ${formatCOP(cuadre.saldo_calculado)} vs. saldo final ${formatCOP(cuadre.saldo_final)} (diferencia de ${formatCOP(Math.abs(cuadre.diferencia))})`;
}

function candidatoLabel(c) {
  const fecha = String(c.fecha || '').slice(0, 10);
  return `${fecha} · ${c.descripcion || '(sin descripción)'} · ${formatCOP(Math.abs(Number(c.monto) || 0))}`;
}

function discrepanciaHTML(d) {
  const fecha = String(d.fecha || '').slice(0, 10);
  return `<div class="h-item">
    <div><div class="h-name">${esc(d.descripcion || '(sin descripción)')}</div><div class="h-meta">${esc(fecha)} · ${d.tipo}</div></div>
    <div class="h-amt">${formatCOP(Math.abs(Number(d.monto) || 0))}</div>
  </div>`;
}

function propuestaHTML(p) {
  const fecha = String(p.fecha || '').slice(0, 10);
  const monto = formatCOP(Math.abs(Number(p.monto) || 0));
  const caso = p.caso;
  let accion = '';

  if (caso === 'match') {
    const c = p.candidatos[0];
    accion = `
      <div class="h-meta" style="margin-top:4px">↔ ${esc(candidatoLabel(c))}</div>
      <button class="btn btn-p" style="margin-top:8px;padding:8px 14px;font-size:13px"
        data-act="confirmarCruce" data-linea="${p.linea_id}" data-tipo="${c.tipo}" data-id="${c.id}">
        ✓ Confirmar cruce
      </button>`;
  } else if (caso === 'ambiguo') {
    const opts = p.candidatos.map((c, i) =>
      `<option value="${c.tipo}:${c.id}"${i === 0 ? ' selected' : ''}>${esc(candidatoLabel(c))}</option>`
    ).join('');
    accion = `
      <div class="fld" style="margin-top:6px"><label>${p.candidatos.length} candidatos posibles — elige el correcto</label>
        <select data-amb-sel="${p.linea_id}">${opts}</select></div>
      <button class="btn btn-p" style="margin-top:6px;padding:8px 14px;font-size:13px"
        data-act="confirmarCruceAmbiguo" data-linea="${p.linea_id}">
        ✓ Confirmar cruce elegido
      </button>`;
  } else {
    accion = `<div class="h-meta" style="margin-top:4px">El banco registró esto pero no está capturado. 👉 Regístralo abajo, en <b>"Solo en el banco (sin capturar)"</b> (elige categoría y toca "Contabilizar").</div>`;
  }

  return `<div class="h-item" style="flex-direction:column;align-items:stretch;gap:2px">
    <div style="display:flex;justify-content:space-between">
      <div><div class="h-name">${esc(p.descripcion || '(sin descripción)')}</div><div class="h-meta">${esc(fecha)} · ${p.tipo_linea}</div></div>
      <div style="text-align:right"><div class="h-amt">${monto}</div>
        <div class="h-who" style="color:${CASO_COLOR[caso] || 'inherit'}">${CASO_LABEL[caso] || caso}</div></div>
    </div>
    ${accion}
  </div>`;
}

async function cargarExtractos(seleccionar) {
  const r = await getExtractos();
  const extractos = r.extractos || [];
  V('conc-extracto').innerHTML = extractoOptionsHTML(extractos, seleccionar);
  if (extractos.length && !seleccionar) _extractoId = extractos[0].id;
}

async function refreshPropuestas() {
  const sel = V('conc-extracto').value;
  _extractoId = sel ? Number(sel) : null;
  const msg = V('conc-msg');
  const list = V('conc-list');
  msg.textContent = '';
  V('conc-cuadre').innerHTML = '';
  _bf = [];
  V('bf-card').style.display = _extractoId ? '' : 'none';
  V('bf-resumen').textContent = '';
  V('bf-msg').textContent = '';
  V('disc-card').style.display = 'none';
  V('disc-resumen').textContent = '';
  V('disc-list').innerHTML = '';
  renderBfList();
  if (!_extractoId) { list.innerHTML = '<div class="empty">Elige un extracto</div>'; return; }
  list.innerHTML = '<div class="empty">Cargando propuestas…</div>';
  try {
    const r = await getPropuestasConciliacion(_extractoId);
    const props = r.propuestas || [];
    const disc = r.discrepancias || [];
    const res = r.resumen || {};
    V('conc-resumen').textContent = props.length
      ? `${res.n_match || 0} propuesta(s) · ${res.n_ambiguo || 0} ambigua(s) · ${res.n_solo_extracto || 0} sin capturado`
      : (res.n_sin_conciliar === 0 ? 'Todas las líneas de este extracto ya están conciliadas.' : '');
    V('conc-cuadre').innerHTML = cuadreHTML(res.cuadre);
    list.innerHTML = props.length
      ? props.map(propuestaHTML).join('')
      : '<div class="empty">Nada pendiente de revisar en este extracto.</div>';
    if (disc.length) {
      V('disc-card').style.display = '';
      V('disc-resumen').textContent = `${disc.length} capturado(s) que el extracto no corrobora — puede ser timing (postea el mes siguiente) o un error de captura.`;
      V('disc-list').innerHTML = disc.map(discrepanciaHTML).join('');
    }
    // Si hay líneas "solo en el banco", carga solas las editables (con categoría)
    // para que el usuario no tenga que buscar el botón: son las que quiere registrar.
    if ((res.n_solo_extracto || 0) > 0) await bfProponer();
  } catch (e) {
    list.innerHTML = `<div class="empty" style="color:var(--red)">${esc(e.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Backfill: "Contabilizar estas N líneas" (issue #72, Nocturno 1/7). El banco
// registró la línea pero nunca se capturó — se materializa como movimiento/
// ingreso ya contabilizado. Alta confianza (regla) va pre-marcada; el resto
// (sin regla, ingresos, transferencias) queda para revisión antes de aceptar.
// ---------------------------------------------------------------------------

function bfRowHTML(p, idx) {
  const fecha = String(p.fecha || '').slice(0, 10);
  const monto = formatCOP(p.monto);
  const checked = p._incluir ? ' checked' : '';
  const etiqueta = p.auto ? '✓ regla' : (p.fuente_sugerencia === 'modelo' ? '🤖 sugerido' : 'revisar');
  let campos = '';

  if (p.tipo === 'gasto') {
    const catOpts = CATEGORIAS.map((c) =>
      `<option value="${esc(c)}"${c === p.categoria ? ' selected' : ''}>${esc(c)}</option>`).join('');
    const subOpts = subcategorias(p.categoria).map((s) =>
      `<option value="${esc(s)}"${s === p.subcategoria ? ' selected' : ''}>${esc(s)}</option>`).join('');
    campos = `
      <div class="row2">
        <div class="fld"><label>Categoría</label>
          <select data-bf-f="categoria" data-bf-idx="${idx}"><option value="">—</option>${catOpts}</select></div>
        <div class="fld"><label>Subcategoría</label>
          <select data-bf-f="subcategoria" data-bf-idx="${idx}"><option value="">—</option>${subOpts}</select></div>
      </div>
      <div class="fld"><label>Quién pagó (opcional)</label>
        <input type="text" data-bf-f="quien_pago" data-bf-idx="${idx}" value="${esc(p.quien_pago || '')}"></div>`;
  } else if (p.tipo === 'ingreso') {
    const entidades = (_bfCatalogos && _bfCatalogos.entidades) || [];
    const cedulas = (_bfCatalogos && _bfCatalogos.cedulas) || [];
    const entOpts = entidades.map((e) =>
      `<option value="${e.id}"${String(e.id) === String(p.entidad_id) ? ' selected' : ''}>${esc(e.nombre)}</option>`).join('');
    const cedOpts = cedulas.map((c) =>
      `<option value="${esc(c.value)}"${c.value === p.cedula ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
    campos = `
      <div class="row2">
        <div class="fld"><label>Entidad</label>
          <select data-bf-f="entidad_id" data-bf-idx="${idx}"><option value="">—</option>${entOpts}</select></div>
        <div class="fld"><label>Cédula (tipo de renta)</label>
          <select data-bf-f="cedula" data-bf-idx="${idx}"><option value="">—</option>${cedOpts}</select></div>
      </div>`;
  } else {
    campos = `<div class="fld"><label>Cuenta destino</label>
      <input type="text" data-bf-f="cuenta_destino" data-bf-idx="${idx}" value="${esc(p.cuenta_destino || '')}"
        placeholder="Nombre exacto de la cuenta destino"></div>`;
  }

  return `<div class="h-item" style="flex-direction:column;align-items:stretch;gap:4px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <label style="display:flex;gap:8px;align-items:flex-start">
        <input type="checkbox" data-bf-check="${idx}"${checked} style="width:auto;margin-top:3px">
        <span><div class="h-name">${esc(p.descripcion || '(sin descripción)')}</div>
        <div class="h-meta">${esc(fecha)} · ${p.tipo} · ${etiqueta}</div></span>
      </label>
      <div class="h-amt">${monto}</div>
    </div>
    ${p.motivo ? `<div class="h-meta" style="color:var(--gray-d)">${esc(p.motivo)}</div>` : ''}
    ${campos}
  </div>`;
}

function renderBfList() {
  const list = V('bf-list');
  const btn = V('bf-aceptar-todo');
  if (!_bf.length) { list.innerHTML = ''; btn.style.display = 'none'; return; }
  list.innerHTML = _bf.map(bfRowHTML).join('');
  btn.style.display = '';
}

async function bfProponer() {
  if (!_extractoId) return;
  const msg = V('bf-msg');
  msg.textContent = 'Buscando líneas sin capturar…'; msg.style.color = 'var(--gray-d)';
  try {
    const r = await getPropuestasBackfill(_extractoId);
    const props = (r.propuestas || []).map((p) => ({ ...p, _incluir: !!p.auto }));
    if (!_bfCatalogos && props.some((p) => p.tipo === 'ingreso')) {
      try { _bfCatalogos = await getCatalogos(); } catch (_) { _bfCatalogos = { entidades: [], cedulas: [] }; }
    }
    _bf = props;
    const res = r.resumen || {};
    V('bf-resumen').textContent = props.length
      ? `${res.n_solo_extracto} línea(s) sin capturar · ${res.n_auto} con regla (pre-marcadas) · ${res.n_dudosas} para revisar`
      : 'No hay líneas sin capturar en este extracto.';
    msg.textContent = '';
    renderBfList();
  } catch (e) {
    msg.textContent = 'Error: ' + e.message; msg.style.color = 'var(--red)';
  }
}

function bfLeerCampo(idx, campo, valor) {
  const p = _bf[idx];
  if (!p) return;
  p[campo] = campo === 'entidad_id' ? (valor ? Number(valor) : null) : valor;
  if (campo === 'categoria') p.subcategoria = ''; // cambia la lista de subcategorías disponibles
  if (campo === 'categoria' || campo === 'subcategoria') renderBfList();
}

async function bfAceptarTodo() {
  const msg = V('bf-msg');
  const seleccionadas = _bf.filter((p) => p._incluir);
  if (!seleccionadas.length) { msg.textContent = 'Marca al menos una línea.'; msg.style.color = 'var(--gold)'; return; }
  for (const p of seleccionadas) {
    if (p.tipo === 'ingreso' && (!p.entidad_id || !p.cedula)) {
      msg.textContent = 'Completa entidad y cédula en cada ingreso marcado.'; msg.style.color = 'var(--red)'; return;
    }
    if (p.tipo === 'transferencia' && !String(p.cuenta_destino || '').trim()) {
      msg.textContent = 'Completa la cuenta destino en cada transferencia marcada.'; msg.style.color = 'var(--red)'; return;
    }
  }

  msg.textContent = `Contabilizando ${seleccionadas.length} línea(s)…`; msg.style.color = 'var(--gray-d)';
  try {
    let restante = seleccionadas.map((p) => ({
      linea_id: p.linea_id, tipo: p.tipo, categoria: p.categoria, subcategoria: p.subcategoria,
      metodo_pago: p.metodo_pago, quien_pago: p.quien_pago, notas: p.notas, moneda: p.moneda,
      monto: p.monto, fecha: p.fecha, descripcion: p.descripcion,
      cuenta_destino: p.cuenta_destino, entidad_id: p.entidad_id, cedula: p.cedula,
    }));
    let creadas = 0;
    const errores = [];
    while (restante.length) {
      const r = await materializarBackfill({ extracto_id: _extractoId, lineas: restante });
      creadas += r.creadas || 0;
      const procesadosIds = new Set((r.resultados || []).map((x) => x.linea_id));
      (r.resultados || []).filter((x) => !x.ok).forEach((x) => errores.push(x));
      restante = restante.filter((l) => !procesadosIds.has(l.linea_id));
      if (!r.procesadas) break; // corte de seguridad: nunca debería quedarse sin avanzar
    }
    const resumenTxt = `${creadas} línea${creadas === 1 ? '' : 's'} contabilizada${creadas === 1 ? '' : 's'} ✅`
      + (errores.length ? ` (${errores.length} con error — revísalas e intenta de nuevo).` : '');
    // Refresca las listas (algunas líneas dejaron de estar `sin_conciliar`);
    // refreshPropuestas recarga solo las que aún queden sin capturar. El mensaje
    // de resultado se fija DESPUÉS porque refresh/bfProponer lo limpian.
    await refreshPropuestas();
    V('bf-msg').textContent = resumenTxt;
    V('bf-msg').style.color = errores.length ? 'var(--gold)' : 'var(--green)';
  } catch (e) {
    msg.textContent = 'Error: ' + e.message; msg.style.color = 'var(--red)';
  }
}

async function confirmar(linea_id, tipo, id) {
  const msg = V('conc-msg');
  msg.textContent = 'Confirmando…'; msg.style.color = 'var(--gray-d)';
  try {
    const r = await confirmarCruce({ linea_id: Number(linea_id), tipo, id: Number(id) });
    msg.textContent = r.mensaje || 'Cruce confirmado ✅';
    msg.style.color = 'var(--green)';
    await refreshPropuestas();
  } catch (e) {
    msg.textContent = (e.status === 401 || e.status === 403)
      ? 'Inicia sesión con Google (usuario autorizado) para confirmar.'
      : 'Error: ' + e.message;
    msg.style.color = 'var(--red)';
  }
}

function confirmarAmbiguo(linea_id) {
  const sel = document.querySelector(`[data-amb-sel="${linea_id}"]`);
  if (!sel || !sel.value) return;
  const [tipo, id] = sel.value.split(':');
  confirmar(linea_id, tipo, id);
}

/** Llamado por main.js al navegar a la pantalla de conciliación. */
export async function renderConciliacion() {
  if (!_wired) {
    _wired = true;
    V('scr-conciliacion').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act="confirmarCruce"]');
      if (btn) confirmar(btn.dataset.linea, btn.dataset.tipo, btn.dataset.id);
      const btnAmb = e.target.closest('[data-act="confirmarCruceAmbiguo"]');
      if (btnAmb) confirmarAmbiguo(btnAmb.dataset.linea);
      if (e.target.closest('[data-act="bfProponer"]')) bfProponer();
      if (e.target.closest('[data-act="bfAceptarTodo"]')) bfAceptarTodo();
    });
    V('scr-conciliacion').addEventListener('change', (e) => {
      const chk = e.target.closest('[data-bf-check]');
      if (chk) { const p = _bf[Number(chk.dataset.bfCheck)]; if (p) p._incluir = chk.checked; }
      const fld = e.target.closest('[data-bf-f]');
      if (fld) bfLeerCampo(Number(fld.dataset.bfIdx), fld.dataset.bfF, fld.value);
    });
    V('conc-extracto').addEventListener('change', refreshPropuestas);
  }
  await cargarExtractos(_extractoId);
  refreshPropuestas();
}
