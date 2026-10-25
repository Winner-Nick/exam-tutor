const SHELL_CACHE = 'exam-tutor-shell-v2'
const RUNTIME_CACHE = 'exam-tutor-runtime-v1'
const RUNTIME_LIMIT = 50
const CURRENT_CACHES = new Set([SHELL_CACHE, RUNTIME_CACHE])
const SHELL = ['/offline.html', '/offline.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('exam-tutor-') && !CURRENT_CACHES.has(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

async function putRuntime(request, response) {
  const cache = await caches.open(RUNTIME_CACHE)
  await cache.put(request, response)
  const keys = await cache.keys()
  await Promise.all(keys.slice(0, Math.max(0, keys.length - RUNTIME_LIMIT)).map((key) => cache.delete(key)))
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname === '/api' || url.pathname.startsWith('/api/')) return
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(SHELL_CACHE)
        return cache.match('/offline.html')
      }),
    )
    return
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    const pending = (async () => {
      const cached = await caches.match(request)
      if (cached) return { response: cached, cache: false }
      const response = await fetch(request)
      return { response, cache: response.ok }
    })()
    event.waitUntil(pending.then(({ response, cache }) => {
      if (cache) return putRuntime(request, response.clone())
      return undefined
    }).catch(() => undefined))
    event.respondWith(pending.then(({ response }) => response))
  }
})
