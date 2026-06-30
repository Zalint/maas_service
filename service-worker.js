const CACHE_NAME = 'mata-pos-v15';
const urlsToCache = [
  '/pos.html',
  '/pos.css',
  '/pos-mobile.css',
  '/pos.js',
  '/pos-modal-details.js',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/js/bootstrap.bundle.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'
];

// Install Service Worker
self.addEventListener('install', event => {
  console.log('Service Worker: Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Caching files');
        return cache.addAll(urlsToCache);
      })
      .catch(err => console.log('Service Worker: Cache failed', err))
  );
  self.skipWaiting();
});

// Activate Service Worker
self.addEventListener('activate', event => {
  console.log('Service Worker: Activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('Service Worker: Clearing old cache');
            return caches.delete(cache);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Fetch Strategy: Network First, falling back to Cache
self.addEventListener('fetch', event => {
  const { request } = event;
  
  // Skip chrome-extension:// and other non-http(s) requests
  if (!request.url.startsWith('http')) {
    return;
  }
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // For API calls, always try network first
  if (request.url.includes('/api/')) {
    event.respondWith(
      fetch(request)
        .catch(() => {
          return new Response(
            JSON.stringify({ error: 'Connexion réseau perdue. Mode hors ligne.' }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        })
    );
    return;
  }

  // For static assets, use cache first, then network
  event.respondWith(
    caches.match(request)
      .then(cached => {
        // Return cached version or fetch new
        const networked = fetch(request)
          .then(response => {
            // Only cache valid responses
            if (!response || response.status !== 200 || response.type === 'error') {
              return response;
            }
            
            // Cache the new version
            const responseClone = response.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                // Only cache http/https requests
                if (request.url.startsWith('http')) {
                  cache.put(request, responseClone);
                }
              })
              .catch(err => {
                console.log('Cache put error:', err);
              });
            return response;
          })
          .catch(() => cached); // If fetch fails, return cached version

        return cached || networked;
      })
  );
});

// Background Sync (for offline transactions)
self.addEventListener('sync', event => {
  console.log('Service Worker: Background sync', event.tag);
  if (event.tag === 'sync-transactions') {
    event.waitUntil(syncTransactions());
  }
});

async function syncTransactions() {
  // This would sync any pending transactions when connection is restored
  console.log('Service Worker: Syncing pending transactions...');
  // Implementation would go here
}

// Push Notifications (optional for future)
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'MATA POS';
  const options = {
    body: data.body || 'Nouvelle notification',
    icon: '/image/icon-192x192.png',
    badge: '/image/icon-72x72.png',
    vibrate: [200, 100, 200],
    data: data.url || '/pos.html'
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data)
  );
});

