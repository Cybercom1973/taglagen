const CACHE_NAME = 'taglage-v8';

const urlsToCache = [
  './',
  './index. html',
  './train.html',
  './css/style.css',
  './js/app. js',
  './js/train.js',
  './js/api.js'
];

self. addEventListener('install', function(event) {
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      // Hämta och cacha varje fil individuellt
      return Promise.allSettled(
        urlsToCache. map(url => {
          return fetch(url).then(response => {
            if (response.ok) {
              return cache.put(url, response);
            }
            console.warn('Fil hittades inte:', url, response.status);
          }). catch(err => {
            console.warn('Kunde inte hämta fil:', url, err);
          });
        })
      );
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim());
  
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames. filter(name => name !== CACHE_NAME). map(name => caches.delete(name))
      );
    })
  );
});

self.addEventListener('fetch', function(event) {
  if (event.request. url.includes('api.trafikinfo. trafikverket. se')) return;

  event.respondWith(
    fetch(event.request).catch(() => caches. match(event.request))
  );
});