/**
 * Netlify Scheduled Function — backup diario completo de la DB al Sheet
 * dedicado (issue #41).
 *
 * Vuelca `movimientos` + `empresas_mov` + `ingresos` a la hoja `⚙️ BACKUP DB`
 * (config.sheetBackup()), reemplazando su contenido en cada corrida. NO toca
 * `Registro Gastos`/`EMPRESAS` ni el espejo incremental (`_lib/sheet-mirror.js`).
 *
 * Alcance acotado a propósito (ver PR): sin alertas si falla — el error queda
 * en los logs de Netlify (Functions → scheduled-backup-db); sin selección de
 * rango de fechas (vuelca todo). Cadencia diaria de madrugada, ajustable
 * cambiando el cron de abajo.
 *
 * Requiere que la hoja `⚙️ BACKUP DB` ya exista en el spreadsheet (igual que
 * `⚙️ CUENTAS`: se crea a mano una vez; esta función no la crea sola).
 */
import { runBackupCompleto } from './_lib/backup.js';

export default async () => {
  try {
    const resultado = await runBackupCompleto();
    console.log('[scheduled-backup-db] backup completo ok', resultado);
  } catch (e) {
    // Best-effort a propósito (issue #41): no hay alertas, solo logs de Netlify.
    console.error('[scheduled-backup-db] fallo:', e.message);
  }
  return new Response('ok');
};

// Diario 08:00 UTC ≈ 03:00 hora Colombia (madrugada). Cadencia ajustable: si se
// prefiere semanal, cambiar a algo como '0 8 * * 1' (lunes).
export const config = { schedule: '0 8 * * *' };
