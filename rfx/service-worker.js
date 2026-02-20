const CACHE_NAME = 'rfx-effects-v202';
const ASSETS = [
    './',
    './index.html',
    './player.html',
    './synth.html',
    './styles.css',
    './manifest.json',
    './favicon.svg',
    './favicon.ico',
    './favicon-96x96.png',
    './apple-touch-icon.png',
    './icon-192x192.png',
    './icon-512x512.png',
    './player.js',
    './synth.js',
    './players/regroove-effects.js',
    './players/regroove-effects.wasm',
    // Web UI components
    './components/pad-knob.js',
    './components/svg-slider.js',
    './components/fader-components.js',
    './components/vu-meter.js',
    './components/waveform-display.js',
    './components/spectrum-analyzer.js',
    './components/piano-keyboard.js',
    // AudioWorklet processors
    './worklets/audio-worklet-processor.js',
    './worklets/synth-worklet-processor.js',
    // Unified Deck Player (MOD/MED/AHX/SID with automatic detection)
    './players/deck-player.js',
    './players/deck-player.wasm',
    // Synth UI system (auto-generation)
    './synth-registry.js',
    './synth-ui.js',
    // Synth test page dependencies
    './external/midi-rtc/midi-codec.js',
    './external/midi-rtc/midi-utils.js',
    './external/remote-channel.js',
    './external/midi-rtc-bridge.js',
    './external/webrtc-midi-source.js',
    './external/midi-manager.js',
    './external/frequency-analyzer.js',
    './external/midi-audio-synth.js',
    './external/rgresonate1-synth.js',
    './external/rgahxsynth-synth.js',
    './external/rgsid-synth.js',
    './external/rg1piano-synth.js',
    './external/rg909-drum.js',
    './external/rgsfz-synth.js',
    './external/rgahxdrum.js',
    './external/rgslicer-synth.js',
    './synths/drum-worklet-processor.js',
    './synths/rgresonate1-synth.js',
    './synths/rgresonate1-synth.wasm',
    './synths/rgahxsynth.js',
    './synths/rgahxsynth.wasm',
    './synths/rgsidsynth.js',
    './synths/rgsidsynth.wasm',
    './synths/rg1piano.js',
    './synths/rg1piano.wasm',
    './synths/rg909-drum.js',
    './synths/rg909-drum.wasm',
    './synths/rgsfz-player.js',
    './synths/rgsfz-player.wasm',
    './synths/rgslicer.js',
    './synths/rgslicer.wasm',
    // Preset data files
    './data/sid_presets.h'
];

// Install event - cache assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[ServiceWorker] Caching app assets');
            // Cache files individually to avoid failure if one file is missing
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
