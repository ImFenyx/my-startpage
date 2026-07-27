/**
 * Funções puras de extração usadas pelo endpoint /api/scrape.
 * Separadas do servidor para poderem ser testadas isoladamente
 * (`bun test server/scraper.test.ts`).
 */
import * as cheerio from 'cheerio'

export const abs = (src: string | undefined, base: string) => {
  if (!src) return ''
  try {
    return new URL(src, base).toString()
  } catch {
    return ''
  }
}

/**
 * Converte um preço textual em número.
 *
 * Os separadores são ambíguos entre locales, então decidimos por regra
 * explícita em vez de "chutar" no parseFloat:
 *
 *   "R$ 8.499,00"  → 8499.00   (pt-BR: ponto = milhar, vírgula = decimal)
 *   "$1,299.90"    → 1299.90   (en-US: o inverso)
 *   "R$ 8.499"     → 8499.00   (ponto com 3 dígitos = milhar, NÃO 8.50)
 *   "1.5"          → 1.50      (ponto com 1-2 dígitos = decimal)
 *
 * O bug antigo: "8.499" caía no ramo en-US e virava 8.499 → "8.50".
 */
export function parseAmount(raw: unknown): number | null {
  if (raw == null) return null
  let n = String(raw).trim()
  if (!n) return null

  // remove tudo que não for dígito ou separador
  n = n.replace(/[^\d.,]/g, '')
  if (!n) return null

  const lastComma = n.lastIndexOf(',')
  const lastDot = n.lastIndexOf('.')

  if (lastComma !== -1 && lastDot !== -1) {
    // ambos presentes: o ÚLTIMO é o separador decimal
    n = lastComma > lastDot ? n.replace(/\./g, '').replace(',', '.') : n.replace(/,/g, '')
  } else if (lastComma !== -1) {
    // só vírgula: decimal se sobrarem 1-2 dígitos ("8499,00"), senão milhar ("8,499")
    const dec = n.length - lastComma - 1
    n = dec === 1 || dec === 2 ? n.replace(',', '.') : n.replace(/,/g, '')
  } else if (lastDot !== -1) {
    // só ponto: idem. "8.499" tem 3 casas → milhar → 8499
    const dec = n.length - lastDot - 1
    const dots = (n.match(/\./g) ?? []).length
    if (dots > 1 || dec === 3) n = n.replace(/\./g, '')
  }

  const val = Number.parseFloat(n)
  // Descarta o que não é preço plausível: zero, negativo, NaN e valores tão
  // grandes que `toFixed` devolveria notação científica ("1e+21").
  if (!Number.isFinite(val) || val <= 0 || val >= 1e15) return null
  return val
}

export const CURRENCY_RE = /R\$|US\$|BRL|USD|EUR|GBP|€|£|\$/i

export function detectCurrency(s: string): string {
  const m = String(s).match(CURRENCY_RE)
  if (!m) return ''
  const raw = m[0].toUpperCase()
  if (raw === 'BRL' || raw === 'R$') return 'R$'
  if (raw === 'USD' || raw === 'US$') return '$'
  if (raw === 'EUR') return '€'
  if (raw === 'GBP') return '£'
  return m[0]
}

/**
 * Extrai preço de um texto solto, tolerando ruído de página de e-commerce:
 * "de R$ 10.000,00 por R$ 8.499,00" ou "R$ 8.499,00 em 12x de R$ 708,25".
 *
 * Pega TODOS os valores e devolve o MAIOR — o preço à vista é sempre maior
 * que a parcela, e assim não confundimos "12x de 708,25" com o total.
 * (Descontos são tratados antes, pela ordem das fontes.)
 */
export function parsePrice(raw: unknown): { price: string; currency: string } | null {
  if (raw == null) return null
  const s = String(raw).replace(/\s+/g, ' ').trim()
  if (!s) return null

  const currency = detectCurrency(s)

  // se veio um número puro (JSON-LD), não faz varredura
  if (/^[\d.,]+$/.test(s)) {
    const v = parseAmount(s)
    return v ? { price: v.toFixed(2), currency } : null
  }

  const matches = s.match(/\d[\d.,]*/g) ?? []
  const values = matches
    .map(parseAmount)
    .filter((v): v is number => v !== null && v >= 0.01 && v < 100_000_000)

  if (!values.length) return null
  return { price: Math.max(...values).toFixed(2), currency }
}
/**
 * Varre blocos JSON-LD atrás de schema.org/Product.
 *
 * Importante: respeitamos `availability`. Na Amazon, produto esgotado costuma
 * trazer ofertas de OUTROS vendedores/produtos no mesmo bloco — era daí que
 * vinha o "preço de outro produto".
 */
export function fromJsonLd($: cheerio.CheerioAPI) {
  const out: {
    title?: string
    image?: string
    rawPrice?: unknown
    currency?: string
    availability?: string
    inStock?: boolean
  } = {}

  const unavailable = /OutOfStock|SoldOut|Discontinued|PreOrder|BackOrder/i

  $('script[type="application/ld+json"]').each((_, el) => {
    let json: unknown
    try {
      json = JSON.parse($(el).contents().text().trim())
    } catch {
      return
    }
    const stack: any[] = Array.isArray(json) ? [...json] : [json]
    let guard = 0
    while (stack.length && guard++ < 500) {
      const node = stack.pop()
      if (!node || typeof node !== 'object') continue
      if (Array.isArray(node['@graph'])) stack.push(...node['@graph'])

      const type = ([] as string[]).concat(node['@type'] ?? []).join(',').toLowerCase()
      if (type.includes('product')) {
        out.title ??= typeof node.name === 'string' ? node.name : undefined

        const img = Array.isArray(node.image) ? node.image[0] : node.image
        out.image ??= typeof img === 'string' ? img : img?.url

        // offers pode ser objeto, array ou AggregateOffer
        const offers = ([] as any[]).concat(node.offers ?? [])
        for (const o of offers) {
          if (!o || typeof o !== 'object') continue
          const avail = String(o.availability ?? '')
          if (avail) {
            out.availability ??= avail
            if (unavailable.test(avail)) {
              // esgotado: não usa este preço, mas registra o estado
              out.inStock ??= false
              continue
            }
          }
          const p = o.price ?? o.lowPrice ?? o.highPrice
          if (p != null && out.rawPrice == null) {
            out.rawPrice = p
            out.currency ??= o.priceCurrency
            out.inStock = true // oferta disponível encontrada
          }
        }
      }
      for (const v of Object.values(node)) if (v && typeof v === 'object') stack.push(v)
    }
  })
  return out
}

/** Páginas anti-bot que retornam 200 mas não são o produto. */
export function detectBlock($: cheerio.CheerioAPI, html: string, host: string): string | null {
  const title = $('title').text().trim()

  if (/suspicious-traffic|gz-account-verification/i.test(html))
    return 'A loja bloqueou o acesso automatizado (verificação de tráfego).'
  if (/captcha|Digite os caracteres|Enter the characters you see|Bot Detect|cf-browser-verification|Just a moment\.\.\./i.test(html))
    return 'A loja exigiu CAPTCHA.'
  if (/Access Denied|Acesso negado|Request blocked|To discuss automated access/i.test(html))
    return 'A loja negou o acesso.'
  // título genérico = página institucional, não o produto
  if (/^(Mercado Libre|Mercado Livre|Amazon\.com\.br|Amazon\.com|AliExpress|Shopee)$/i.test(title))
    return `A loja devolveu uma página genérica ("${title}") em vez do produto.`
  if (/^\s*(4\d\d|5\d\d)\s*[-–]/.test(title)) return `A loja respondeu com erro: ${title.slice(0, 60)}`

  return null
}

/** Imagens que não são o produto: logo, placeholder, pixel de tracking, sprite. */
export const JUNK_IMAGE =
  /(logo|sprite|placeholder|spacer|blank|pixel|1x1|transparent|grey-?pixel|no-?image|default|avatar|icon|favicon|loading|spinner)/i

export function isJunkImage(url: unknown): boolean {
  // O valor vem de HTML de terceiros: pode ser qualquer coisa, não só string.
  if (typeof url !== 'string' || !url) return true
  if (/^data:/i.test(url)) return true
  if (JUNK_IMAGE.test(url)) return true
  // dimensões minúsculas embutidas na URL (ex.: _50x50.jpg, /40x40/)
  const dim = url.match(/[_\-\/](\d{1,3})\s*[x×]\s*(\d{1,3})[._\-\/]/i)
  if (dim && (Number(dim[1]) < 150 || Number(dim[2]) < 150)) return true
  return false
}

/** Escolhe a melhor imagem do documento, ignorando logos e placeholders. */
export function pickImage($: cheerio.CheerioAPI, ldImage: string | undefined, base: string): string {
  const candidates: string[] = []

  const push = (v?: string | null) => {
    if (!v) return
    for (const part of String(v).split(',')) {
      // suporta srcset: "url 1x, url 2x"
      const u = part.trim().split(/\s+/)[0]
      if (u) candidates.push(u)
    }
  }

  push(ldImage)
  push($('meta[property="og:image:secure_url"]').first().attr('content'))
  push($('meta[property="og:image"]').first().attr('content'))
  push($('meta[name="twitter:image"]').first().attr('content'))
  push($('link[rel="image_src"]').first().attr('href'))

  // imagens marcadas semanticamente como do produto
  $('[itemprop="image"]').each((_, el) => push($(el).attr('content') || $(el).attr('src')))
  $('img#landingImage, img#imgBlkFront, img.ux-image-viewer__image, img[data-zoom-image]').each(
    (_, el) => push($(el).attr('data-old-hires') || $(el).attr('data-zoom-image') || $(el).attr('src')),
  )

  // por último, as maiores <img> declaradas na página
  const sized: { url: string; area: number }[] = []
  $('img[src], img[data-src]').each((_, el) => {
    const $el = $(el)
    const u = $el.attr('src') || $el.attr('data-src') || ''
    const w = Number($el.attr('width')) || 0
    const h = Number($el.attr('height')) || 0
    if (u) sized.push({ url: u, area: w * h })
  })
  sized.sort((x, y) => y.area - x.area)
  for (const s of sized.slice(0, 10)) push(s.url)

  for (const c of candidates) {
    const absUrl = abs(c, base)
    if (absUrl && !isJunkImage(absUrl)) return absUrl
  }
  return ''
}

export const CURRENCY_SYMBOL: Record<string, string> = { BRL: 'R$', USD: '$', EUR: '€', GBP: '£' }

