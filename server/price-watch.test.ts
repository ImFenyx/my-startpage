/**
 * Testes do vigia de preços da wishlist — sem rede e sem SQLite:
 * store e scrape são injetados.
 *
 *   bun test server/price-watch.test.ts
 */
import { test, expect } from 'bun:test'
import {
  applyPriceUpdates,
  formatPtBR,
  msUntilDue,
  refreshWishlistPrices,
  DEFAULT_INTERVAL_MS,
  RETRY_AFTER_FAILURE_MS,
  ITEMS_KEY,
  STAMP_KEY,
  type RefreshReport,
  type ScrapeResult,
  type StoreLike,
  type WishlistItem,
} from './price-watch'

/* ─── dublês ─────────────────────────────────────────────────── */

function fakeStore(seed: Record<string, unknown> = {}) {
  const data = new Map<string, { value: unknown; updatedAt: number }>()
  let clock = 1_000
  for (const [k, v] of Object.entries(seed)) data.set(k, { value: v, updatedAt: clock })
  const store: StoreLike = {
    get: (key) => data.get(key) ?? null,
    set: (key, value, updatedAt) => {
      data.set(key, { value, updatedAt: updatedAt ?? ++clock })
      return true
    },
  }
  return { store, data }
}

const item = (over: Partial<WishlistItem> = {}): WishlistItem => ({
  id: 'a',
  name: 'Teclado',
  url: 'https://loja.com/teclado',
  price: '100,00',
  currency: 'R$',
  done: false,
  ...over,
})

const okScrape =
  (price = '259.9', currency = 'R$') =>
  async (): Promise<ScrapeResult> => ({ price, currency, inStock: true, blocked: false })

const run = {
  force: true,
  delayMs: 0,
  now: () => 5_000,
}

/* ─── formatPtBR ─────────────────────────────────────────────── */

test('formatPtBR formata como o front espera', () => {
  expect(formatPtBR(259.9)).toBe('259,90')
  expect(formatPtBR(8499)).toBe('8.499,00')
  expect(formatPtBR(1.5)).toBe('1,50')
  expect(formatPtBR(1234567.89)).toBe('1.234.567,89')
})

/* ─── fluxo feliz ────────────────────────────────────────────── */

test('atualiza preço, moeda e carimbo do item', async () => {
  const { store, data } = fakeStore({ [ITEMS_KEY]: [item()] })
  const res = await refreshWishlistPrices({ store, scrape: okScrape(), ...run })

  expect(res.ran).toBe(true)
  const saved = data.get(ITEMS_KEY)!.value as WishlistItem[]
  expect(saved[0].price).toBe('259,90')
  expect(saved[0].priceUpdatedAt).toBe(5_000)
  // campos não relacionados continuam intactos
  expect(saved[0].name).toBe('Teclado')
})

test('grava o relatório da rodada na chave interna', async () => {
  const { store, data } = fakeStore({ [ITEMS_KEY]: [item()] })
  await refreshWishlistPrices({ store, scrape: okScrape(), ...run })

  const stamp = data.get(STAMP_KEY)!.value as RefreshReport
  expect(stamp.checked).toBe(1)
  expect(stamp.updated).toBe(1)
  expect(stamp.failed).toEqual([])
})

/* ─── cadência ───────────────────────────────────────────────── */

test('pula a rodada quando o carimbo ainda está fresco', async () => {
  const last: RefreshReport = { ranAt: 1_000, checked: 2, updated: 2, outOfStock: 0, failed: [] }
  const { store } = fakeStore({ [STAMP_KEY]: last, [ITEMS_KEY]: [item()] })
  let chamou = 0
  const res = await refreshWishlistPrices({
    store,
    scrape: async () => {
      chamou++
      return okScrape()()
    },
    intervalMs: DEFAULT_INTERVAL_MS,
    now: () => 1_000 + 60_000, // 1 min depois da última rodada
    delayMs: 0,
  })
  expect(res.ran).toBe(false)
  expect(chamou).toBe(0)
})

test('force ignora a cadência', async () => {
  const last: RefreshReport = { ranAt: 1_000, checked: 2, updated: 2, outOfStock: 0, failed: [] }
  const { store } = fakeStore({ [STAMP_KEY]: last, [ITEMS_KEY]: [item()] })
  const res = await refreshWishlistPrices({
    store,
    scrape: okScrape(),
    force: true,
    delayMs: 0,
    intervalMs: DEFAULT_INTERVAL_MS,
    now: () => 1_000 + 60_000,
  })
  expect(res.ran).toBe(true)
})

/* ─── seleção de itens ───────────────────────────────────────── */

test('ignora itens conquistados e itens sem URL', async () => {
  const { store, data } = fakeStore({
    [ITEMS_KEY]: [item({ id: 'feito', done: true }), item({ id: 'semurl', url: '' })],
  })
  const res = await refreshWishlistPrices({ store, scrape: okScrape(), ...run })
  expect(res.ran).toBe(false)
  expect(data.has(STAMP_KEY)).toBe(false) // nada rodou, nada a registrar
})

test('wishlist inexistente não derruba a rodada', async () => {
  const { store } = fakeStore()
  const res = await refreshWishlistPrices({ store, scrape: okScrape(), ...run })
  expect(res.ran).toBe(false)
  expect(res.ran ? '' : res.reason).toMatch(/vazia/)
})

test('itens malformados (não-objeto) são ignorados', async () => {
  const { store } = fakeStore({ [ITEMS_KEY]: [49, null, 'x'] })
  const res = await refreshWishlistPrices({ store, scrape: okScrape(), ...run })
  expect(res.ran).toBe(false)
})

/* ─── falhas parciais ────────────────────────────────────────── */

test('fora de estoque: mantém preço antigo e não avança o carimbo', async () => {
  const { store, data } = fakeStore({ [ITEMS_KEY]: [item()] })
  const res = await refreshWishlistPrices({
    store,
    scrape: async () => ({ price: '', currency: '', inStock: false, blocked: false }),
    ...run,
  })
  expect(res.ran).toBe(true)
  if (res.ran) {
    expect(res.report.outOfStock).toBe(1)
    expect(res.report.updated).toBe(0)
  }
  const saved = data.get(ITEMS_KEY)!.value as WishlistItem[]
  expect(saved[0].price).toBe('100,00') // intacto
})

test('loja bloqueada entra em failed e não apaga o preço', async () => {
  const { store, data } = fakeStore({ [ITEMS_KEY]: [item()] })
  const res = await refreshWishlistPrices({
    store,
    scrape: async () => ({ price: '', currency: '', inStock: true, blocked: true }),
    ...run,
  })
  expect(res.ran).toBe(true)
  if (res.ran) expect(res.report.failed).toEqual(['loja.com'])

  // nada mudou → a chave de itens nem é reescrita
  const saved = data.get(ITEMS_KEY)!
  expect((saved.value as WishlistItem[])[0].price).toBe('100,00')
  expect(saved.updatedAt).toBe(1_000)
})

test('erro de rede num item não aborta os demais', async () => {
  const { store } = fakeStore({
    [ITEMS_KEY]: [item({ id: 'a', url: 'https://quebrada.com/p' }), item({ id: 'b', url: 'https://boa.com/p' })],
  })
  const res = await refreshWishlistPrices({
    store,
    scrape: async (url) => {
      if (url.includes('quebrada')) throw new Error('fetch failed')
      return okScrape()()
    },
    ...run,
  })
  expect(res.ran).toBe(true)
  if (res.ran) {
    expect(res.report.updated).toBe(1)
    expect(res.report.failed).toEqual(['quebrada.com'])
  }
})

/* ─── corrida com edição do usuário ──────────────────────────── */

test('edição durante a rodada: preços são mesclados na versão nova, por id', async () => {
  const { store, data } = fakeStore({ [ITEMS_KEY]: [item({ id: 'a' }), item({ id: 'b', url: 'https://loja.com/b' })] })

  // durante o scrape do 1º item, o usuário apaga o item "b" e renomeia o "a"
  const scrape = async () => {
    store.set(ITEMS_KEY, [item({ id: 'a', name: 'Nome editado' })], 9_999)
    return okScrape()()
  }

  const res = await refreshWishlistPrices({ store, scrape, ...run })
  expect(res.ran).toBe(true)

  const saved = data.get(ITEMS_KEY)!.value as WishlistItem[]
  expect(saved.length).toBe(1) // item apagado NÃO ressuscita
  expect(saved[0].name).toBe('Nome editado') // edição preservada
  expect(saved[0].price).toBe('259,90') // preço mesclado por id
})

test('applyPriceUpdates devolve null quando nenhum id casa', () => {
  const updates = new Map([['fantasma', { price: '1,00', priceUpdatedAt: 1 }]])
  expect(applyPriceUpdates([{ id: 'outro' }], updates)).toBeNull()
  expect(applyPriceUpdates('não-é-lista', updates)).toBeNull()
})

/* ─── agenda (função pura) ───────────────────────────────────── */

test('msUntilDue: sem histórico, já está na hora', () => {
  expect(msUntilDue(null, DEFAULT_INTERVAL_MS, Date.now())).toBe(0)
})

test('msUntilDue: rodada saudável respeita o intervalo cheio', () => {
  const last: RefreshReport = { ranAt: 10_000, checked: 3, updated: 1, outOfStock: 2, failed: [] }
  expect(msUntilDue(last, DEFAULT_INTERVAL_MS, 5_000)).toBe(DEFAULT_INTERVAL_MS - 5_000 + 10_000)
})

test('msUntilDue: fracasso total antecipa a nova tentativa', () => {
  const last: RefreshReport = { ranAt: 10_000, checked: 3, updated: 0, outOfStock: 0, failed: ['loja.com'] }
  expect(msUntilDue(last, DEFAULT_INTERVAL_MS, 10_000)).toBe(RETRY_AFTER_FAILURE_MS)
})

test('msUntilDue: tudo fora de estoque NÃO é fracasso — espera o ciclo normal', () => {
  const last: RefreshReport = { ranAt: 10_000, checked: 3, updated: 0, outOfStock: 3, failed: [] }
  expect(msUntilDue(last, DEFAULT_INTERVAL_MS, 10_000)).toBe(DEFAULT_INTERVAL_MS)
})
