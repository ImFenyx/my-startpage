/**
 * Testes da camada de segurança.
 *
 * Vulnerabilidades reais encontradas na auditoria e corrigidas aqui:
 *
 *   SSRF — /api/scrape e /api/img aceitavam qualquer URL. Confirmado em
 *          execução: o backend buscava http://127.0.0.1:8787 e devolvia o
 *          conteúdo. Como o CORS refletia qualquer Origin, um site aberto
 *          numa aba conseguiria varrer a rede local e LER as respostas.
 *
 *   CORS — `cors()` sem opções ecoa o Origin recebido. Confirmado:
 *          `Origin: https://site-malicioso.com` voltava em
 *          Access-Control-Allow-Origin.
 *
 *   bun test server/security.test.ts
 */
import { test, expect } from 'bun:test'
import { checkPublicUrl, isPrivateAddress, isAllowedOrigin, createRateLimiter } from './security'

/* ─── SSRF ─────────────────────────────────────────────────────── */

test('bloqueia loopback', async () => {
  for (const u of [
    'http://127.0.0.1:8787/api/health',
    'http://localhost:3000',
    'http://[::1]:8080',
    'http://127.1',
  ]) {
    const r = await checkPublicUrl(u)
    expect(r.ok).toBe(false)
  }
})

test('bloqueia metadata de cloud (AWS/GCP/Azure)', async () => {
  const r = await checkPublicUrl('http://169.254.169.254/latest/meta-data/iam/security-credentials/')
  expect(r.ok).toBe(false)
})

test('bloqueia faixas privadas', async () => {
  for (const ip of ['10.0.0.1', '172.16.5.4', '192.168.1.1', '100.64.0.1']) {
    expect(isPrivateAddress(ip)).toBe(true)
    const r = await checkPublicUrl(`http://${ip}/`)
    expect(r.ok).toBe(false)
  }
})

test('bloqueia hostnames internos', async () => {
  for (const h of ['http://localhost', 'http://foo.local', 'http://svc.internal', 'http://metadata.google.internal']) {
    const r = await checkPublicUrl(h)
    expect(r.ok).toBe(false)
  }
})

test('bloqueia esquemas não-HTTP', async () => {
  for (const u of ['file:///etc/passwd', 'gopher://x', 'ftp://x.com', 'data:text/html,x']) {
    const r = await checkPublicUrl(u)
    expect(r.ok).toBe(false)
  }
})

test('bloqueia credenciais embutidas na URL', async () => {
  const r = await checkPublicUrl('http://user:senha@example.com/')
  expect(r.ok).toBe(false)
})

test('IPv4 mapeado em IPv6 não escapa do filtro', () => {
  expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true)
  expect(isPrivateAddress('::1')).toBe(true)
  expect(isPrivateAddress('fe80::1')).toBe(true)
  expect(isPrivateAddress('fc00::1')).toBe(true)
})

test('permite endereço público legítimo', async () => {
  const r = await checkPublicUrl('https://books.toscrape.com/index.html')
  expect(r.ok).toBe(true)
})

/* ─── CORS ─────────────────────────────────────────────────────── */

test('CORS: só o front local é aceito', () => {
  expect(isAllowedOrigin('http://localhost:5173')).toBe(true)
  expect(isAllowedOrigin('http://127.0.0.1:4173')).toBe(true)
  expect(isAllowedOrigin('https://site-malicioso.com')).toBe(false)
  expect(isAllowedOrigin('http://localhost.evil.com')).toBe(false)
  expect(isAllowedOrigin(undefined)).toBe(true) // curl / same-origin
})

/* ─── Rate limiting ────────────────────────────────────────────── */

test('rate limiter corta acima do limite', () => {
  const check = createRateLimiter(3, 60_000)
  expect(check('1.2.3.4').ok).toBe(true)
  expect(check('1.2.3.4').ok).toBe(true)
  expect(check('1.2.3.4').ok).toBe(true)
  const blocked = check('1.2.3.4')
  expect(blocked.ok).toBe(false)
  expect(blocked.retryAfter).toBeGreaterThan(0)
  // outro IP não é afetado
  expect(check('5.6.7.8').ok).toBe(true)
})

test('rate limiter libera após a janela', async () => {
  const check = createRateLimiter(1, 60)
  expect(check('x').ok).toBe(true)
  expect(check('x').ok).toBe(false)
  await Bun.sleep(80)
  expect(check('x').ok).toBe(true)
})
