const CACHE_NAME = 'meister-v700';
const ASSETS = [
    './',
    './index.html',
    './meister-controller.js',
    './regroove-pad.js',
    './manifest.json',
    './favicon.svg',
    // Action system files (v2.0)
    './input-actions.js',
    './action-dispatcher.js',
    './input-mapper.js',
    './meister-actions-integration.js',
    './settings-ui.js',
    // Scene system files
    './fader-components.js',
    './scene-manager.js',
    './svg-slider.js',
    './scene-editor.js',
    './effects-fader.js',
    './sequencer-engine.js',
    './sequencer-scene.js',
    './fill-dialog.js',
    './midi-sequence-utils.js',
    './non-blocking-dialog.js',
    './pad-knob.js',
    // Fire Sequencer scene
    './fire-sequencer-scene.js',
    // Device management
    './regroove-state.js',
    './device-manager.js',
    './input-router.js',
    // Display Message System
    './display-message-manager.js',
    './display-system-init.js',
    './adapters/basic-text-display-adapter.js',
    './adapters/fire-oled-adapter.js',
    './adapters/web-display-adapter.js',
    './components/display-widget.js',
    './components/fire-display.js',
    './components/sequencer-display.js',
    './components/piano-keyboard.js',
    './utils/display-message-builder.js'
];

// Install event - cache assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('Caching app assets');
            return cache.addAll(ASSETS);
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
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch event - CACHE FIRST (offline-first, reliable on flaky networks)
self.addEventListener('fetch', (event) => {
    // Skip caching external resources
    if (!event.request.url.startsWith(self.location.origin)) {
        return;
    }

    event.respondWith(
        // Try cache FIRST for instant response
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                // Serve from cache immediately (offline-first)
                console.log('[ServiceWorker] Serving from cache:', event.request.url);

                // Update cache in background (stale-while-revalidate)
                fetch(event.request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, networkResponse.clone());
                        });
                    }
                }).catch(() => {
                    // Network failed, but we already served from cache, so ignore
                });

                return cachedResponse;
            }

            // Not in cache, try network
            return fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // Network failed and not in cache - offline fallback
                if (event.request.destination === 'document') {
                    return caches.match('./index.html');
                }
                return new Response('Offline', {
                    status: 503,
                    statusText: 'Service Unavailable',
                    headers: new Headers({
                        'Content-Type': 'text/plain'
                    })
                });
            });
        })
    );
});
