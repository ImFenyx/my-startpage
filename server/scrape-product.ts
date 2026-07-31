/**
 * Núcleo do scraping de produto (wishlist).
 *
 * Vive num módulo próprio porque tem DOIS consumidores:
 *
 *   1. a rota GET /api/scrape  — busca manual no editor do item
 *      (index.ts adiciona rate limit e cache de 30 min por cima);
 *   2. o vigia de preços       — price-watch.ts, que refaz a busca em
 *      segundo plano 2× por semana sem passar por HTTP.
 *
 * Toda a proteção continua aqui: `checkPublicUrl` barra SSRF e `safeFetch`
 * revalida cada redirect, então as duas portas de entrada são igualmente
 * seguras.
 */
import * as cheerio from 'cheerio'
import {
  parsePrice,
  CURRENCY_RE,
  CURRENCY_SYMBOL,
  fromJsonLd,
  detectBlock,
  pickImage,
} from './scrape-lib'
import { checkPublicUrl, readCapped, safeFetch } from './security'

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** Cabeçalhos de navegador real — algumas lojas recusam requisições "cruas". */
export const BROWSER_HEADERS: Record<string, string> = {
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

export type Scraped = {
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

/**
 * Erro com status HTTP associado: a rota traduz para a resposta, e o vigia
 * de preços só registra no relatório da rodada.
 */
export class ScrapeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'ScrapeError'
  }
}

/** Busca e extrai metadados de produto de uma URL pública. */
export async function scrapeProduct(target: string): Promise<Scraped> {
  // bloqueia SSRF: localhost, redes privadas, metadata de cloud
  const check = await checkPublicUrl(target)
  if (!check.ok) throw new ScrapeError(check.reason, 400)

  // safeFetch revalida CADA redirect — sem isso, uma página pública pode
  // devolver 302 para 127.0.0.1 e contornar o filtro de SSRF.
  const res = await safeFetch(check.url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new ScrapeError(`A loja respondeu HTTP ${res.status}`, 502, res.statusText)

  // rejeita não-HTML e corpos gigantes antes de parsear
  const ctype = res.headers.get('content-type') ?? ''
  if (!/text\/html|application\/xhtml/i.test(ctype)) {
    throw new ScrapeError(`A URL não retornou HTML (${ctype.split(';')[0] || 'desconhecido'}).`, 415)
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

  return {
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
}
