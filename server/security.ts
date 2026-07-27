/**
 * Camada de segurança do backend.
 *
 * O servidor roda em localhost, mas isso NÃO o torna seguro: qualquer página
 * aberta no seu navegador pode fazer requisições para http://localhost:8787.
 * Sem as proteções abaixo, um site malicioso conseguiria:
 *
 *   1. SSRF  — usar seu backend como proxy para varrer a sua rede local
 *              (roteador em 192.168.1.1, serviços em 127.0.0.1, metadata de
 *              cloud em 169.254.169.254) e ler as respostas.
 *   2. CORS  — ler o conteúdo dessas respostas, porque `cors()` sem opções
 *              reflete qualquer Origin.
 *   3. DoS   — disparar milhares de scrapes e travar a máquina.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/* ─────────────────────── CORS ─────────────────────── */

/** Só o próprio front (Vite dev/preview) pode falar com a API. */
export const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  ...(Bun.env.EXTRA_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ?? []),
]

export function isAllowedOrigin(origin: string | undefined | null): boolean {
  // Requisições same-origin e de ferramentas locais (curl) não mandam Origin.
  if (!origin) return true
  return ALLOWED_ORIGINS.includes(origin)
}

/* ─────────────────────── SSRF ─────────────────────── */

/**
 * Faixas privadas/reservadas que nunca devem ser alcançadas a partir de uma
 * URL fornecida pelo usuário.
 */
function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true

  const [a, b] = p
  if (a === 0) return true // 0.0.0.0/8
  if (a === 10) return true // privada
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local + metadata de cloud
  if (a === 172 && b >= 16 && b <= 31) return true // privada
  if (a === 192 && b === 168) return true // privada
  if (a === 192 && b === 0) return true // IETF
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true // benchmark
  if (a >= 224) return true // multicast + reservado
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (s === '::' || s === '::1') return true // unspecified / loopback
  if (s.startsWith('fe80')) return true // link-local
  if (/^f[cd]/.test(s)) return true // unique local
  // IPv4 mapeado: ::ffff:127.0.0.1
  const m = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/)
  if (m) return isPrivateIPv4(m[1])
  return false
}

export function isPrivateAddress(host: string): boolean {
  const v = isIP(host)
  if (v === 4) return isPrivateIPv4(host)
  if (v === 6) return isPrivateIPv6(host)
  return false
}

const BLOCKED_HOSTNAMES = /^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string }

/**
 * Valida uma URL informada pelo usuário antes de o servidor buscá-la.
 *
 * Resolve o DNS e verifica o IP de destino — um domínio público pode apontar
 * para 127.0.0.1 de propósito (ataque de "DNS rebinding" na forma mais simples).
 */
export async function checkPublicUrl(raw: string): Promise<UrlCheck> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'URL inválida.' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { ok: false, reason: 'Somente http e https são aceitos.' }

  if (url.username || url.password)
    return { ok: false, reason: 'URLs com credenciais embutidas não são aceitas.' }

  const host = url.hostname.replace(/^\[|\]$/g, '')

  if (BLOCKED_HOSTNAMES.test(host))
    return { ok: false, reason: 'Endereço local não é permitido.' }

  if (isIP(host)) {
    if (isPrivateAddress(host)) return { ok: false, reason: 'Endereço de rede privada não é permitido.' }
    return { ok: true, url }
  }

  // domínio: resolve e valida TODOS os IPs retornados
  try {
    const records = await lookup(host, { all: true })
    if (!records.length) return { ok: false, reason: 'Domínio não resolvido.' }
    for (const r of records) {
      if (isPrivateAddress(r.address))
        return { ok: false, reason: 'O domínio aponta para um endereço interno.' }
    }
  } catch {
    return { ok: false, reason: 'Falha ao resolver o domínio.' }
  }

  return { ok: true, url }
}

/* ──────────────────── Rate limiting ──────────────────── */

/** Janela deslizante simples, em memória — suficiente para uso pessoal. */
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>()

  return function check(key: string): { ok: boolean; retryAfter: number } {
    const now = Date.now()
    const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs)

    if (arr.length >= limit) {
      const retryAfter = Math.ceil((windowMs - (now - arr[0])) / 1000)
      hits.set(key, arr)
      return { ok: false, retryAfter }
    }

    arr.push(now)
    hits.set(key, arr)

    // limpeza preguiçosa para o Map não crescer indefinidamente
    if (hits.size > 500) {
      for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k)
    }
    return { ok: true, retryAfter: 0 }
  }
}

/* ──────────────────── Cabeçalhos ──────────────────── */

export const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-site',
  'permissions-policy': 'geolocation=(), microphone=(), camera=(), payment=()',
}

/** Limite de download para não estourar a memória com um arquivo gigante. */
export const MAX_BODY_BYTES = 5_000_000 // 5 MB

export async function readCapped(res: Response, max = MAX_BODY_BYTES): Promise<string> {
  const len = Number(res.headers.get('content-length') ?? 0)
  if (len && len > max) throw new Error('Resposta grande demais.')

  const reader = res.body?.getReader()
  if (!reader) return ''

  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > max) {
      await reader.cancel()
      throw new Error('Resposta grande demais.')
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/* ──────────────── Fetch seguro contra redirect ──────────────── */

/**
 * `fetch(url, { redirect: 'follow' })` valida apenas a URL inicial: uma página
 * pública pode responder 302 apontando para 127.0.0.1 e o filtro é contornado.
 *
 * Aqui seguimos os redirects MANUALMENTE, revalidando cada salto.
 */
export async function safeFetch(
  raw: string | URL,
  init: RequestInit = {},
  maxHops = 5,
): Promise<Response> {
  let current = String(raw)

  for (let hop = 0; hop <= maxHops; hop++) {
    const check = await checkPublicUrl(current)
    if (!check.ok) throw new Error(`Destino bloqueado: ${check.reason}`)

    const res = await fetch(check.url, { ...init, redirect: 'manual' })

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return res
      // resolve relativo contra a URL atual e revalida no próximo laço
      current = new URL(loc, check.url).toString()
      continue
    }
    return res
  }
  throw new Error('Excesso de redirecionamentos.')
}

/* ──────────────── Tipos de imagem seguros ──────────────── */

/**
 * SVG é XML e pode conter <script>/onload — servi-lo do nosso domínio seria
 * XSS. Só liberamos formatos rasterizados.
 */
export const SAFE_IMAGE_TYPES = /^image\/(jpeg|jpg|png|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/i
