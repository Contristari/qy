/* 减脂打卡 PWA service worker：离线可用，本地数据不出手机 */
const CACHE = 'jiansu-v1';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && new URL(req.url).origin === location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});

// 页面发来的通知请求（后台/锁屏通知）
self.addEventListener('message', (e) => {
  const data = e.data || {};
  if (data.type === 'notify') {
    const isWater = (data.tag || '').indexOf('water') === 0;
    const opts = {
      body: data.body || '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: data.tag || 'jiansu',
      renotify: true,
      vibrate: [200, 100, 200],
      data: { tag: data.tag || '' },
    };
    if (isWater) {
      opts.actions = [{ action: 'drink', title: '已喝一杯' }, { action: 'open', title: '打开记录' }];
    }
    self.registration.showNotification(data.title || '减脂打卡', opts).catch(() => {});
  }
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const action = e.action;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const msg = { type: action === 'drink' ? 'drink' : 'open' };
      let focused = null;
      for (const c of list) {
        if ('focus' in c) { c.postMessage(msg); c.focus(); focused = c; }
      }
      if (focused) return focused;
      return self.clients.openWindow('./index.html').then((w) => {
        if (w && w.postMessage) setTimeout(() => w.postMessage(msg), 1500);
        return w;
      });
    })
  );
});
