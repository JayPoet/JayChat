/* JayChat service worker: offline app shell + push handling.
 * Bump VERSION whenever you deploy a new index.html so clients refresh the shell. */
const VERSION = 'jaychat-v2';
const SHELL = ['./', './index.html', './manifest.json', './icon.svg', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  // Firebase SDK modules are versioned and immutable: cache-first so the app starts offline.
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return; // never touch Firestore / Storage / Auth traffic
  // Page navigations: network first, fall back to the cached shell.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put('./index.html', copy)); return res; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  // Other same-origin files: stale-while-revalidate.
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(req);
    const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});

/* Push (optional, needs the Cloud Function in SETUP.md). Payload is generic because messages are encrypted. */
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { }
  const data = d.data || d;
  e.waitUntil(self.registration.showNotification(data.title || 'JayChat', {
    body: data.body || 'New message', tag: data.chat || 'jaychat', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { chat: data.chat }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const chat = e.notification.data && e.notification.data.chat;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) { c.focus(); if (chat) c.postMessage({ chat }); return; } }
    return self.clients.openWindow(chat ? './#/chat/' + encodeURIComponent(chat) : './');
  }));
});
