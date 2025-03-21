const CACHE_NAME = 'packaging-app-v1';
const ASSETS_TO_CACHE = [
  '/Packaging-App-Code/',
  '/Packaging-App-Code/index.html',
  '/Packaging-App-Code/styles.css',
  '/Packaging-App-Code/app.js',
  '/Packaging-App-Code/firebase-config.js',
  '/Packaging-App-Code/icons/web-app-manifest-192x192.png',
  '/Packaging-App-Code/icons/web-app-manifest-512x512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(ASSETS_TO_CACHE);
      })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        return response || fetch(event.request);
      })
  );
});