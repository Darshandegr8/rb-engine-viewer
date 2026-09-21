/* Shell + app-bundle cache. The .glb is cached by the page itself (Cache API, with progress),
   so this worker deliberately never touches it. Bump VERSION to ship a new shell. */
var VERSION = 'rb-engine-shell-v1';
var PRECACHE = [
  './', './index.html',
  './app/main.js'          // lazy chunks (meshopt decoder) are cached at runtime on first use
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (c) {
      return Promise.all(PRECACHE.map(function (u) {
        return c.add(u).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('rb-engine-shell-') === 0 && k !== VERSION; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  var url = new URL(req.url);
  if (/\.glb$/i.test(url.pathname)) return;                       // model handled by the page

  if (url.origin === self.location.origin) {                      // own files: instant from cache, refresh in background
    e.respondWith(caches.open(VERSION).then(function (c) {
      return c.match(req, { ignoreSearch: true }).then(function (hit) {
        var net = fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; }).catch(function () { return hit; });
        return hit || net;
      });
    }));
  }
});
