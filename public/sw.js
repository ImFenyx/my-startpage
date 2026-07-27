/**
 * Service worker da Startpage.
 *
 * Sem isto, abrir a página sem rede dava tela branca — inaceitável para algo
 * que é a sua página inicial e cujo conteúdo já vive no localStorage.
 *
 * Estratégias:
 *   navegação    → network-first com fallback para o app shell em cache
 *   assets       → cache-first (têm hash no nome; nunca ficam obsoletos)
 *   fontes       → cache-first e imutáveis
 *   /api/img     → stale-while-revalidate (imagens da wishlist offline)
 *   /api/*       → network-only (dados sempre frescos; nunca cacheados)
 */
const VERSION = 'v3'
const SHELL = `startpage-shell-${VERSION}`
const ASSETS = `startpage-assets-${VERSION}`
const IMAGES = `startpage-img-${VERSION}`

const SHELL_URLS = ['/', '/index.html']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('startpage-') && !k.endsWith(VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

/** Limita o cache de imagens para não crescer sem fim. */
async function trim(cacheName, max) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  if (keys.length > max) {
    await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)))
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // dados nunca são servidos de cache — exceto imagens do proxy
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/img') {
      event.respondWith(
        caches.open(IMAGES).then(async (cache) => {
          const hit = await cache.match(request)
          const net = fetch(request)
            .then((res) => {
              if (res.ok) {
                cache.put(request, res.clone())
                trim(IMAGES, 120)
              }
              return res
            })
            .catch(() => hit ?? Response.error())
          return hit ?? net
        }),
      )
    }
    return
  }

  // navegação: rede primeiro (pega deploy novo), cache como rede de segurança
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(SHELL).then((c) => c.put('/index.html', copy))
          return res
        })
        .catch(async () => (await caches.match('/index.html')) ?? Response.error()),
    )
    return
  }

  // assets com hash no nome e fontes: cache-first
  if (/\.(js|css|woff2?|png|jpe?g|svg|webp|ico)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(ASSETS).then((c) => c.put(request, copy))
            }
            return res
          }),
      ),
    )
  }
})

/** Permite que a página force a ativação de uma versão nova. */
self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting()
})
