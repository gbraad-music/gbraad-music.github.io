// RFXLooper Service Worker
const CACHE_NAME = 'rfxlooper-v1';

self.addEventListener('install', (event) => {
    console.log('Service Worker installing.');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('Service Worker activating.');
});

self.addEventListener('fetch', (event) => {
    // Simple passthrough for now
    event.respondWith(fetch(event.request));
});
