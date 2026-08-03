/**
 * _lib/env.js — Lectura de configuración del backend (Netlify Functions / Node).
 * Separa secretos del código (P1 del doc). Falla ruidosamente si falta lo crítico.
 */

export function env(key, fallback = undefined) {
  const v = process.env[key];
  return v == null || v === '' ? fallback : v;
}

export function requireEnv(key) {
  const v = env(key);
  if (v == null) throw new Error(`Falta variable de entorno requerida: ${key}`);
  return v;
}

export const config = {
  // Anthropic
  anthropicApiKey: () => requireEnv('ANTHROPIC_API_KEY'),
  anthropicModel: () => env('ANTHROPIC_MODEL', 'claude-sonnet-4-6'),
  anthropicModelFast: () => env('ANTHROPIC_MODEL_FAST', 'claude-haiku-4-5-20251001'),

  // Base de datos (Neon Postgres) — fuente de verdad del sistema.
  databaseUrl: () => requireEnv('DATABASE_URL'),
  databaseUrlOrNull: () => env('DATABASE_URL', null),

  // Sheets (ahora espejo de exportación, ya no fuente de verdad)
  spreadsheetId: () => requireEnv('GOOGLE_SPREADSHEET_ID'),
  sheetGastos: () => env('SHEET_GASTOS', 'Registro Gastos'),
  sheetEmpresas: () => env('SHEET_EMPRESAS', 'EMPRESAS'),
  sheetCuentas: () => env('SHEET_CUENTAS', '⚙️ CUENTAS'),
  // Hoja dedicada al backup completo (issue #41) — separada del espejo
  // incremental de Registro Gastos/EMPRESAS, para no interferir con esos.
  sheetBackup: () => env('SHEET_BACKUP', '⚙️ BACKUP DB'),

  // Service Account
  saEmail: () => requireEnv('GOOGLE_SA_EMAIL'),
  saPrivateKey: () => normalizeKey(requireEnv('GOOGLE_SA_PRIVATE_KEY')),

  // OAuth de usuario (para autenticar la PWA contra el backend de clasificación).
  // El Client ID es público (va en el bundle de la PWA); default = el de DCDG.
  googleClientId: () =>
    env('GOOGLE_CLIENT_ID', '473061009211-972b11u9s6gpqln7n0e6tdn51vjmnv5p.apps.googleusercontent.com'),

  // "Solicitudes de mejoras" desde la PWA (issue #78): crea/lista issues en
  // este mismo repo. Opcional — sin GITHUB_TOKEN_FINANZAS la función avisa en
  // vez de fallar (ver _lib/backlog.js).
  githubTokenFinanzas: () => env('GITHUB_TOKEN_FINANZAS', null),
  githubRepoFinanzas: () => env('GITHUB_REPO_FINANZAS', 'luchodelcast/finanzas_dcdg'),

  // Integración SilvIA
  apiToken: () => requireEnv('DCDG_API_TOKEN'),
  finanzasUsers: () =>
    String(env('FINANZAS_USERS', 'luis@iwin.im,carodz2@gmail.com,angela@iwin.im,ma.isabel@iwin.im,santiago@iwin.im'))
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  // Fallback legacy de "quién escribe" (T8): se usa solo si el email no tiene
  // fila en `usuarios` (o la tabla no responde). Una vez sembrado `usuarios`,
  // el rol de ahí manda.
  finanzasOwners: () =>
    String(env('FINANZAS_OWNERS', 'luis@iwin.im,carodz2@gmail.com'))
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
};

/** Normaliza la clave privada PEM (Netlify suele escapar los saltos de línea). */
function normalizeKey(raw) {
  let k = String(raw).trim();
  // Quita comillas envolventes si las hay.
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  // Convierte "\n" literales en saltos reales.
  if (k.includes('\\n')) k = k.replace(/\\n/g, '\n');
  return k;
}
