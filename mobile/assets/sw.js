// Service Worker for SpotiBase PWA
// Provides offline caching, background sync, and push notifications

const CACHE_NAME = 'spotibase-v1';
const STATIC_CACHE = 'spotibase-static-v1';
const DYNAMIC_CACHE = 'spotibase-dynamic-v1';
const AUDIO_CACHE = 'spotibase-audio-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

const CACHE_STRATEGIES = {
  // Cache first for static assets
  static: ['GET'],
  // Network first for API calls
  api: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  // Stale while revalidate for audio
  audio: ['GET'],
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      await cache.addAll(STATIC_ASSETS);

      // Precache the hashed JS/CSS bundles referenced by index.html so the
      // app shell is fully available on the very first offline visit.
      try {
        const htmlRes = await fetch('/index.html', { cache: 'no-cache' });
        const html = await htmlRes.text();
        const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
          .map((m) => m[1])
          .filter((p) => p.startsWith('/') && !p.startsWith('/api/'));
        const unique = [...new Set(refs)];
        await cache.addAll(unique).catch(() => {
          // addAll fails atomically if any resource 404s; cache what we can
          for (const ref of unique) {
            fetch(ref).then((r) => {
              if (r.ok) cache.put(ref, r);
            }).catch(() => {});
          }
        });

        // The web audio engine (shaka-player) is a dynamic chunk not listed
        // in index.html — find it inside the main bundle and precache it too.
        const mainBundle = unique.find((p) => p.startsWith('/_expo/') && p.endsWith('.js'));
        if (mainBundle) {
          const bundleRes = await fetch(mainBundle, { cache: 'no-cache' });
          const bundleText = await bundleRes.text();
          const chunks = [...bundleText.matchAll(/shaka-player-[a-f0-9]+\.js/g)]
            .map((m) => `/_expo/static/js/web/${m[0]}`);
          for (const chunk of [...new Set(chunks)]) {
            fetch(chunk).then((r) => {
              if (r.ok) cache.put(chunk, r);
            }).catch(() => {});
          }
        }
      } catch (err) {
        console.warn('[SW] shell precache skipped:', err);
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== STATIC_CACHE && name !== DYNAMIC_CACHE && name !== AUDIO_CACHE)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests for static caching
  if (request.method !== 'GET') {
    // Handle API mutations with network-only
    if (url.pathname.startsWith('/api/')) {
      event.respondWith(networkOnly(request));
    }
    return;
  }

  // App shell / navigation - network first, cached so the app works offline
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }

  // Static assets - cache first
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // API calls - network first with fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, DYNAMIC_CACHE));
    return;
  }

  // Audio files - stale while revalidate with range support
  if (isAudioRequest(url.pathname)) {
    event.respondWith(staleWhileRevalidateAudio(request));
    return;
  }

  // Default - network first
  event.respondWith(networkFirst(request, DYNAMIC_CACHE));
});

function isStaticAsset(pathname) {
  return (
    pathname.startsWith('/static/') ||
    pathname.startsWith('/_expo/') ||
    pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico|json)$/)
  );
}

function isAudioRequest(pathname) {
  return (
    pathname.includes('/songs/') && pathname.includes('/stream') ||
    pathname.match(/\.(mp3|m4a|aac|ogg|wav|flac)$/i)
  );
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    return new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function staleWhileRevalidateAudio(request) {
  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(request);

  // Return cached version immediately if available
  if (cached) {
    // Fetch fresh version in background
    fetch(request).then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
    }).catch(() => {});
    return cached;
  }

  // No cache - fetch from network
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return new Response('Audio unavailable offline', { status: 503 });
  }
}

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Network required' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-queue') {
    event.waitUntil(syncQueue());
  } else if (event.tag === 'sync-downloads') {
    event.waitUntil(syncDownloads());
  }
});

async function syncQueue() {
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: 'SYNC_QUEUE' });
  });
}

async function syncDownloads() {
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: 'SYNC_DOWNLOADS' });
  });
}

// Push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-72.png',
    vibrate: [100, 50, 100],
    data: data.data || {},
    actions: data.actions || [],
    requireInteraction: true,
    tag: data.tag || 'spotibase-notification',
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'play') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        if (clients.length > 0) {
          clients[0].postMessage({ type: 'PLAY_NOTIFICATION', data: event.notification.data });
          return clients[0].focus();
        }
        return self.clients.openWindow('/player');
      })
    );
  } else if (event.action === 'open') {
    event.waitUntil(
      self.clients.openWindow(event.notification.data?.url || '/')
    );
  } else {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        if (clients.length > 0) {
          return clients[0].focus();
        }
        return self.clients.openWindow('/');
      })
    );
  }
});

// Periodic background sync (if supported)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'update-library') {
    event.waitUntil(updateLibrary());
  }
});

async function updateLibrary() {
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: 'UPDATE_LIBRARY' });
  });
}

// Message handling from main thread
self.addEventListener('message', (event) => {
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data.type === 'CACHE_AUDIO') {
    cacheAudio(event.data.urls);
  } else if (event.data.type === 'CLEAR_CACHE') {
    clearCache(event.data.cacheName);
  }
});

async function cacheAudio(urls) {
  const cache = await caches.open(AUDIO_CACHE);
  await Promise.all(
    urls.map((url) => fetch(url).then((res) => cache.put(url, res)).catch(() => {}))
  );
}

async function clearCache(cacheName) {
  if (cacheName) {
    await caches.delete(cacheName);
  } else {
    await caches.delete(DYNAMIC_CACHE);
    await caches.delete(AUDIO_CACHE);
  }
}