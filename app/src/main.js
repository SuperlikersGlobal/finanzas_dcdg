/**
 * main.js — Orquestador de la PWA DCDG Finanzas.
 *
 * Port modular del <script> monolítico de DCDG_Captura_v5.html. La lógica de
 * dominio vive en los módulos (config/services/utils); aquí solo se cablea la
 * UI (navegación entre pantallas + handlers) usando delegación de eventos.
 */

import { getConfig, saveConfig } from './config/env.js';
import { CATS, subcategorias, CUENTAS_FALLBACK, CET_CUENTAS } from './config/categories.js';
import {
  TARJETAS_MAP,
  setCuentasDinamicas,
  resolveCard,
  isIwinAccount,
} from './config/accounts.js';
import { analizarTexto, analizarImagen } from './services/claude.js';
import { getCuentas } from './services/finanzas.js';
import {
  getSessionToken, signOut as authSignOut, isSignedIn,
  initSignIn, renderSignInButton, promptOneTap, gisReady,
} from './services/auth.js';
import { procesarRecibo } from './utils/imageProcessor.js';
import { procesarReciboPDF } from './utils/pdfProcessor.js';
import { formatCOP, hoyISO } from './utils/formatters.js';
import { monedaDeCuenta, tasaTransferencia } from './utils/transferencia-monedas.js';
import { loadHistory, addHistory, getHistory, clearHistory } from './services/history.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderMovimientos, movClearCat, setFiltroMovimientos } from './ui/movimientos.js';
import { renderHome } from './ui/home.js';
import { renderIngresos } from './ui/ingresos.js';
import { renderExtractos } from './ui/extractos.js';
import { renderConciliacion } from './ui/conciliacion.js';
import { renderAportes } from './ui/aportes.js';
import { renderCostos } from './ui/costos.js';
import { renderRentaAnual } from './ui/renta-anual.js';
import { renderAportesHogar } from './ui/aportes-hogar.js';
import { renderPagos } from './ui/pagos.js';
import { renderPrestamos } from './ui/prestamos.js';
import { renderSolicitudes } from './ui/solicitudes.js';
import { renderExportsCsv } from './ui/exportsCsv.js';
import { renderApertura } from './ui/apertura.js';
import { renderMayor } from './ui/mayor.js';
import { renderEstados } from './ui/estados.js';
import { renderPatrimonio } from './ui/patrimonio.js';
import { renderMetas } from './ui/metas.js';
import { renderPresupuesto } from './ui/presupuesto.js';
import { renderCierreMes } from './ui/cierre-mes.js';

const V = (id) => document.getElementById(id);
const today = () => hoyISO();
const fmtDate = (d) => d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });

// ── Estado de UI ──────────────────────────────────────────
let curImg = null; // { base64, mediaType, prev }
let curIsIwin = false;
let _accts = []; // cuentas cargadas (para los selects de transferencia)
let _trModo = 'simple'; // 'simple' | 'monedas' — modo del flujo de Transferencia (#132)

// ── Navegación ────────────────────────────────────────────
// Qué pestaña de la tab bar se resalta para cada pantalla.
function tabFor(s) {
  if (s === 'home') return 'home';
  if (['registrar', 'text', 'cet', 'conf', 'proc', 'ok'].includes(s)) return 'registrar';
  if (s === 'dash') return 'dash';
  if (s === 'pagos') return 'pagos';
  return 'mas';
}
function setActiveTab(s) {
  const t = tabFor(s);
  document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('on', el.dataset.go === t));
}

function go(s) {
  document.querySelectorAll('.scr').forEach((x) => x.classList.remove('on'));
  const el = V('scr-' + s);
  if (el) el.classList.add('on');
  setActiveTab(s);
  window.scrollTo(0, 0);
  if (s === 'settings') {
    const cfg = getConfig();
    V('cfg-ak').value = cfg.anthropicApiKey || '';
    V('cfg-gc').value = cfg.googleClientId || '';
    V('cfg-si').value = cfg.spreadsheetId || '';
    V('cfg-st').value = cfg.sheetGastos || 'Registro Gastos';
    V('cfg-se').value = cfg.sheetEmpresas || 'EMPRESAS';
  }
  if (s === 'home') renderHome();
  if (s === 'history') renderH();
  if (s === 'cet') initCET();
  if (s === 'dash') renderDashboard();
  if (s === 'movimientos') renderMovimientos();
  if (s === 'ingreso') renderIngresos();
  if (s === 'transfer') initTransfer();
  if (s === 'extractos') renderExtractos();
  if (s === 'conciliacion') renderConciliacion();
  if (s === 'aportes') renderAportes();
  if (s === 'costos') renderCostos();
  if (s === 'renta-anual') renderRentaAnual();
  if (s === 'aportes-hogar') renderAportesHogar();
  if (s === 'pagos') renderPagos();
  if (s === 'prestamos') renderPrestamos();
  if (s === 'solicitudes') renderSolicitudes();
  if (s === 'exports') renderExportsCsv();
  if (s === 'apertura') renderApertura();
  if (s === 'mayor') renderMayor();
  if (s === 'estados') renderEstados();
  if (s === 'patrimonio') renderPatrimonio();
  if (s === 'metas') renderMetas();
  if (s === 'presupuesto') renderPresupuesto();
  if (s === 'cierre-mes') renderCierreMes();
}

function toast(msg, dur = 3000) {
  const t = V('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

// ── Setup & Settings ──────────────────────────────────────
function saveSetup() {
  const ak = V('s-ak').value.trim(); // opcional: la clasificación ya es server-side
  const gc = V('s-gc').value.trim();
  const si = V('s-si').value.trim();
  const st = V('s-st').value.trim() || 'Registro Gastos';
  const se = V('s-se').value.trim() || 'EMPRESAS';
  if (!gc) return toast('Ingresa el Google Client ID');
  if (!si) return toast('Ingresa el ID del Spreadsheet');
  saveConfig({ ak, gc, si, st, se });
  go('home');
  renderHomeH();
  connect();
  toast('✓ Configuración guardada');
}

function saveCfg() {
  const cur = getConfig();
  saveConfig({
    ak: V('cfg-ak').value.trim() || cur.anthropicApiKey,
    gc: V('cfg-gc').value.trim() || cur.googleClientId,
    si: V('cfg-si').value.trim() || cur.spreadsheetId,
    st: V('cfg-st').value.trim() || cur.sheetGastos,
    se: V('cfg-se').value.trim() || cur.sheetEmpresas || 'EMPRESAS',
  });
  connect();
  go('home');
  toast('✓ Configuración actualizada');
}

function resetAll() {
  if (confirm('¿Borrar toda la configuración?')) {
    localStorage.clear();
    location.reload();
  }
}

// ── Sesión (Google Sign-In + token de sesión) ─────────────
function setConn(on) {
  V('conn-dot').className = 'conn-dot' + (on ? ' on' : '');
  V('conn-lbl').textContent = on ? 'Conectado' : 'Sin conectar';
  // Muestra/oculta la tab bar inferior según haya sesión (oculta en login/setup).
  const app = document.getElementById('app');
  if (app) app.classList.toggle('authed', !!on);
}

/** Si hay sesión válida, refleja el estado y carga cuentas; si no, muestra el login. */
async function connect() {
  if (isSignedIn()) {
    setConn(true);
    await cargarCuentas();
    return true;
  }
  setConn(false);
  mostrarLogin();
  return false;
}

/** Muestra la pantalla de login con el botón oficial de Google Sign-In. */
function mostrarLogin(msg) {
  go('login');
  const el = V('login-msg');
  if (el) { el.textContent = msg || ''; el.style.color = 'var(--red)'; }
  gisReady().then(() => {
    try {
      initSignIn({ onChange: onSessionChange });
      renderSignInButton(V('gsi-button'));
      promptOneTap();
    } catch (e) {
      if (el) el.textContent = 'No se pudo cargar Google Sign-In: ' + e.message;
    }
  });
}

/** Callback de cambios de sesión (login exitoso / fallo / cierre). */
function onSessionChange(user, err) {
  if (user) {
    setConn(true);
    cargarCuentas();
    go('home');
    renderHomeH();
    toast('✓ Sesión iniciada');
  } else {
    setConn(false);
    if (err) {
      const el = V('login-msg');
      if (el) { el.textContent = err.message || 'No se pudo iniciar sesión.'; el.style.color = 'var(--red)'; }
    }
  }
}

function signOut() {
  authSignOut();
  setConn(false);
  toast('Sesión cerrada');
  mostrarLogin();
}

/** Si el error fue de auth (401/403), muestra el login y devuelve true (corta el flujo). */
function esErrorAuth(e) {
  if (e && (e.status === 401 || e.status === 403)) {
    mostrarLogin('Tu sesión expiró. Vuelve a iniciar sesión.');
    return true;
  }
  return false;
}

// ── Cuentas dinámicas desde ⚙️ CUENTAS (leídas en el backend) ──
async function cargarCuentas() {
  try {
    const r = await getCuentas();
    const cuentas = r.cuentas || [];
    if (cuentas.length) {
      setCuentasDinamicas(cuentas);
      buildAccountsDropdown(cuentas);
    } else {
      buildAccountsDropdown(CUENTAS_FALLBACK);
    }
  } catch (_) {
    buildAccountsDropdown(CUENTAS_FALLBACK);
  }
}

function buildAccountsDropdown(accounts) {
  _accts = accounts || [];
  fillTransferAccts();
  const sel = V('cf-mth');
  const currentVal = sel.value;
  sel.innerHTML = '';
  accounts.forEach((acct) => {
    const o = document.createElement('option');
    o.value = acct.name;
    if (acct.tipoEspecial === 'iWin-Adelanto') o.textContent = acct.name + ' 🏢';
    else if (acct.tipoEspecial === 'USD-Internacional') o.textContent = acct.name + ' 💵';
    else o.textContent = acct.name;
    o.dataset.tipoEspecial = acct.tipoEspecial || 'Normal';
    sel.appendChild(o);
  });
  if (currentVal) {
    for (let i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === currentVal) {
        sel.selectedIndex = i;
        break;
      }
    }
  }
}

// ── Cámara / imagen / PDF ─────────────────────────────────
const esPDF = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');

async function onImg(inp) {
  const f = inp.files[0];
  if (!f) return;
  inp.value = '';
  go('proc');
  if (esPDF(f)) {
    V('proc-msg').textContent = 'Cargando PDF…';
    try {
      const { base64, mediaType } = await procesarReciboPDF(f);
      curImg = { base64, mediaType, prev: null };
      await doImg();
    } catch (e) {
      go('registrar');
      toast(e.message || 'No se pudo leer el PDF.');
    }
    return;
  }
  V('proc-msg').textContent = 'Cargando imagen…';
  try {
    const { base64, mediaType, dataUrl } = await procesarRecibo(f);
    curImg = { base64, mediaType, prev: dataUrl };
    await doImg();
  } catch (e) {
    go('registrar');
    toast(e.message || 'No se pudo leer la imagen.');
  }
}

// ── Clasificación ─────────────────────────────────────────
async function doImg() {
  if (!curImg) return;
  go('proc');
  V('proc-msg').textContent = 'Leyendo el recibo…';
  try {
    showConf(await analizarImagen(curImg.base64, curImg.mediaType));
  } catch (e) {
    toast('Error: ' + e.message);
    go('registrar');
  }
}

async function doText() {
  const txt = V('ti-val').value.trim();
  const dt = V('ti-dt').value;
  if (!txt) return toast('Escribe el gasto primero');
  curImg = null;
  go('proc');
  V('proc-msg').textContent = 'Clasificando…';
  try {
    showConf(await analizarTexto(txt, dt));
  } catch (e) {
    toast('Error: ' + e.message);
    go('text');
  }
}

// ── Pantalla de confirmación ──────────────────────────────
function showConf(d) {
  const iw = V('img-wrap');
  const pw = V('pdf-wrap');
  if (curImg && curImg.mediaType === 'application/pdf') {
    iw.style.display = 'none';
    pw.style.display = 'flex';
  } else if (curImg) {
    V('img-prev').src = curImg.prev;
    iw.style.display = 'block';
    pw.style.display = 'none';
  } else {
    iw.style.display = 'none';
    pw.style.display = 'none';
  }

  // Aviso de umbral (< $10.000)
  V('tw-wrap').style.display = d.monto > 0 && d.monto < 10000 ? 'flex' : 'none';

  // Aviso iWin
  curIsIwin = !!(d.iwin_prestamo || isIwinAccount(d.metodo_pago || ''));
  V('iwin-wrap').style.display = curIsIwin ? 'flex' : 'none';

  // Confianza
  const cb = V('cf-badge');
  cb.textContent =
    { alta: '✓ Alta confianza', media: '~ Confianza media', baja: '? Baja confianza' }[d.confianza] ||
    'Media';
  cb.className = 'cfb ' + (d.confianza || 'media');

  // Campos
  V('cf-monto').value = d.monto || '';
  V('cf-fecha').value = d.fecha || today();
  V('cf-desc').value = d.comercio || d.descripcion || '';
  V('cf-note').value = d.notas || '';

  // Tarjeta
  const tarjeta = d.tarjeta_ultimos4 || '';
  V('cf-tarjeta').value = tarjeta;
  if (tarjeta) onTarjetaInput(tarjeta);
  else V('cf-tarjeta-resolved').textContent = '';

  // Categoría
  const catSel = V('cf-cat');
  for (let i = 0; i < catSel.options.length; i++) {
    if (catSel.options[i].value === d.categoria) {
      catSel.selectedIndex = i;
      break;
    }
  }
  fillSubs();

  // Subcategoría
  const subSel = V('cf-sub');
  if (d.subcategoria) {
    for (let i = 0; i < subSel.options.length; i++) {
      if (subSel.options[i].value === d.subcategoria) {
        subSel.selectedIndex = i;
        break;
      }
    }
  }

  // Quién pagó
  V('cf-who').value = d.quien_pago === 'Carolina' ? 'Carolina' : 'Luis';

  // Hogar/personal: "Auto" por defecto — el backend infiere según la cuenta.
  V('cf-hogar').value = '';

  // Método de pago — match exacto y luego por keyword
  matchMetodo(d.metodo_pago || '');

  go('conf');
}

function matchMetodo(metodoPago) {
  const mth = V('cf-mth');
  const mp = metodoPago.toLowerCase();
  let matched = false;
  for (let i = 0; i < mth.options.length; i++) {
    if (mth.options[i].value.toLowerCase() === mp) {
      mth.selectedIndex = i;
      matched = true;
      break;
    }
  }
  if (!matched) {
    const terms = [
      ['iwin', 'iWin'], ['jeeves', 'iWin'], ['nequi', 'Nequi'],
      ['colpatria', 'Colpatria'], ['serfinanza', 'Serfinanza'],
      ['mercury', 'Mercury'], ['dollar', 'Dollar'], ['efectivo', 'Efectivo'],
      ['bancolombia', 'Bancolombia'],
    ];
    for (const [k, v] of terms) {
      if (mp.includes(k)) {
        for (let i = 0; i < mth.options.length; i++) {
          if (mth.options[i].value.toLowerCase().includes(v.toLowerCase())) {
            mth.selectedIndex = i;
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
    }
  }
  // Actualiza aviso iWin según el método finalmente seleccionado.
  const iwin = isIwinAccount(mth.value);
  curIsIwin = curIsIwin || iwin;
  V('iwin-wrap').style.display = curIsIwin ? 'flex' : 'none';
}

function onTarjetaInput(val) {
  const resolved = V('cf-tarjeta-resolved');
  if (val.length === 4) {
    const account = resolveCard(val);
    if (account) {
      resolved.textContent = '✓ ' + account;
      resolved.style.color = 'var(--teal)';
      const mth = V('cf-mth');
      for (let i = 0; i < mth.options.length; i++) {
        if (mth.options[i].value.includes(val) || mth.options[i].value === account) {
          mth.selectedIndex = i;
          curIsIwin = isIwinAccount(mth.value);
          V('iwin-wrap').style.display = curIsIwin ? 'flex' : 'none';
          break;
        }
      }
    } else {
      resolved.textContent = '⚠ Tarjeta no registrada en ⚙️ CUENTAS';
      resolved.style.color = 'var(--gold)';
    }
  } else {
    resolved.textContent = '';
  }
}

function initCats() {
  const sel = V('cf-cat');
  sel.innerHTML = '';
  Object.keys(CATS).forEach((c) => {
    const o = document.createElement('option');
    o.value = o.textContent = c;
    sel.appendChild(o);
  });
  fillSubs();
}

function fillSubs() {
  const cat = V('cf-cat').value;
  const sel = V('cf-sub');
  sel.innerHTML = '';
  subcategorias(cat).forEach((s) => {
    const o = document.createElement('option');
    o.value = o.textContent = s;
    sel.appendChild(o);
  });
}

// ── Guardar en Sheets ─────────────────────────────────────
async function submit() {
  if (!isSignedIn()) { mostrarLogin(); return; }
  doSheet();
}

async function doSheet(confirmar = false) {
  go('proc');
  V('proc-msg').textContent = 'Guardando…';
  const fecha = V('cf-fecha').value;
  const monto = parseFloat(V('cf-monto').value) || 0;
  const cat = V('cf-cat').value;
  const sub = V('cf-sub').value;
  const desc = V('cf-desc').value;
  const quien = V('cf-who').value;
  const metodo = V('cf-mth').value;
  const notas = V('cf-note').value;
  const tarjeta = V('cf-tarjeta').value.trim();
  const moneda = V('cf-moneda') ? V('cf-moneda').value : 'COP';
  // "" = auto (el backend infiere por la cuenta); "hogar"; "personal:<persona>".
  const hogarSel = V('cf-hogar') ? V('cf-hogar').value : '';
  const [tipoGasto, tipoGastoPersona] = hogarSel ? hogarSel.split(':') : [undefined, undefined];

  try {
    // El backend clasifica lo que falte, aplica reglas iWin/Delca2, deduplica y
    // escribe el gasto + el flujo EMPRESAS. Aquí ya mandamos categoría/cuenta.
    const r = await apiRegistrar({
      tipo: 'gasto', fecha, monto, moneda, categoria: cat, subcategoria: sub,
      descripcion: desc, quien_pago: quien, metodo_pago: metodo,
      tarjeta_ultimos4: tarjeta, notas, confirmar,
      tipo_gasto: tipoGasto, tipo_gasto_persona: tipoGastoPersona,
    });

    // Posible duplicado → preguntar y reintentar forzando si el usuario acepta.
    if (r && r.registrado === false && r.posible_duplicado) {
      if (confirm(`${r.mensaje}\n\n(Aceptar = guardar igual · Cancelar = no)`)) {
        return doSheet(true);
      }
      go('conf');
      return;
    }

    const empresas = !!(r.retiro_delca2 || r.adelanto_empresas);
    addHistory({ fecha, monto, cat, sub, desc, quien, ts: new Date().toISOString(), iwin: empresas });
    renderHomeH();

    V('ok-amt').textContent = formatCOP(monto);
    V('ok-det').textContent =
      `${cat} · ${quien} · ${fecha}${r.actualizado ? ' · ✏️ actualizado' : ''}${empresas ? ' · 🏢 EMPRESAS' : ''}`;
    go('ok');
  } catch (e) {
    if (esErrorAuth(e)) return;
    toast('Error: ' + e.message);
    go('conf');
  }
}

/** POST a la API de finanzas (mismo origen) con el token de sesión. */
async function apiRegistrar(mov) {
  const token = await getSessionToken();
  const cfg = getConfig();
  const base = (cfg.apiBaseUrl || '').replace(/\/$/, '');
  const res = await fetch(`${base}/api/pwa-registrar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(mov),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── Historial ─────────────────────────────────────────────
function hItemHTML(h, short) {
  const iwinTag = h.iwin
    ? ' <span style="font-size:10px;background:#EEEDFE;color:#534AB7;padding:1px 5px;border-radius:4px;font-weight:600">iWin</span>'
    : '';
  return `<div class="h-item">
    <div><div class="h-name">${h.desc || h.cat}${iwinTag}</div><div class="h-meta">${h.sub || h.cat}${short ? '' : ' · ' + h.fecha}</div></div>
    <div><div class="h-amt">${formatCOP(h.monto)}</div><div class="h-who">${h.quien}</div></div>
  </div>`;
}

function renderHomeH() {
  const c = V('home-hist');
  const h = getHistory(3);
  c.innerHTML = h.length ? h.map((x) => hItemHTML(x, true)).join('') : '<div class="empty">Aún no hay registros</div>';
}

function renderH() {
  const c = V('hist-list');
  const h = getHistory();
  c.innerHTML = h.length ? h.map((x) => hItemHTML(x, false)).join('') : '<div class="empty">Sin registros aún</div>';
}

function clearHist() {
  if (confirm('¿Borrar historial local?')) {
    clearHistory();
    renderH();
    renderHomeH();
  }
}

// ── CET ───────────────────────────────────────────────────
function fillCetCuentaSelect(sel) {
  sel.innerHTML = '';
  CET_CUENTAS.forEach((c) => {
    const o = document.createElement('option');
    o.value = c.value;
    o.textContent = c.label;
    sel.appendChild(o);
  });
}

function initCET() {
  if (!V('cet-desde').options.length) fillCetCuentaSelect(V('cet-desde'));
  if (!V('cet-dest-cuenta').options.length) fillCetCuentaSelect(V('cet-dest-cuenta'));
  V('cet-fecha').value = today();
  actualizarCET();
}

function onCetTipoDest() {
  const tipo = V('cet-tipo-dest').value;
  const esExterno = tipo === 'externo';
  V('cet-dest-externo-wrap').style.display = esExterno ? 'block' : 'none';
  V('cet-dest-cuenta-wrap').style.display = esExterno ? 'none' : 'block';
  actualizarCET();
}

function cetFechaCorta(fechaISO) {
  const [y, m, d] = fechaISO.split('-');
  return d + m + y.slice(2);
}

function cetDestino() {
  const tipo = V('cet-tipo-dest').value;
  if (tipo === 'externo') return V('cet-dest-externo').value.trim();
  return 'Cta ' + V('cet-dest-cuenta').value;
}

function generarAsuntoCET() {
  const fecha = V('cet-fecha').value;
  const moneda = V('cet-moneda').value;
  const monto = V('cet-monto').value || '0';
  const desde = V('cet-desde').value;
  const destino = cetDestino();
  const concepto = V('cet-concepto').value.trim();
  if (!fecha || !monto || !destino) return null;
  return `CET ${cetFechaCorta(fecha)} por ${moneda} ${parseInt(monto).toLocaleString('es-CO')} desde Cta ${desde} a ${destino}${concepto ? ' - ' + concepto : ''}`;
}

function actualizarCET() {
  V('cet-preview').textContent = generarAsuntoCET() || '—';
}

function abrirMailCET() {
  const asunto = generarAsuntoCET();
  if (!asunto) return toast('Completa los campos obligatorios');
  window.open(`mailto:cetladca@gmail.com?subject=${encodeURIComponent(asunto)}`, '_blank');
}

async function registrarCET() {
  if (!isSignedIn()) { mostrarLogin(); return; }
  const asunto = generarAsuntoCET();
  if (!asunto) return toast('Completa los campos obligatorios');

  const fecha = V('cet-fecha').value;
  const monto = parseFloat(V('cet-monto').value) || 0;
  const moneda = V('cet-moneda').value;
  const desde = V('cet-desde').value;
  const destino = cetDestino();
  const concepto = V('cet-concepto').value.trim();
  const tipo = V('cet-tipo-dest').value;

  let cat, sub, quien;
  if (tipo === 'cuenta-luis') {
    cat = 'Personal LADCC'; sub = 'Gastos Personales LADCC'; quien = 'Luis';
  } else if (tipo === 'cuenta-caro') {
    cat = 'Personal CMDG'; sub = 'Gastos Personales CMDG'; quien = 'Luis';
  } else {
    cat = 'Imprevistos'; sub = 'Otros'; quien = 'Luis';
  }

  const tarjeta = desde;
  const metodo = resolveCard(tarjeta) || 'Bcol Cta ' + desde;
  const notas = asunto;

  go('proc');
  V('proc-msg').textContent = 'Registrando CET…';

  try {
    // El CET se registra por el backend (Neon + espejo Sheet + contabilización),
    // igual que un gasto normal. `confirmar: true` mantiene la semántica previa
    // de "siempre queda registrado" (antes se anexaba la fila directo al Sheet).
    await apiRegistrar({
      tipo: 'gasto', fecha, monto, moneda, categoria: cat, subcategoria: sub,
      descripcion: concepto || destino, quien_pago: quien, metodo_pago: metodo,
      tarjeta_ultimos4: tarjeta, notas, confirmar: true,
    });
    addHistory({ fecha, monto, cat, sub, desc: concepto || destino, quien, ts: new Date().toISOString() });
    renderHomeH();

    V('ok-amt').textContent = (moneda === 'USD' ? 'USD ' : '$') + monto.toLocaleString('es-CO');
    V('ok-det').textContent = `CET registrado · ${destino} · ${fecha}`;
    go('ok');

    setTimeout(() => {
      window.open(`mailto:cetladca@gmail.com?subject=${encodeURIComponent(asunto)}`, '_blank');
    }, 800);
  } catch (e) {
    if (esErrorAuth(e)) return;
    toast('Error: ' + e.message);
    go('cet');
  }
}

// ── Transferencia entre cuentas ───────────────────────────
function fillTransferAccts() {
  const nombres = cuentasParaTransfer().map((a) => a.name).filter(Boolean);
  ['tr-origen', 'tr-destino'].forEach((id) => {
    const sel = V(id);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '';
    nombres.forEach((n) => {
      const o = document.createElement('option');
      o.value = o.textContent = n;
      sel.appendChild(o);
    });
    if (prev) sel.value = prev;
  });
  // Por defecto, destino distinto al origen.
  if (V('tr-destino') && V('tr-origen') && V('tr-destino').value === V('tr-origen').value && V('tr-destino').options.length > 1) {
    V('tr-destino').selectedIndex = 1;
  }
  actualizarMonedasTransfer();
}

function cuentasParaTransfer() {
  return _accts && _accts.length ? _accts : CUENTAS_FALLBACK;
}

/** Detecta la moneda de las cuentas origen/destino elegidas y actualiza los badges de solo lectura (#132). */
function actualizarMonedasTransfer() {
  const cuentas = cuentasParaTransfer();
  const monedaOrigen = monedaDeCuenta(V('tr-origen').value, cuentas);
  V('tr-moneda').value = monedaOrigen;
  V('tr-moneda-view').value = monedaOrigen;
  if (_trModo === 'monedas') {
    const monedaDestino = monedaDeCuenta(V('tr-destino').value, cuentas);
    V('tr-moneda-destino').value = monedaDestino;
    V('tr-moneda-destino-view').value = monedaDestino;
  } else {
    V('tr-moneda-destino').value = '';
    V('tr-moneda-destino-view').value = '';
  }
}

/** Cambia entre el flujo simple (misma moneda) y la sección dedicada "Entre monedas" (#132). */
function setTrModo(modo) {
  _trModo = modo;
  V('tr-modo-simple').classList.toggle('on', modo === 'simple');
  V('tr-modo-monedas').classList.toggle('on', modo === 'monedas');
  V('tr-destino-monedas-row').style.display = modo === 'monedas' ? '' : 'none';
  if (modo === 'simple') V('tr-monto-destino').value = '';
  actualizarMonedasTransfer();
  actualizarTasaTransfer();
}

function initTransfer() {
  fillTransferAccts();
  V('tr-fecha').value = today();
  V('tr-msg').textContent = '';
  V('tr-monto-destino').value = '';
  setTrModo('simple');
}

/** Tasa aplicada de la transferencia entre monedas, mostrada de forma prominente (#132). */
function actualizarTasaTransfer() {
  const tasaEl = V('tr-tasa');
  if (_trModo !== 'monedas') { tasaEl.textContent = ''; return; }
  const monto = parseFloat(V('tr-monto').value) || 0;
  const moneda = V('tr-moneda').value;
  const montoDestino = parseFloat(V('tr-monto-destino').value) || 0;
  const monedaDestino = V('tr-moneda-destino').value;
  const r = tasaTransferencia({ monto, moneda, montoDestino, monedaDestino });
  if (!r) {
    tasaEl.textContent = moneda !== 'COP' && monedaDestino && monedaDestino !== 'COP' && monedaDestino !== moneda
      ? 'Tasa no disponible (ninguna cuenta está en COP).'
      : '';
    return;
  }
  tasaEl.textContent = `Tasa: ${r.tasa.toLocaleString('es-CO', { maximumFractionDigits: 2 })} COP/${r.monedaExtranjera}`;
}

async function registrarTransfer() {
  if (!isSignedIn()) { mostrarLogin(); return; }
  const fecha = V('tr-fecha').value || today();
  const monto = parseFloat(V('tr-monto').value) || 0;
  const moneda = V('tr-moneda').value;
  const cOrigen = V('tr-origen').value;
  const cDestino = V('tr-destino').value;
  const desc = V('tr-desc').value.trim();
  const quien = V('tr-who').value;
  const montoDestino = _trModo === 'monedas' ? (parseFloat(V('tr-monto-destino').value) || 0) : 0;
  const monedaDestino = _trModo === 'monedas' ? V('tr-moneda-destino').value : '';
  const msg = V('tr-msg');
  if (!(monto > 0)) { msg.textContent = 'Ingresa un monto válido.'; msg.style.color = 'var(--red)'; return; }
  if (!cOrigen || !cDestino || cOrigen === cDestino) {
    msg.textContent = 'Elige cuentas de origen y destino distintas.'; msg.style.color = 'var(--red)'; return;
  }
  // Dos patas en monedas distintas: solo se envían si de verdad difieren (#121/#132).
  const dosPatas = monedaDestino && monedaDestino !== moneda;
  if (_trModo === 'monedas' && dosPatas && !(montoDestino > 0)) {
    msg.textContent = 'Ingresa el monto que entró en la cuenta destino.'; msg.style.color = 'var(--red)'; return;
  }
  go('proc');
  V('proc-msg').textContent = 'Registrando transferencia…';
  try {
    await apiRegistrar({
      tipo: 'transferencia', fecha, monto, moneda,
      cuenta_origen: cOrigen, cuenta_destino: cDestino, descripcion: desc, quien_pago: quien,
      ...(dosPatas ? { monto_destino: montoDestino, moneda_destino: monedaDestino } : {}),
    });
    const fmt = moneda === 'USD' ? 'USD ' + monto.toLocaleString('en-US') : formatCOP(monto);
    addHistory({ fecha, monto, cat: 'Transferencia', sub: '', desc: desc || `${cOrigen} → ${cDestino}`, quien, ts: new Date().toISOString() });
    renderHomeH();
    V('ok-amt').textContent = fmt;
    V('ok-det').textContent = dosPatas
      ? `Transferencia · ${cOrigen} → ${cDestino} (${monedaDestino} ${montoDestino.toLocaleString('es-CO')})`
      : `Transferencia · ${cOrigen} → ${cDestino}`;
    go('ok');
  } catch (e) {
    if (esErrorAuth(e)) return;
    msg.textContent = 'Error: ' + e.message; msg.style.color = 'var(--red)';
    go('transfer');
  }
}

// ── Cableado de eventos (delegación) ──────────────────────
const ACTIONS = {
  saveSetup, saveCfg, resetAll, signOut, doText, submit,
  abrirMailCET, registrarCET, clearHist, registrarTransfer,
  movClearCat,
  trigCam: () => V('cam-in').click(),
  trigGal: () => V('gal-in').click(),
};

// Navegación programática + fijar filtro (para drill-down del Panel a Movimientos).
window.__nav = go;
window.__movFiltro = setFiltroMovimientos;

function wireEvents() {
  document.addEventListener('click', (e) => {
    const goEl = e.target.closest('[data-go]');
    if (goEl) return go(goEl.dataset.go);
    const actEl = e.target.closest('[data-act]');
    if (actEl) {
      const fn = ACTIONS[actEl.dataset.act];
      if (fn) fn();
      return;
    }
    const exEl = e.target.closest('[data-ex]');
    if (exEl) V('ti-val').value = exEl.textContent;
  });

  V('cam-in').addEventListener('change', function () { onImg(this); });
  V('gal-in').addEventListener('change', function () { onImg(this); });
  V('cf-cat').addEventListener('change', fillSubs);
  V('cf-tarjeta').addEventListener('input', (e) => onTarjetaInput(e.target.value));
  V('cf-mth').addEventListener('change', () => {
    const iwin = isIwinAccount(V('cf-mth').value);
    curIsIwin = iwin;
    V('iwin-wrap').style.display = iwin ? 'flex' : 'none';
  });

  // CET reactivo
  ['cet-monto', 'cet-desde', 'cet-dest-externo', 'cet-dest-cuenta', 'cet-concepto', 'cet-fecha', 'cet-moneda']
    .forEach((id) => {
      const el = V(id);
      if (el) el.addEventListener('input', actualizarCET);
      if (el) el.addEventListener('change', actualizarCET);
    });
  V('cet-tipo-dest').addEventListener('change', onCetTipoDest);

  // Transferencia entre monedas (#121/#132): vista previa de la tasa aplicada.
  ['tr-monto', 'tr-monto-destino'].forEach((id) => {
    const el = V(id);
    if (!el) return;
    el.addEventListener('input', actualizarTasaTransfer);
    el.addEventListener('change', actualizarTasaTransfer);
  });
  ['tr-origen', 'tr-destino'].forEach((id) => {
    const el = V(id);
    if (!el) return;
    el.addEventListener('change', () => {
      actualizarMonedasTransfer();
      actualizarTasaTransfer();
    });
  });
  V('tr-modo-simple').addEventListener('click', () => setTrModo('simple'));
  V('tr-modo-monedas').addEventListener('click', () => setTrModo('monedas'));
}

// ── Init ──────────────────────────────────────────────────
function init() {
  loadHistory();
  initCats();
  buildAccountsDropdown(CUENTAS_FALLBACK);
  V('ti-dt').value = today();
  V('hdr-sub').textContent = fmtDate(new Date());
  wireEvents();

  const cfg = getConfig();
  // Precarga campos de setup con lo que exista.
  if (cfg.anthropicApiKey) V('s-ak').value = cfg.anthropicApiKey;
  if (cfg.googleClientId) V('s-gc').value = cfg.googleClientId;
  if (cfg.spreadsheetId) V('s-si').value = cfg.spreadsheetId;
  V('s-st').value = cfg.sheetGastos || 'Registro Gastos';
  V('s-se').value = cfg.sheetEmpresas || 'EMPRESAS';

  // La PWA viene pre-configurada (Client ID y Spreadsheet por defecto) y ya no
  // necesita la Anthropic key (la clasificación es server-side). Con sesión
  // válida arranca en Home; si no, muestra el login de Google (Sign-In). Prepara
  // Sign-In en segundo plano para el One Tap silencioso.
  gisReady().then(() => { try { initSignIn({ onChange: onSessionChange }); } catch (_) { /* noop */ } });
  if (!cfg.googleClientId || !cfg.spreadsheetId) {
    go('setup');
  } else if (isSignedIn()) {
    go('home');
    renderHomeH();
    connect();
  } else {
    renderHomeH();
    mostrarLogin();
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
