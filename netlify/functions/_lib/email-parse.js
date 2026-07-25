/**
 * _lib/email-parse.js — Parser de notificaciones bancarias por correo (captura
 * automática de movimientos, DCDG). Convierte el texto de una notificación
 * (Bancolombia o DolarApp/ARQ) en una transacción estructurada, o la descarta
 * (ruido de seguridad, operaciones de iWin, marketing). Función PURA: no toca DB
 * ni red — la clasificación de categoría y el registro viven aguas abajo.
 *
 * Devuelve { skip: motivo } o { tx: {...} }. La `tx` trae:
 *   clase: 'gasto' | 'ingreso' | 'transferencia'
 *   direccion: 'salida' | 'entrada'
 *   monto, moneda ('COP' | 'USD')
 *   cuenta (últimos 4), dueno ('Luis'|'Carolina'|'Hijo'|null), cc ('LADCC'|'CMDG'|null)
 *   comercio | remitente | destino (según el caso)
 *   fecha (ISO AAAA-MM-DD), fuente ('bancolombia'|'dolarapp')
 */

// --- Mapa de cuentas (por últimos 4 dígitos) ---------------------------------
const CUENTAS = {
  // Luis
  '0965': { dueno: 'Luis', cc: 'LADCC' }, '2331': { dueno: 'Luis', cc: 'LADCC' },
  '3355': { dueno: 'Luis', cc: 'LADCC' }, '4549': { dueno: 'Luis', cc: 'LADCC' },
  '6940': { dueno: 'Luis', cc: 'LADCC' },
  // Carolina (5688 = Ahinoa; 3164 = mixto; 4550/9354 tarjetas)
  '5688': { dueno: 'Carolina', cc: 'CMDG', ahinoa: true }, '3164': { dueno: 'Carolina', cc: 'CMDG' },
  '4550': { dueno: 'Carolina', cc: 'CMDG' }, '9354': { dueno: 'Carolina', cc: 'CMDG' },
  // Hijo (bolsillo educación)
  '2953': { dueno: 'Hijo', cc: null, bolsillo: 'educacion' },
  // iWin SAS — fuera de alcance (no registrar)
  '5401': { excluir: true, motivo: 'iWin' }, '2997': { excluir: true, motivo: 'iWin' },
};

/** Últimos 4 dígitos de un identificador de cuenta ("*55400000965" → "0965"). */
export function ultimos4(str) {
  const m = String(str || '').match(/(\d{4})\D*$/);
  return m ? m[1] : null;
}

/** Datos de la cuenta por sus últimos 4 (o {} si es desconocida/externa). */
export function cuentaInfo(last4) {
  return (last4 && CUENTAS[last4]) || {};
}

// --- Montos ------------------------------------------------------------------
/**
 * Monto en COP. Dos estilos: colombiano "1.234.567,89" (punto=miles, coma=decimal)
 * o plano "1161300.00" / "749000". Con coma → la coma es el decimal.
 */
export function parseMontoCOP(str) {
  let s = String(str == null ? '' : str).replace(/[^\d.,]/g, '');
  if (!s) return null;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  // Bancolombia MEZCLA formatos: personal "$50.000,00" (punto=miles, coma=decimal)
  // y negocios/PSE "$37,804,000.00" (coma=miles, punto=decimal). Se desambigua
  // por cuál separador aparece de ÚLTIMO (ese es el decimal).
  if (hasComma && hasDot) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.') // CO: 50.000,00 → 50000.00
      : s.replace(/,/g, '');                   // US: 37,804,000.00 → 37804000.00
  } else if (hasComma) {
    // solo coma: miles si son grupos de 3 ("110,000"), decimal si no ("9,50").
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (hasDot) {
    // solo punto: miles si son grupos de 3 ("785.000"); decimal si no ("1161300.00").
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }
  return Number(s);
}

/** Monto estilo US (DolarApp): "12,919,288" (coma=miles), "3899.99" (punto=decimal). */
export function parseMontoUS(str) {
  const s = String(str == null ? '' : str).replace(/[^\d.,]/g, '').replace(/,/g, '');
  return s ? Number(s) : null;
}

/** Fecha "DD/MM/AAAA" o "DD/MM/AA" → ISO "AAAA-MM-DD". */
export function parseFechaBanco(str) {
  const m = String(str || '').match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (!m) return null;
  const dd = m[1]; const mm = m[2];
  const yy = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${yy}-${mm}-${dd}`;
}

// --- Ruido a descartar -------------------------------------------------------
const RUIDO = [
  /c[oó]digo OTP/i, /Cambiaste tu clave/i, /transferencia sospechosa/i,
  /Preparaste la transacci[oó]n/i, /Se aprob[oó] la transacci[oó]n/i,
  /Te identificaste/i, /Pactaste tu tasa/i, /Recibir divisas/i,
  /Operaci[oó]n Comercio Internacional/i, /giro del exterior/i,
  /Enviaste un pago de Proveedores/i, /Invita a tus amigos/i,
  /estado de cuenta/i, /Bre-B ya lleg[oó]/i, /Transfiere tus inversiones/i,
];
function esRuido(texto) {
  return RUIDO.some((re) => re.test(texto));
}

// --- Bancolombia -------------------------------------------------------------
function parseBancolombia(texto) {
  // Compra con tarjeta débito: "Compraste $X en COMERCIO con tu T.Deb *NNNN, el DD/MM/AAAA"
  let m = texto.match(/Compraste\s+\$([\d.,]+)\s+en\s+(.+?)\s+con\s+tu\s+T\.?\s?Deb\s+\*?(\d+),?\s+el\s+(\d{2}\/\d{2}\/\d{2,4})/i);
  if (m) {
    const c4 = ultimos4(m[3]);
    return { clase: 'gasto', direccion: 'salida', monto: parseMontoCOP(m[1]), moneda: 'COP',
      comercio: m[2].trim(), cuenta: c4, ...owner(c4), fecha: parseFechaBanco(m[4]), fuente: 'bancolombia' };
  }
  // Pago a comercio por PSE: "Pagaste $X por PSE a COMERCIO desde tu producto *NNNN"
  m = texto.match(/Pagaste\s+\$([\d.,]+)\s+por\s+PSE\s+a\s+(.+?)\s+desde\s+tu\s+producto\s+\*?(\d+)/i);
  if (m) {
    const c4 = ultimos4(m[3]);
    if (cuentaInfo(c4).excluir) return { skip: 'iWin (PSE)' };
    return { clase: 'gasto', direccion: 'salida', monto: parseMontoCOP(m[1]), moneda: 'COP',
      comercio: m[2].trim(), cuenta: c4, ...owner(c4), fecha: parseFechaBanco(texto), fuente: 'bancolombia' };
  }
  // Pago a comercio: "Pagaste $X a COMERCIO desde tu producto NNNN el DD/MM/AAAA"
  m = texto.match(/Pagaste\s+\$([\d.,]+)\s+a\s+(.+?)\s+desde\s+(?:tu\s+)?producto\s+\*?(\d+)\s+el\s+(\d{2}\/\d{2}\/\d{2,4})/i);
  if (m) {
    const c4 = ultimos4(m[3]);
    if (cuentaInfo(c4).excluir) return { skip: 'iWin' };
    return { clase: 'gasto', direccion: 'salida', monto: parseMontoCOP(m[1]), moneda: 'COP',
      comercio: m[2].trim(), cuenta: c4, ...owner(c4), fecha: parseFechaBanco(m[4]), fuente: 'bancolombia' };
  }
  // Pago por QR: "...pagaste $X por codigo QR desde tu cuenta *NNNN a la llave YYY"
  m = texto.match(/pagaste\s+\$([\d.,]+)\s+por\s+c[oó]digo\s+QR\s+desde\s+tu\s+cuenta\s+\*?(\d+)/i);
  if (m) {
    const c4 = ultimos4(m[2]);
    return { clase: 'gasto', direccion: 'salida', monto: parseMontoCOP(m[1]), moneda: 'COP',
      comercio: null, via: 'QR', cuenta: c4, ...owner(c4), fecha: parseFechaBanco(texto), fuente: 'bancolombia' };
  }
  // Pago por Botón Bancolombia a un comercio: "Transferiste $X por Boton Bancolombia a COMERCIO desde producto *NNNN"
  m = texto.match(/Transferiste\s+\$([\d.,]+)\s+por\s+Bot[oó]n\s+Bancolombia\s+a\s+(.+?)\s+desde\s+producto\s+\*?(\d+)/i);
  if (m) {
    const c4 = ultimos4(m[3]);
    return { clase: 'gasto', direccion: 'salida', monto: parseMontoCOP(m[1]), moneda: 'COP',
      comercio: m[2].trim(), cuenta: c4, ...owner(c4), fecha: parseFechaBanco(texto), fuente: 'bancolombia' };
  }
  // Transferencia con destino nombrado por llave: "...transferiste $X a la llave YYY desde tu cuenta *NNNN a DESTINO el ..."
  m = texto.match(/transferiste\s+\$([\d.,]+)\s+a\s+la\s+llave\s+\S+\s+desde\s+tu\s+cuenta\s+\*?(\d+)\s+a\s+(.+?)\s+el\s+(\d{2}\/\d{2}\/\d{2,4})/i);
  if (m) {
    const c4 = ultimos4(m[2]);
    return { clase: 'transferencia', direccion: 'salida', monto: parseMontoCOP(m[1]), moneda: 'COP',
      cuenta: c4, ...owner(c4), destino: m[3].trim(), fecha: parseFechaBanco(m[4]), fuente: 'bancolombia' };
  }
  // Transferencia salida a una cuenta: "Transferiste $X desde tu cuenta *NNNN a la cuenta *MMMM el DD/MM/AAAA"
  m = texto.match(/Transferiste\s+\$([\d.,]+)\s+desde\s+tu\s+cuenta\s+\*?(\d+)\s+a\s+la\s+cuenta\s+\*?(\d+)\s+el\s+(\d{2}\/\d{2}\/\d{2,4})/i);
  if (m) {
    const c4 = ultimos4(m[2]); const d4 = ultimos4(m[3]);
    return { clase: 'transferencia', direccion: 'salida', monto: parseMontoCOP(m[1]), moneda: 'COP',
      cuenta: c4, ...owner(c4), cuenta_destino: d4, destino_info: cuentaInfo(d4),
      fecha: parseFechaBanco(m[4]), fuente: 'bancolombia' };
  }
  // Recepción: "...recibiste una transferencia [por $X ]de REMITENTE [por $X ]en tu cuenta *NNNN"
  m = texto.match(/recibiste\s+una\s+transferencia\s+(?:por\s+\$([\d.,]+)\s+)?de\s+(.+?)\s+(?:por\s+\$([\d.,]+)\s+)?en\s+tu\s+cuenta\s+\*+(\d+)/i);
  if (m) {
    const monto = parseMontoCOP(m[1] || m[3]);
    const c4 = ultimos4(m[4]);
    return { clase: 'ingreso', direccion: 'entrada', monto, moneda: 'COP',
      remitente: m[2].trim(), cuenta: c4, ...owner(c4), fecha: parseFechaBanco(texto), fuente: 'bancolombia' };
  }
  return { skip: 'no-reconocido' };
}

// --- DolarApp / ARQ ----------------------------------------------------------
function parseDolarApp(texto) {
  // "Enviaste 12,919,288 COP a NOMBRE" (+ "debitado 3899.99 USDc") → transferencia USD→COP propia
  let m = texto.match(/Enviaste\s+([\d.,]+)\s+COP\s+a\s+(.+?)[\n\r]/i) || texto.match(/Enviaste\s+([\d.,]+)\s+COP\s+a\s+([^.]+)/i);
  if (m) {
    const usdc = texto.match(/debitado\s+([\d.,]+)\s+USDc/i);
    return { clase: 'transferencia', direccion: 'salida', monto: parseMontoUS(m[1]), moneda: 'COP',
      destino: m[2].trim(), monto_usdc: usdc ? parseMontoUS(usdc[1]) : null, fuente: 'dolarapp' };
  }
  // "Recibiste 4,000 USD de REMITENTE" (+ "adicionado 3997 USDc")
  m = texto.match(/Recibiste\s+([\d.,]+)\s+USD\s+de\s+(.+?)[\n\r.]/i);
  if (m) {
    return { clase: 'ingreso', direccion: 'entrada', monto: parseMontoUS(m[1]), moneda: 'USD',
      remitente: m[2].trim(), fuente: 'dolarapp' };
  }
  return { skip: 'no-reconocido' };
}

function owner(last4) {
  const info = cuentaInfo(last4);
  return { dueno: info.dueno || null, cc: info.cc || null, ahinoa: !!info.ahinoa, bolsillo: info.bolsillo || null };
}

/**
 * Punto de entrada: dado un correo, devuelve { skip } o { tx }. Enruta por remitente.
 * @param {{from?:string, subject?:string, body?:string}} correo
 */
export function parseNotificacion({ from = '', subject = '', body = '' } = {}) {
  const texto = `${subject}\n${body}`.replace(/ /g, ' ');
  if (esRuido(texto)) return { skip: 'ruido/seguridad' };
  const remitente = String(from).toLowerCase();
  if (remitente.includes('arqfinance') || remitente.includes('dolarapp')) return parseDolarApp(texto);
  if (remitente.includes('bancolombia')) return parseBancolombia(texto);
  // Sin remitente confiable: intenta Bancolombia y, si no reconoce, DolarApp.
  const b = parseBancolombia(texto);
  if (!b.skip) return b;
  const d = parseDolarApp(texto);
  return d.skip ? b : d;
}
