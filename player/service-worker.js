const CACHE_NAME = 'rfx-player-v1';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './deck-player.js',
    './deck-player.wasm',
    './regroove-effects.js',
    './regroove-effects.wasm',
    '../replugged/styles.css',
    '../replugged/favicon.svg',
    '../replugged/favicon-96x96.png',
    '../replugged/apple-touch-icon.png',
    '../replugged/player.js',
    '../replugged/components/pad-knob.js',
    '../replugged/components/svg-slider.js',
    '../replugged/components/fader-components.js',
    '../replugged/components/vu-meter.js',
    '../replugged/components/waveform-display.js',
    '../replugged/components/spectrum-analyzer.js',
    '../replugged/components/freq-bars-analyzer.js',
    '../replugged/worklets/audio-worklet-processor.js',
    '../replugged/external/wakelock.js',
    '../replugged/external/frequency-analyzer.js',
    '../replugged/external/audio-viz.js'
];

// Install event - cache assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[ServiceWorker] Caching player assets');
            return Promise.allSettled(
                ASSETS.map(url =>
                    cache.add(url).catch(err => {
                        console.warn('[ServiceWorker] Failed to cache:', url, err.message);
                    })
                )
            );
        })
    );
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[ServiceWorker] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch event - CACHE FIRST
self.addEventListener('fetch', (event) => {
    if (!event.request.url.startsWith(self.location.origin)) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                console.log('[ServiceWorker] Serving from cache:', event.request.url);
                fetch(event.request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, networkResponse.clone());
                        });
                    }
                }).catch(() => {});
                return cachedResponse;
            }

            return fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(() => {
                if (event.request.destination === 'document') {
                    return caches.match('./index.html');
                }
                return new Response('Offline', {
                    status: 503,
                    statusText: 'Service Unavailable',
                    headers: new Headers({ 'Content-Type': 'text/plain' })
                });
            });
        })
    );
});
