/**
 * Service worker DCDG Finanzas — mínimo y SEGURO.
 *
 * Su razón de ser es habilitar la instalación como app (WebAPK: standalone, con
 * ícono propio, sin barra del navegador). Estrategia NETWORK-FIRST: siempre
 * intenta la red y solo usa el caché como respaldo cuando NO hay conexión. Así
 * nunca sirve un index.html/asset viejo (evita el "pantallazo en blanco" por
 * caché obsoleto). skipWaiting + clients.claim + limpieza de cachés viejos hacen
 * que las actualizaciones tomen efecto de inmediato.
 */
const CACHE = 'dcdg-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    await self.clients.claim();
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      // Guarda una copia para respaldo offline (no bloquea la respuesta).
      if (res && res.ok && new URL(req.url).origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (_) {
      // Sin red: respaldo desde caché; para navegaciones, cae al shell "/".
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await caches.match('/');
        if (shell) return shell;
      }
      throw _;
    }
  })());
});
