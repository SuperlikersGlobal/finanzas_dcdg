/**
 * _lib/sheets.js — Cliente de Google Sheets con Service Account (backend).
 *
 * Autentica con una cuenta de servicio (JWT RS256 → access token OAuth2),
 * sin sesión de usuario ni navegador — ideal para el bot.
 *
 * Escribe con `:batchUpdate` + sheetId numérico para ser inmune al bug de
 * emoji en nombres de hoja (`⚙️ CUENTAS`, sección 9 del doc). Sin dependencias:
 * usa `node:crypto` y `fetch` global (Node 22).
 */

import { createSign } from 'node:crypto';
import { config } from './env.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

let _token = null;
let _tokenExp = 0;

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Firma un JWT de service account y lo intercambia por un access token. */
async function getAccessToken(now = Date.now()) {
  if (_token && now < _tokenExp - 60_000) return _token;

  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: config.saEmail(),
      scope: SCOPE,
      aud: TOKEN_URL,
      iat,
      exp,
    })
  );
  const signingInput = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(config.saPrivateKey(), 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OAuth SA ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  _token = data.access_token;
  _tokenExp = now + (Number(data.expires_in) || 3600) * 1000;
  return _token;
}

async function authedFetch(url, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Sheets ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

let _sheetMetaCache = null;

/** Metadata (sheetId + dimensiones) de todas las hojas, con cache. */
async function loadSheetMetaCache() {
  const id = config.spreadsheetId();
  if (!_sheetMetaCache) {
    const meta = await authedFetch(
      `${SHEETS_BASE}/${id}?fields=sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))`
    );
    _sheetMetaCache = new Map(
      (meta.sheets || []).map((s) => [s.properties.title, {
        sheetId: s.properties.sheetId,
        rowCount: s.properties.gridProperties?.rowCount || 0,
        columnCount: s.properties.gridProperties?.columnCount || 0,
      }])
    );
  }
  return _sheetMetaCache;
}

/** sheetId numérico por nombre (con cache). */
export async function getSheetId(sheetName) {
  const cache = await loadSheetMetaCache();
  const meta = cache.get(sheetName);
  if (meta == null) throw new Error(`Hoja no encontrada: "${sheetName}"`);
  return meta.sheetId;
}

/** sheetId + dimensiones actuales (rowCount/columnCount) por nombre. */
export async function getSheetMeta(sheetName) {
  const cache = await loadSheetMetaCache();
  const meta = cache.get(sheetName);
  if (meta == null) throw new Error(`Hoja no encontrada: "${sheetName}"`);
  return meta;
}

function toRowData(values) {
  return {
    values: values.map((v) => {
      if (typeof v === 'number') return { userEnteredValue: { numberValue: v } };
      if (v && String(v).startsWith('=')) {
        return { userEnteredValue: { formulaValue: String(v) } };
      }
      return { userEnteredValue: { stringValue: v == null ? '' : String(v) } };
    }),
  };
}

/** Agrega una fila (segura ante emojis en el nombre de hoja). */
export async function appendRow(sheetName, rowValues) {
  const id = config.spreadsheetId();
  const sheetId = await getSheetId(sheetName);
  return authedFetch(`${SHEETS_BASE}/${id}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        { appendCells: { sheetId, rows: [toRowData(rowValues)], fields: 'userEnteredValue' } },
      ],
    }),
  });
}

/**
 * Actualiza celdas de un rango A1 (values.update). Para nombres SIN emoji.
 * @param {string} rangeA1  p.ej. "Registro Gastos!G12:J12"
 * @param {Array<Array>} values  filas de valores
 */
export async function updateValues(rangeA1, values) {
  const id = config.spreadsheetId();
  return authedFetch(
    `${SHEETS_BASE}/${id}/values/${encodeURIComponent(rangeA1)}?valueInputOption=USER_ENTERED`,
    { method: 'PUT', body: JSON.stringify({ values }) }
  );
}

/** Lee un rango A1 (values API; usar solo con nombres SIN emoji). */
export async function readRange(rangeA1) {
  const id = config.spreadsheetId();
  const data = await authedFetch(
    `${SHEETS_BASE}/${id}/values/${encodeURIComponent(rangeA1)}`
  );
  return data.values || [];
}

/**
 * Completa `rows` con celdas vacías hasta cubrir `existingRowCount`/`existingColCount`
 * (la dimensión que ya tenía la hoja). Así, al reemplazar celda por celda desde A1,
 * queda "limpio" lo que sobraba de una corrida anterior con más filas/columnas —
 * sin depender de un `clear` por A1 (bug de emoji en nombres de hoja, ver arriba).
 * Pura, sin red: exportada para tests.
 */
export function padRowsForReplace(rows, existingRowCount = 0, existingColCount = 0) {
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const cols = Math.max(maxCols, existingColCount, 1);
  const out = rows.map((r) => {
    const row = r.slice();
    while (row.length < cols) row.push('');
    return row;
  });
  while (out.length < existingRowCount) out.push(new Array(cols).fill(''));
  return out;
}

/**
 * Reemplaza TODO el contenido de una hoja desde A1 (para backups: cada corrida
 * sobreescribe, no acumula). Emoji-safe (batchUpdate + sheetId, igual que
 * `appendRow`). Pensada para una hoja dedicada que solo escribe este backup.
 * @param {string} sheetName
 * @param {Array<Array>} rows  filas (incluye encabezados si los necesitas)
 */
export async function replaceSheetContent(sheetName, rows) {
  const id = config.spreadsheetId();
  const meta = await getSheetMeta(sheetName);
  const padded = padRowsForReplace(rows, meta.rowCount, meta.columnCount);
  return authedFetch(`${SHEETS_BASE}/${id}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        {
          updateCells: {
            range: { sheetId: meta.sheetId, startRowIndex: 0, startColumnIndex: 0 },
            rows: padded.map(toRowData),
            fields: 'userEnteredValue',
          },
        },
      ],
    }),
  });
}

// Exportado para tests: permite inyectar dependencias sin red real.
export const __internals = { getAccessToken, b64url };
