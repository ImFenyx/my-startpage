/**
 * Vigia de preços da wishlist.
 *
 * A wishlist mora no próprio servidor: o sync espelha a chave
 * `wishlist:items` no SQLite (ver db.ts). Este módulo relê essa cópia,
 * refaz o scraping dos itens abertos que têm URL e grava os preços com um
 * carimbo por item (`priceUpdatedAt`). Na próxima reconciliação o front
 * puxa a versão mais nova — nenhuma ação do usuário necessária.
 *
 * Cadência padrão: a cada 84 h (2× por semana), configurável por
 * `WISHLIST_REFRESH_HOURS`. Se uma rodada inteira falhar (rede fora, loja
 * bloqueando), a próxima tentativa sai em 8 h em vez de esperar o ciclo.
 *
 * O núcleo é injetável (store + scrape como parâmetros) para rodar nos
 * testes sem rede nem SQLite; o agendador real é montado em index.ts.
 */

export const ITEMS_KEY = 'wishlist:items'

/**
 * Relatório da última rodada, persistido numa chave só do servidor: NÃO está
 * na allowlist de sync (db.ts), então nenhum cliente consegue sobrescrevê-la
 * — mas ela aparece no payload de /api/sync, onde o front a ignora.
 */
export const STAMP_KEY = 'wishlist:pricesAt'

/** 84 horas = 2× por semana. */
export const DEFAULT_INTERVAL_MS = 84 * 3_600_000

/** Rodada sem nenhum preço extraído? Algo está errado — repete bem antes. */
export const RETRY_AFTER_FAILURE_MS = 8 * 3_600_000

/** Pausa entre lojas para não parecer ataque (e evitar ban de IP). */
const DEFAULT_DELAY_MS = 2_500

/** Teto de itens por rodada — uma wishlist pessoal não passa disso. */
const MAX_ITEMS_PER_RUN = 50

/** Subconjunto do item que interessa ao vigia; o resto é repassado intacto. */
export type WishlistItem = {
  id: string
  url?: string
  price?: string
  currency?: string
  done?: boolean
  priceUpdatedAt?: number
  [k: string]: unknown
}

/** O que o vigia precisa saber de um scrape (Scraped satisfaz isto). */
export type ScrapeResult = {
  price: string // '' quando não achou
  currency: string // '' quando desconhecida
  inStock: boolean
  blocked: boolean
}

export type StoreLike = {
  get(key: string): { value: unknown; updatedAt: number } | null
  set(key: string, value: unknown, updatedAt?: number): boolean
}

export type RefreshReport = {
  ranAt: number
  checked: number
  /** itens cujo preço foi (re)confirmado por scrape */
  updated: number
  outOfStock: number
  /** hosts que falharam (erro, bloqueio ou preço ausente) — até 10 */
  failed: string[]
}

export type RefreshOutcome =
  | { ran: true; report: RefreshReport }
  | { ran: false; reason: string }

export type RefreshDeps = {
  store: StoreLike
  scrape: (url: string) => Promise<ScrapeResult>
  /** ignora a cadência (gatilho manual via POST /api/wishlist/refresh) */
  force?: boolean
  intervalMs?: number
  delayMs?: number
  now?: () => number
  log?: (msg: string) => void
}

/**
 * "8499" → "8.499,00" — o front espera o preço formatado em pt-BR (o total
 * do slide faz o parse inverso). Não usamos `toLocaleString` porque o
 * suporte a ICU do runtime varia; isto é determinístico.
 */
export function formatPtBR(n: number): string {
  const [int, dec] = n.toFixed(2).split('.')
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`
}

/**
 * Em quantos ms a próxima rodada vence (0 = já pode rodar).
 * Função pura para o agendador decidir sem ler o store.
 */
export function msUntilDue(last: RefreshReport | null, intervalMs: number, now: number): number {
  if (!last) return 0
  // rodou, extraiu nada e ainda houve falha = rede/bloqueio: encurta a espera
  const wait =
    last.checked > 0 && last.updated === 0 && last.failed.length > 0
      ? Math.min(intervalMs, RETRY_AFTER_FAILURE_MS)
      : intervalMs
  return Math.max(0, last.ranAt + wait - now)
}

/**
 * Reaplica os preços (casamento por id) numa versão qualquer da lista.
 * Devolve null quando NENHUM id casa — sinal de que a lista mudou demais
 * e escrever por cima traria itens apagados de volta.
 */
export function applyPriceUpdates(
  items: unknown,
  updates: Map<string, { price: string; currency?: string; priceUpdatedAt: number }>,
): unknown[] | null {
  if (!Array.isArray(items)) return null
  let touched = false
  const out = items.map((it) => {
    const u = it && typeof it === 'object' ? updates.get((it as WishlistItem).id) : undefined
    if (!u) return it
    touched = true
    return { ...it, ...u }
  })
  return touched ? out : null
}

/** Executa (ou adia) uma rodada de atualização de preços. */
export async function refreshWishlistPrices(deps: RefreshDeps): Promise<RefreshOutcome> {
  const { store, scrape } = deps
  const now = deps.now ?? Date.now
  const log = deps.log ?? (() => {})
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS
  const delayMs = deps.delayMs ?? DEFAULT_DELAY_MS

  if (!deps.force) {
    const last = readReport(store.get(STAMP_KEY)?.value)
    const wait = msUntilDue(last, intervalMs, now())
    if (wait > 0) {
      return { ran: false, reason: `cedo demais — próxima rodada em ${Math.ceil(wait / 3_600_000)} h` }
    }
  }

  const entry = store.get(ITEMS_KEY)
  const items = Array.isArray(entry?.value) ? (entry.value as WishlistItem[]) : null
  if (!items) return { ran: false, reason: 'wishlist vazia' }

  // conquistados não precisam de vigilância de preço — poupa a loja e a rede
  const eligible = items.filter(
    (i) => i && typeof i === 'object' && typeof i.url === 'string' && /^https?:\/\//i.test(i.url) && !i.done,
  )
  if (!eligible.length) return { ran: false, reason: 'nenhum item aberto com URL' }

  const target = eligible.slice(0, MAX_ITEMS_PER_RUN)
  if (eligible.length > target.length) {
    log(`wishlist tem ${eligible.length} itens elegíveis — processando os ${MAX_ITEMS_PER_RUN} primeiros`)
  }

  const updates = new Map<string, { price: string; currency?: string; priceUpdatedAt: number }>()
  const failed: string[] = []
  let outOfStock = 0

  for (const [idx, it] of target.entries()) {
    // sequencial com pausa: gentil com a loja e com o rate limit dos sites
    if (idx > 0 && delayMs > 0) await sleep(delayMs + Math.floor(Math.random() * delayMs * 0.6))
    try {
      const d = await scrape(it.url!)
      if (!d.inStock) {
        // mantém o último preço conhecido; o carimbo NÃO avança (não foi confirmado)
        outOfStock++
        continue
      }
      const price = Number(d.price)
      if (d.blocked || !d.price || !Number.isFinite(price) || price <= 0) {
        failed.push(hostOf(it.url!))
        continue
      }
      updates.set(it.id, {
        price: formatPtBR(price),
        ...(d.currency ? { currency: d.currency } : {}),
        priceUpdatedAt: now(),
      })
    } catch (e) {
      failed.push(hostOf(it.url!))
      log(`falha em ${hostOf(it.url!)}: ${String((e as Error)?.message ?? e).slice(0, 80)}`)
    }
  }

  const report: RefreshReport = {
    ranAt: now(),
    checked: target.length,
    updated: updates.size,
    outOfStock,
    failed: failed.slice(0, 10),
  }

  if (updates.size) {
    /**
     * Last-write-wins sozinho não basta: uma edição do usuário PODE ter
     * chegado enquanto raspávamos (uma rodada leva minutos). Relemos a
     * chave e, se ela mudou, reaplicamos só os campos de preço por id —
     * o resto do documento novo (item apagado, nome editado) é preservado.
     */
    const fresh = store.get(ITEMS_KEY)
    const base =
      fresh && fresh.updatedAt !== entry!.updatedAt && Array.isArray(fresh.value)
        ? (fresh.value as WishlistItem[])
        : items
    const merged = applyPriceUpdates(base, updates)
    if (merged) {
      store.set(ITEMS_KEY, merged, now())
    } else {
      log('a wishlist mudou durante a rodada e nenhum id casou — preços descartados desta vez')
    }
  }

  store.set(STAMP_KEY, report, now())
  return { ran: true, report }
}

/** Interpreta o carimbo persistido; qualquer coisa malformada vira null. */
function readReport(v: unknown): RefreshReport | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (typeof r.ranAt !== 'number' || typeof r.checked !== 'number' || typeof r.updated !== 'number') {
    return null
  }
  return {
    ranAt: r.ranAt,
    checked: r.checked,
    updated: r.updated,
    outOfStock: typeof r.outOfStock === 'number' ? r.outOfStock : 0,
    failed: Array.isArray(r.failed) ? r.failed.filter((x): x is string => typeof x === 'string') : [],
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.slice(0, 40)
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
