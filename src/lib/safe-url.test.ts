/**
 * Testes de saneamento de URL (XSS).
 *
 * Contexto verificado com renderToStaticMarkup no React 19:
 *   - `javascript:` É bloqueado pelo próprio React;
 *   - `data:text/html`, `vbscript:` e `blob:` NÃO são — atravessam intactos.
 *
 * Links da wishlist e dos atalhos vêm do usuário (digitados, colados ou
 * importados de um backup JSON de terceiro), então precisam de allowlist.
 *
 *   bun test src/lib/safe-url.test.ts
 */
import { test, expect } from 'bun:test'
import { safeHref, safeImageSrc, normalizeUserUrl } from './safe-url'

// jsdom não está no projeto; safeHref usa window.location como base.
;(globalThis as any).window ??= { location: { origin: 'http://localhost:5173' } }

/* ─── href ─────────────────────────────────────────────────────── */

test('bloqueia esquemas executáveis', () => {
  for (const u of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'blob:https://evil.com/abc',
    'file:///etc/passwd',
  ]) {
    expect(safeHref(u)).toBe('')
  }
})

test('bloqueia esquema mascarado com caractere de controle', () => {
  expect(safeHref('java\u0000script:alert(1)')).toBe('')
  expect(safeHref('java\tscript:alert(1)')).toBe('')
  expect(safeHref('  javascript:alert(1)  ')).toBe('')
})

test('permite http, https e mailto', () => {
  expect(safeHref('https://github.com')).toContain('https://github.com')
  expect(safeHref('http://exemplo.com.br/x?y=1')).toContain('http://exemplo.com.br')
  expect(safeHref('mailto:eu@exemplo.com')).toContain('mailto:')
})

test('entrada vazia ou inválida devolve string vazia', () => {
  expect(safeHref('')).toBe('')
  expect(safeHref(null)).toBe('')
  expect(safeHref(undefined)).toBe('')
})

/* ─── img src ──────────────────────────────────────────────────── */

test('bloqueia data: perigoso em imagem', () => {
  expect(safeImageSrc('data:text/html,<script>alert(1)</script>')).toBe('')
  expect(safeImageSrc('data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==')).toBe('')
})

test('permite data: de imagem rasterizada (upload manual)', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
  expect(safeImageSrc(png)).toBe(png)
})

test('bloqueia SVG remoto (XML executável)', () => {
  expect(safeImageSrc('https://evil.com/x.svg')).toBe('')
  expect(safeImageSrc('https://evil.com/x.svgz?a=1')).toBe('')
})

test('permite imagem remota comum e o proxy interno', () => {
  expect(safeImageSrc('https://cdn.loja.com/foto.jpg')).toContain('foto.jpg')
  expect(safeImageSrc('/api/img?url=https%3A%2F%2Fx.com%2Fa.jpg')).toContain('/api/img')
})

/* ─── normalização ─────────────────────────────────────────────── */

test('normalizeUserUrl completa o esquema', () => {
  expect(normalizeUserUrl('github.com')).toBe('https://github.com/')
  expect(normalizeUserUrl('  exemplo.com.br/p  ')).toContain('https://exemplo.com.br/p')
})

test('normalizeUserUrl recusa esquema perigoso digitado', () => {
  expect(normalizeUserUrl('javascript:alert(1)')).toBe('')
  expect(normalizeUserUrl('data:text/html,x')).toBe('')
})
