// SpendWise service worker v2.
// Network-first for the app shell (so new deployments show up immediately);
// cache is only a fallback for offline use. Static icons are cache-first.
const CACHE = 'spendwise-v10'

self.addEventListener('install', (e) => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  // Never touch Supabase or FX API calls — data must be fresh.
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('frankfurter.dev') || url.hostname.endsWith('frankfurter.app')) {
    return
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return

  const isShell = e.request.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/manifest.webmanifest')
  if (isShell) {
    // NETWORK FIRST: always try to get the newest version; fall back to cache offline.
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone()
          if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, copy))
          return res
        })
        .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
    )
  } else {
    // Static assets (icons, hashed bundles): cache first.
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            const copy = res.clone()
            if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, copy))
            return res
          })
      )
    )
  }
})
