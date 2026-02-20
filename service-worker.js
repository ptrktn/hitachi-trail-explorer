const STATIC_CACHE = 'static-v1';
const CORE_FILES = [ '/', '/index.html', '/app.js', '/manifest.json', '/images/icon192.png', '/styles.css' // if you have one ];

// self.addEventListener('install', event => {
//  self.skipWaiting();
// });

self.addEventListener('install', event => { 
  event.waitUntil( caches.open(STATIC_CACHE).then(cache => cache.addAll(CORE_FILES)) ); 
});

self.addEventListener('activate', event => {
  clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(res => res || fetch(event.request))
  );
});

self.addEventListener('message', async event => {
  if (event.data?.type === 'CACHE_FILES') {
    const cache = await caches.open(STATIC_CACHE);
    const cachedRequests = await cache.keys();
    const cachedUrls = cachedRequests.map(request => request.url);
    const filesToCache = event.data.files.filter(file => !cachedUrls.includes(file));
    await cache.addAll(filesToCache);
  }
});
