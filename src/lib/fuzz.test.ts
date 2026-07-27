/**
 * Fuzzing das funções que recebem dado não confiável.
 *
 * Todas processam entrada de terceiros — URL digitada, HTML de loja, backup
 * importado — e nenhuma pode derrubar a interface. Esta bateria encontrou
 * 8 crashes em `isJunkImage` (valor não-string vindo do HTML) e um caso de
 * URL protocol-relative virando link externo silencioso.
 *
 *   bun test src/lib/fuzz.test.ts
 */
import { test, expect } from 'bun:test'
;(globalThis as any).window ??= { location: { origin: 'http://localhost:5173' } }
const { safeHref, safeImageSrc, normalizeUserUrl } = await import('./safe-url')
const { glyph, guessIcon } = await import('./icons')
const { parsePrice, parseAmount, isJunkImage } = await import('../../server/scrape-lib')

const HOSTIS: unknown[] = [
  null, undefined, '', ' ', '\n', 0, -1, NaN, Infinity, {}, [], true, false,
  'x'.repeat(50000), '://', 'http://', 'https://', '//evil.com',
  'javascript:'.repeat(100), '\u0000', '\uFFFD', '𝕏'.repeat(1000),
]

test('safeHref não crasha com nenhuma entrada', () => {
  for (const e of HOSTIS) expect(() => safeHref(e as never)).not.toThrow()
})
test('safeImageSrc não crasha com nenhuma entrada', () => {
  for (const e of HOSTIS) expect(() => safeImageSrc(e as never)).not.toThrow()
})
test('normalizeUserUrl não crasha com nenhuma entrada', () => {
  for (const e of HOSTIS) expect(() => normalizeUserUrl(String(e))).not.toThrow()
})
test('glyph não crasha com nenhuma entrada', () => {
  for (const e of HOSTIS) expect(() => glyph(String(e))).not.toThrow()
})
test('guessIcon não crasha com nenhuma entrada', () => {
  for (const e of HOSTIS) expect(() => guessIcon(String(e))).not.toThrow()
})
test('parsePrice/parseAmount não crasham com nenhuma entrada', () => {
  for (const e of HOSTIS) {
    expect(() => parsePrice(e as never)).not.toThrow()
    expect(() => parseAmount(e as never)).not.toThrow()
  }
})

test('REGRESSÃO: isJunkImage aceita valor não-string vindo do HTML', () => {
  for (const e of HOSTIS) expect(() => isJunkImage(e as never)).not.toThrow()
  // qualquer coisa que não seja string utilizável é considerada lixo
  expect(isJunkImage(42 as never)).toBe(true)
  expect(isJunkImage({} as never)).toBe(true)
  expect(isJunkImage(null as never)).toBe(true)
})

test('REGRESSÃO: preço absurdo não vira notação científica', () => {
  // "1e+21" quebraria a exibição e a soma da wishlist
  expect(parsePrice('999999999999999999999,99')).toBeNull()
  expect(parseAmount('1'.repeat(30))).toBeNull()
})

test('preço zero ou negativo é descartado', () => {
  expect(parsePrice('0,00')).toBeNull()
  expect(parseAmount('0')).toBeNull()
})

test('REGRESSÃO: protocol-relative //evil.com não vira link externo', () => {
  expect(safeHref('//evil.com/x')).toBe('')
  expect(safeHref('//evil.com')).toBe('')
  // links normais seguem funcionando
  expect(safeHref('https://github.com')).toContain('github.com')
  expect(safeHref('/api/img?url=x')).toContain('localhost')
})
