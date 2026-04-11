const CACHE_NAME = 'rfx-record-v1';
const urlsToCache = [
  './index.html',
  './recorder.js',
  './manifest.json',
  '../replugged/style.css',
  '../replugged/components/svg-slider.js',
  '../replugged/components/vu-meter.js',
  '../replugged/components/waveform-display.js',
  '../replugged/components/spectrum-analyzer.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
