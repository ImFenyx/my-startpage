/**
 * Startpage — backend (Bun + Elysia)
 *
 *   bun run server        → http://localhost:8787
 *
 * Rotas:
 *   GET    /api/health
 *   GET    /api/scrape?url=…          metadados de produto (wishlist)
 *   GET    /api/img?url=…             proxy de imagem (hotlink/CORS)
 *   ALL    /api/todoist/*             proxy da Unified API v1 (fallback anti-adblock)
 *   GET    /api/sync                  todos os dados persistidos
 *   GET    /api/sync/:key             uma chave
 *   PUT    /api/sync/:key             grava uma chave (last-write-wins)
 *   POST   /api/sync                  grava várias chaves numa transação
 *   DELETE /api/sync/:key             apaga uma chave
 *   GET    /api/sync/:key/revisions   histórico (últimas 20 versões)
 *
 * Segurança: ver server/security.ts — CORS restrito, proteção contra SSRF,
 * rate limiting e limite de corpo de resposta.
 */
import { Elysia, t } from 'elysia'
import { cors } from '@elysiajs/cors'
import * as cheerio from 'cheerio'
import {
  abs,
  parsePrice,
  CURRENCY_RE,
  CURRENCY_SYMBOL,
  fromJsonLd,
  detectBlock,
  pickImage,
} from './scrape-lib'
import * as store from './db'
import {
  ALLOWED_ORIGINS,
  checkPublicUrl,
  createRateLimiter,
  readCapped,
  safeFetch,
  SAFE_IMAGE_TYPES,
  SECURITY_HEADERS,
} from './security'

const PORT = Number(Bun.env.PORT ?? 8787)
const TTL = 1000 * 60 * 30 // cache de scrape: 30 min

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** Cabeçalhos de navegador real — algumas lojas recusam requisições "cruas". */
const BROWSER_HEADERS: Record<string, string> = {
  'user-agent': UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'upgrade-insecure-requests': '1',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'cache-control': 'max-age=0',
}

type Scraped = {
  url: string
  title: string
  image: string
  price: string
  currency: string
  siteName: string
  favicon: string
  inStock: boolean
  blocked: boolean
  warnings: string[]
}

const cache = new Map<string, { at: number; data: Scraped }>()

// limites por IP: scraping é caro, sync é barato
const limitScrape = createRateLimiter(30, 60_000) // 30/min
const limitSync = createRateLimiter(600, 60_000) // 600/min

const app = new Elysia()
  .use(
    cors({
      origin: ALLOWED_ORIGINS,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: false,
      maxAge: 600,
    }),
  )

  // cabeçalhos de segurança em toda resposta
  .onAfterHandle(({ set }) => {
    Object.assign(set.headers, SECURITY_HEADERS)
  })

  .onError(({ code, error, set }) => {
    if (code === 'VALIDATION') {
      set.status = 400
      return { error: 'Parâmetros inválidos.' }
    }
    if (code === 'NOT_FOUND') {
      set.status = 404
      return { error: 'Rota não encontrada.' }
    }
    set.status = 502
    // não vazamos stack trace para o cliente
    const detail = String((error as Error)?.message ?? error).slice(0, 200)
    console.error('[erro]', detail)
    return { error: 'Falha na requisição', detail }
  })

  .get('/api/health', () => ({
    ok: true,
    service: 'startpage',
    runtime: `bun ${Bun.version}`,
    cache: cache.size,
    db: store.stats(),
  }))

  /* ───────────────────────── SCRAPE ───────────────────────── */

  .get(
    '/api/scrape',
    async ({ query, set, server, request }) => {
      const ip = server?.requestIP(request)?.address ?? 'local'
      const rl = limitScrape(ip)
      if (!rl.ok) {
        set.status = 429
        set.headers['retry-after'] = String(rl.retryAfter)
        return { error: `Muitas requisições. Tente em ${rl.retryAfter}s.` }
      }

      const target = query.url.trim()

      // bloqueia SSRF: localhost, redes privadas, metadata de cloud
      const check = await checkPublicUrl(target)
      if (!check.ok) {
        set.status = 400
        return { error: check.reason }
      }

      const hit = cache.get(target)
      if (hit && Date.now() - hit.at < TTL) {
        // LRU de verdade: reinsere para marcar como recém-usado
        cache.delete(target)
        cache.set(target, hit)
        return { ...hit.data, cached: true }
      }
      if (hit) cache.delete(target) // expirado

      // safeFetch revalida CADA redirect — sem isso, uma página pública pode
      // devolver 302 para 127.0.0.1 e contornar o filtro de SSRF.
      const res = await safeFetch(check.url, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) {
        set.status = 502
        return { error: `A loja respondeu HTTP ${res.status}`, detail: res.statusText }
      }

      // rejeita não-HTML e corpos gigantes antes de parsear
      const ctype = res.headers.get('content-type') ?? ''
      if (!/text\/html|application\/xhtml/i.test(ctype)) {
        set.status = 415
        return { error: `A URL não retornou HTML (${ctype.split(';')[0] || 'desconhecido'}).` }
      }

      const html = await readCapped(res)
      const $ = cheerio.load(html)
      const meta = (sel: string, attr = 'content') => $(sel).first().attr(attr)
      const host = check.url.hostname

      const blocked = detectBlock($, html, host)
      const ld = fromJsonLd($)

      const title =
        ld.title ||
        meta('meta[property="og:title"]') ||
        meta('meta[name="twitter:title"]') ||
        $('#productTitle').first().text().trim() ||
        $('h1').first().text().trim() ||
        $('title').text().trim()

      const image = pickImage($, ld.image, target)

      const outOfStockText =
        /(indisponível|esgotado|fora de estoque|sem estoque|out of stock|currently unavailable|no disponible)/i
      const bodyText = $('#availability, #outOfStock, [class*="availability" i], [class*="stock" i]')
        .first()
        .text()
      const inStock = ld.inStock ?? !(outOfStockText.test(bodyText) || outOfStockText.test(title))

      let rawPrice: unknown =
        ld.rawPrice ??
        meta('meta[property="product:price:amount"]') ??
        meta('meta[property="og:price:amount"]') ??
        meta('meta[itemprop="price"]') ??
        $('[itemprop="price"]').first().attr('content')

      if (rawPrice == null && inStock && !blocked) {
        const SPECIFIC = [
          '.a-price[data-a-color="base"] .a-offscreen',
          '#corePrice_feature_div .a-offscreen',
          '#priceblock_ourprice, #priceblock_dealprice',
          '.andes-money-amount__fraction',
          '[data-testid="price-part"] .andes-money-amount__fraction',
          '.product-price-value',
          '.pdp-comp-price-current .product-price-value',
          '.price--currentPriceText--V8_y_b5',
          '.product-price',
          '[data-testid="price"], [data-test="price"]',
          '[itemprop="price"]',
        ]
        for (const sel of SPECIFIC) {
          const el = $(sel).filter((_, e) => /\d/.test($(e).text())).first()
          if (el.length) {
            const txt = el.text().trim()
            if (txt) {
              rawPrice = txt
              break
            }
          }
        }
      }

      if (rawPrice == null && inStock && !blocked) {
        const el = $('[class*="price" i], [id*="price" i], [data-testid*="price" i]')
          .filter((_, e) => {
            const tx = $(e).text()
            return /\d/.test(tx) && CURRENCY_RE.test(tx) && tx.length < 60
          })
          .first()
        if (el.length) rawPrice = el.text().trim()
      }

      const rawCurrency =
        ld.currency ||
        meta('meta[property="product:price:currency"]') ||
        meta('meta[property="og:price:currency"]') ||
        meta('meta[itemprop="priceCurrency"]')

      const parsed = inStock ? parsePrice(rawPrice) : null

      const warnings: string[] = []
      if (blocked) warnings.push(blocked)
      if (!inStock) warnings.push('Produto indisponível — preço não capturado.')
      if (!parsed && inStock && !blocked) warnings.push('Preço não encontrado nesta página.')
      if (!image && !blocked) warnings.push('Imagem não encontrada.')

      const data: Scraped = {
        url: target,
        title: (title ?? '').replace(/\s+/g, ' ').trim().slice(0, 140),
        image,
        price: parsed?.price ?? '',
        currency:
          CURRENCY_SYMBOL[String(rawCurrency ?? '').toUpperCase()] ||
          parsed?.currency ||
          (/\.br$/i.test(host) ? 'R$' : ''),
        siteName: meta('meta[property="og:site_name"]') || host.replace(/^www\./, ''),
        favicon: `https://www.google.com/s2/favicons?sz=64&domain=${host}`,
        inStock,
        blocked: Boolean(blocked),
        warnings,
      }

      cache.set(target, { at: Date.now(), data })
      if (cache.size > 300) cache.delete(cache.keys().next().value!)
      return data
    },
    { query: t.Object({ url: t.String({ maxLength: 2048 }) }) },
  )

  /* ────────────────────── PROXY DE IMAGEM ────────────────────── */

  .get(
    '/api/img',
    async ({ query, set, server, request }) => {
      const ip = server?.requestIP(request)?.address ?? 'local'
      if (!limitScrape(ip).ok) {
        set.status = 429
        return 'rate limited'
      }

      const check = await checkPublicUrl(query.url)
      if (!check.ok) {
        set.status = 400
        return check.reason
      }

      const r = await safeFetch(check.url, {
        headers: { 'user-agent': UA, referer: check.url.origin },
        signal: AbortSignal.timeout(15_000),
      })
      if (!r.ok || !r.body) {
        set.status = 502
        return 'upstream error'
      }

      // Só formatos rasterizados: SVG é XML e pode carregar <script>, o que
      // seria XSS servido a partir do nosso próprio domínio.
      const ctype = (r.headers.get('content-type') ?? '').split(';')[0].trim()
      if (!SAFE_IMAGE_TYPES.test(ctype)) {
        set.status = 415
        return 'tipo de imagem não suportado'
      }

      return new Response(r.body, {
        headers: {
          'content-type': ctype,
          'cache-control': 'public, max-age=86400, immutable',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          ...SECURITY_HEADERS,
        },
      })
    },
    { query: t.Object({ url: t.String({ maxLength: 2048 }) }) },
  )

  /* ──────────────────── PROXY TODOIST ──────────────────── */

  .all('/api/todoist/*', async ({ request, params, set, server }) => {
    const ip = server?.requestIP(request)?.address ?? 'local'
    if (!limitSync(ip).ok) {
      set.status = 429
      return { error: 'Muitas requisições.' }
    }

    const auth = request.headers.get('authorization')
    if (!auth) {
      set.status = 401
      return { error: 'Header Authorization ausente.' }
    }

    // normaliza o caminho para impedir escapar do prefixo /api/v1/
    const rest = (params as Record<string, string>)['*'] ?? ''
    if (rest.includes('..') || rest.startsWith('/')) {
      set.status = 400
      return { error: 'Caminho inválido.' }
    }
    const path = rest.split('/').filter(Boolean).map(encodeURIComponent).join('/')

    const qs = new URL(request.url).search
    const target = `https://api.todoist.com/api/v1/${path}${qs}`

    const upstream = await fetch(target, {
      method: request.method,
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(),
      signal: AbortSignal.timeout(20_000),
    })

    set.status = upstream.status
    const text = await upstream.text()
    try {
      return text ? JSON.parse(text) : null
    } catch {
      return text
    }
  })

  /* ─────────────────────── SYNC (SQLite) ─────────────────────── */

  .guard(
    {
      beforeHandle({ set, server, request }) {
        const ip = server?.requestIP(request)?.address ?? 'local'
        if (!limitSync(ip).ok) {
          set.status = 429
          return { error: 'Muitas requisições.' }
        }
      },
    },
    (g) =>
      g
        /**
         * ETag: o cliente reenvia `If-None-Match` e recebe 304 quando nada
         * mudou. Como o pull roda a cada boot e o payload cresce com as notas,
         * isso evita transferir tudo à toa.
         */
        .get('/api/sync', ({ set, headers }) => {
          const etag = `W/"${store.latestStamp()}"`
          if (headers['if-none-match'] === etag) {
            set.status = 304
            return null
          }
          set.headers['etag'] = etag
          set.headers['cache-control'] = 'no-cache'
          return { entries: store.getAll(), serverTime: Date.now() }
        })

        /** Diagnóstico: chaves, datas e problemas detectados no sync. */
        .get('/api/sync/_debug', () => {
          const now = Date.now()
          return {
            serverTime: new Date(now).toISOString(),
            entries: store.getAll().map((e) => ({
              key: e.key,
              updatedAt: new Date(e.updatedAt).toISOString(),
              ageMinutes: Math.round((now - e.updatedAt) / 60_000),
              inFuture: e.updatedAt > now + 60_000,
              bytes: JSON.stringify(e.value).length,
            })),
            stats: store.stats(),
          }
        })

        .get(
          '/api/sync/:key',
          ({ params, set }) => {
            const e = store.get(params.key)
            if (!e) {
              set.status = 404
              return { error: 'Chave não encontrada.' }
            }
            return e
          },
          { params: t.Object({ key: t.String({ maxLength: 64 }) }) },
        )

        .get(
          '/api/sync/:key/revisions',
          ({ params }) => ({ revisions: store.revisions(params.key) }),
          { params: t.Object({ key: t.String({ maxLength: 64 }) }) },
        )

        .put(
          '/api/sync/:key',
          ({ params, body, set }) => {
            if (!store.ALLOWED_KEYS.has(params.key)) {
              set.status = 400
              return { error: `Chave "${params.key}" não é permitida.` }
            }
            const updatedAt = body.updatedAt ?? Date.now()
            const wrote = store.set(params.key, body.value, updatedAt)
            return { key: params.key, wrote, updatedAt, current: store.get(params.key) }
          },
          {
            params: t.Object({ key: t.String({ maxLength: 64 }) }),
            body: t.Object({ value: t.Unknown(), updatedAt: t.Optional(t.Number()) }),
          },
        )

        .post(
          '/api/sync',
          ({ body, set }) => {
            /**
             * Tolerante por design: chaves desconhecidas são IGNORADAS, não
             * derrubam o lote. Antes, uma única chave fora da allowlist fazia
             * o autosave inteiro responder 400 e as alterações válidas se
             * perdiam — bastava o cliente estar numa versão diferente do
             * servidor para tudo parar de sincronizar.
             */
            const accepted = body.entries.filter((e) => store.ALLOWED_KEYS.has(e.key))
            const ignored = body.entries
              .filter((e) => !store.ALLOWED_KEYS.has(e.key))
              .map((e) => e.key)

            const results = accepted.length
              ? store.setMany(
                  accepted.map((e) => ({
                    key: e.key,
                    value: e.value,
                    updatedAt: e.updatedAt ?? Date.now(),
                  })),
                )
              : {}

            if (ignored.length) console.warn('[sync] chaves ignoradas:', ignored.join(', '))
            return { results, ignored, serverTime: Date.now() }
          },
          {
            body: t.Object({
              entries: t.Array(
                t.Object({
                  key: t.String({ maxLength: 64 }),
                  value: t.Unknown(),
                  updatedAt: t.Optional(t.Number()),
                }),
                { maxItems: 50 },
              ),
            }),
          },
        )

        .delete(
          '/api/sync/:key',
          ({ params }) => {
            store.del(params.key)
            return { key: params.key, deleted: true }
          },
          { params: t.Object({ key: t.String({ maxLength: 64 }) }) },
        ),
  )

  .listen(PORT)

/**
 * Manutenção periódica do SQLite: sem isto o -wal cresce sem limite.
 * `unref()` para não segurar o processo aberto.
 */
setInterval(() => store.maintenance(), 10 * 60_000).unref()

// Conserta carimbos no futuro deixados por relógio errado ou dados de teste.
const reparados = store.repairFutureStamps()
if (reparados.length) {
  console.warn(
    `  ⚠ ${reparados.length} chave(s) com data no futuro corrigida(s): ` +
      reparados.map((r) => r.key).join(', '),
  )
}

console.log(
  `\n  \uf0e7  startpage  ·  bun ${Bun.version} + elysia + sqlite` +
    `\n     → http://localhost:${app.server?.port}` +
    `\n     db: ${store.stats().path}` +
    `\n     origins: ${ALLOWED_ORIGINS.join(', ')}\n`,
)
