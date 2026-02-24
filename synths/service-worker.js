const CACHE_NAME = 'rfx-synths-v19';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './rgresonate1.js',
    './rgresonate1.wasm',
    './rgahxsynth.js',
    './rgahxsynth.wasm',
    './rgsidsynth.js',
    './rgsidsynth.wasm',
    './rg1piano.js',
    './rg1piano.wasm',
    './rg909-drum.js',
    './rg909-drum.wasm',
    './rgahxdrum.js',
    './rgahxdrum.wasm',
    './rgslicer.js',
    './rgslicer.wasm',
    './rvkeys.js',
    './rvkeys.wasm',
    './rvbass.js',
    './rvbass.wasm',
    '../replugged/style.css',
    '../replugged/favicon.svg',
    '../replugged/favicon-96x96.png',
    '../replugged/apple-touch-icon.png',
    '../replugged/synth.js',
    '../replugged/synth-registry.js',
    '../replugged/synth-ui.js',
    '../replugged/components/piano-keyboard.js',
    '../replugged/components/svg-slider.js',
    '../replugged/components/fader-components.js',
    '../replugged/components/vu-meter.js',
    '../replugged/components/waveform-display.js',
    '../replugged/components/spectrum-analyzer.js',
    '../replugged/components/freq-bars-analyzer.js',
    '../replugged/components/motion-sequencer.js',
    '../replugged/components/rvkeys-ui.js',
    '../replugged/components/rvbass-ui.js',
    '../replugged/worklets/synth-worklet-processor.js',
    '../replugged/worklets/drum-worklet-processor.js',
    '../replugged/external/midi-rtc/midi-codec.js',
    '../replugged/external/midi-rtc/midi-utils.js',
    '../replugged/external/midi-rtc/protocol.js',
    '../replugged/external/remote-channel.js',
    '../replugged/external/midi-rtc-bridge.js',
    '../replugged/external/webrtc-midi-source.js',
    '../replugged/external/midi-manager.js',
    '../replugged/external/frequency-analyzer.js',
    '../replugged/external/audio-viz.js',
    '../replugged/external/wakelock.js',
    '../replugged/external/midi-audio-synth.js',
    '../replugged/external/rgresonate1-synth.js',
    '../replugged/external/rgahxsynth-synth.js',
    '../replugged/external/rgsid-synth.js',
    '../replugged/external/rg1piano-synth.js',
    '../replugged/external/rg909-drum.js',
    '../replugged/external/rgsfz-synth.js',
    '../replugged/external/rgahxdrum.js',
    '../replugged/external/rgslicer-synth.js',
    '../replugged/external/rvkeys-synth.js',
    '../replugged/external/rvbass-synth.js',
    '../data/sid_user_presets.txt'
];

// Install event - cache assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[ServiceWorker] Caching synth assets');
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
