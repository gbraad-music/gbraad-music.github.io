const CACHE_NAME = 'device-controller-v61';
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './components/pad-knob.js',
  './components/device-loader.js',
  './components/controller.js',
  './components/motion-sequencer.js',
  './components/parameter-manager.js',
  './manifest.json',
  './devices.json',
  './icons/favicon.svg',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  './devices/microaudio-722.json',
  './devices/nts1-mkii.json',
  './devices/nts3-kaoss.json',
  './devices/microkorg2.json',
  './devices/drumlogue.json',
  './devices/volca-kick.json',
  './devices/volca-fm.json',
  './devices/volca-sample2.json'
];

// Install service worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch from cache, fallback to network
self.addEventListener('fetch', event => {
  // Always fetch fresh device JSON files
  if (event.request.url.includes('/devices/') && event.request.url.endsWith('.json')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request);
      }
    )
  );
});

// Activate and clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
