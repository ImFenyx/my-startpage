/**
 * Startpage — backend (Bun + Elysia)
 *
 *   bun run server        → http://localhost:8787
 *
 * Rotas:
 *   GET    /api/health
 *   GET    /api/scrape?url=…          metadados de produto (wishlist)
 *   POST   /api/wishlist/refresh      dispara o vigia de preços agora (rodada manual)
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
import { scrapeProduct, ScrapeError, UA } from './scrape-product'
import type { Scraped } from './scrape-product'
import {
  DEFAULT_INTERVAL_MS,
  refreshWishlistPrices,
  type RefreshReport,
} from './price-watch'
import * as store from './db'
import {
  ALLOWED_ORIGINS,
  checkPublicUrl,
  createRateLimiter,
  safeFetch,
  SAFE_IMAGE_TYPES,
  SECURITY_HEADERS,
} from './security'

const PORT = Number(Bun.env.PORT ?? 8787)
const TTL = 1000 * 60 * 30 // cache de scrape: 30 min

const cache = new Map<string, { at: number; data: Scraped }>()

// limites por IP: scraping é caro, sync é barato
const limitScrape = createRateLimiter(30, 60_000) // 30/min
const limitSync = createRateLimiter(600, 60_000) // 600/min
const limitRefresh = createRateLimiter(2, 5 * 60_000) // gatilho manual: 2 a cada 5 min

/* ──────────────── VIGIA DE PREÇOS DA WISHLIST ──────────────── */

/**
 * Atualiza os preços dos itens com URL direto no SQLite de sync; o front
 * puxa na próxima reconciliação. Cadência padrão: 2× por semana (84 h).
 *
 *   WISHLIST_REFRESH_HOURS=168   uma vez por semana
 *   WISHLIST_REFRESH_HOURS=0     desliga o agendador (o gatilho manual
 *                                POST /api/wishlist/refresh continua valendo)
 */
const parsedRefreshHours = Number(Bun.env.WISHLIST_REFRESH_HOURS ?? DEFAULT_INTERVAL_MS / 3_600_000)
const REFRESH_HOURS =
  Number.isFinite(parsedRefreshHours) && parsedRefreshHours >= 0
    ? parsedRefreshHours
    : DEFAULT_INTERVAL_MS / 3_600_000
let refreshRunning = false
let lastRefresh: RefreshReport | null = null

async function runPriceRefresh(force: boolean): Promise<void> {
  if (refreshRunning) return
  refreshRunning = true
  try {
    const res = await refreshWishlistPrices({
      store,
      scrape: scrapeProduct,
      force,
      intervalMs: REFRESH_HOURS * 3_600_000,
      log: (m) => console.warn(`  [preços] ${m}`),
    })
    if (res.ran) {
      lastRefresh = res.report
      const r = res.report
      console.log(
        `  [preços] ${r.updated}/${r.checked} preços atualizados` +
          (r.outOfStock ? ` · ${r.outOfStock} fora de estoque` : '') +
          (r.failed.length ? ` · falhas: ${r.failed.join(', ')}` : ''),
      )
    }
  } catch (e) {
    console.warn('  [preços] rodada abortada:', (e as Error)?.message ?? e)
  } finally {
    refreshRunning = false
  }
}

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
    // o front consulta isto para acompanhar uma rodada manual de preços
    wishlistPrices: {
      running: refreshRunning,
      intervalHours: REFRESH_HOURS,
      last: lastRefresh,
    },
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

      const hit = cache.get(target)
      if (hit && Date.now() - hit.at < TTL) {
        // LRU de verdade: reinsere para marcar como recém-usado
        cache.delete(target)
        cache.set(target, hit)
        return { ...hit.data, cached: true }
      }
      if (hit) cache.delete(target) // expirado

      try {
        const data = await scrapeProduct(target)
        cache.set(target, { at: Date.now(), data })
        if (cache.size > 300) cache.delete(cache.keys().next().value!)
        return data
      } catch (e) {
        if (e instanceof ScrapeError) {
          set.status = e.status
          return e.detail ? { error: e.message, detail: e.detail } : { error: e.message }
        }
        throw e // inesperado: cai no onError (502 genérico)
      }
    },
    { query: t.Object({ url: t.String({ maxLength: 2048 }) }) },
  )

  /* ─────────── GATILHO MANUAL DO VIGIA DE PREÇOS ─────────── */

  /**
   * Roda a atualização de preços em segundo plano e responde 202 na hora —
   * uma rodada com 20 itens leva minutos. O front acompanha o progresso
   * pelo campo `wishlistPrices` do /api/health e puxa o sync ao final.
   */
  .post('/api/wishlist/refresh', ({ set, server, request }) => {
    const ip = server?.requestIP(request)?.address ?? 'local'
    const rl = limitRefresh(ip)
    if (!rl.ok) {
      set.status = 429
      set.headers['retry-after'] = String(rl.retryAfter)
      return { error: `Muitas requisições. Tente em ${rl.retryAfter}s.` }
    }
    if (refreshRunning) {
      set.status = 409
      return { error: 'Uma atualização de preços já está em andamento.' }
    }
    void runPriceRefresh(true)
    set.status = 202
    return { started: true }
  })

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

/**
 * Agendador do vigia de preços. Padrão "verifica e roda" em vez de agendar
 * o horário exato: sobrevive a suspensão do processo e ao --watch. A
 * primeira verificação sai 12 s após o boot para não competir com a subida
 * do servidor — se a última rodada já venceu, atualiza na hora.
 */
if (Number.isFinite(REFRESH_HOURS) && REFRESH_HOURS > 0) {
  const tick = () => void runPriceRefresh(false)
  setTimeout(tick, 12_000).unref()
  setInterval(tick, 30 * 60_000).unref()
}

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
