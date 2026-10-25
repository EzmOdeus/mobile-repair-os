/* Service Worker — Mobile Repair OS
 * استراتيجية التخزين:
 * - التنقل: الشبكة أولًا، وعند الفشل صفحة عدم الاتصال المحلية.
 * - أصول Next والأيقونات: الشبكة أولًا مع الرجوع للنسخة المخزنة.
 * - لا يُخزَّن أي طلب API أو بيانات مستأجرين في Cache Storage.
 * غيّر VERSION عند تغيير قائمة precache لإبطال النسخ القديمة.
 */
const VERSION = 'mros-pwa-v1';
const SHELL_CACHE = `mros-shell-${VERSION}`;
const RUNTIME_CACHE = `mros-runtime-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const PRECACHE = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('mros-') && key !== SHELL_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, fallback) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(request);
    return cached ?? fallback();
  }
}

async function cacheNetworkResponse(request) {
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/webpack-hmr')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request, async () => {
        const offline = await caches.match(OFFLINE_URL);
        return (
          offline ??
          new Response('<h1>لا يوجد اتصال</h1>', {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        );
      }),
    );
    return;
  }

  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest'
  ) {
    event.respondWith(
      networkFirst(request, async () => caches.match(request).then((cached) => cached ?? Response.error())),
    );
    return;
  }

  if (request.destination === 'image' || request.destination === 'font' || url.pathname.startsWith('/uploads/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = cacheNetworkResponse(request).catch(() => cached ?? Response.error());
        return cached ?? network;
      }),
    );
  }
});
