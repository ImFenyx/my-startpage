/**
 * Verificação do service worker e do manifest.
 *
 * Antes: sem SW, abrir a startpage sem rede resultava em página em branco —
 * apesar de todo o conteúdo já viver no localStorage.
 *
 *   bun test src/lib/pwa.test.ts
 */
import { test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../..', import.meta.url).pathname
const sw = readFileSync(join(ROOT, 'public/sw.js'), 'utf8')
const manifest = JSON.parse(readFileSync(join(ROOT, 'public/manifest.webmanifest'), 'utf8'))

test('o app shell é pré-cacheado na instalação', () => {
  expect(sw).toContain("'/index.html'")
  expect(sw).toContain('addAll')
})

test('REGRESSÃO: navegação tem fallback offline', () => {
  // network-first, mas com cache de segurança quando o fetch falha
  expect(sw).toContain("request.mode === 'navigate'")
  expect(sw).toContain("caches.match('/index.html')")
})

test('dados da API nunca são servidos de cache', () => {
  expect(sw).toContain("url.pathname.startsWith('/api/')")
  // exceção explícita e única: imagens do proxy
  expect(sw).toContain("url.pathname === '/api/img'")
})

test('caches antigos são removidos ao ativar', () => {
  expect(sw).toContain('caches.delete')
  expect(sw).toContain('activate')
})

test('cache de imagens é limitado', () => {
  expect(sw).toContain('trim(')
  expect(sw).toMatch(/trim\([A-Z]+,\s*\d+\)/)
})

test('manifest é instalável', () => {
  expect(manifest.name).toBeTruthy()
  expect(manifest.start_url).toBe('/')
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2)
  // 192 e 512 são os mínimos exigidos para instalação
  const sizes = manifest.icons.map((i: any) => i.sizes)
  expect(sizes).toContain('192x192')
  expect(sizes).toContain('512x512')
  // maskable evita corte feio no Android
  expect(manifest.icons.some((i: any) => i.purpose === 'maskable')).toBe(true)
})

test('ícones declarados existem de fato', () => {
  for (const icon of manifest.icons) {
    expect(existsSync(join(ROOT, 'public', icon.src))).toBe(true)
  }
})

test('cores do manifest seguem o Catppuccin Mocha', () => {
  expect(manifest.background_color).toBe('#1e1e2e')
  expect(manifest.theme_color).toBe('#1e1e2e')
})

test('há <noscript> explicando a necessidade de JS', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
  expect(html).toContain('<noscript>')
  expect(html).toContain('JavaScript')
})
