/**
 * Testes do scraper — casos reais relatados em uso.
 *
 * Bugs cobertos:
 *   1. "R$ 8.499,00" virava 849,00  (separador de milhar mal interpretado)
 *   2. "R$ 8.499"    virava 8,50    (ponto de milhar tratado como decimal)
 *   3. Amazon esgotada puxava preço de outro produto da mesma página
 *   4. Mercado Livre trazia a logo como imagem do produto
 *   5. Moeda não era detectada ("R$ 8.499,00" → currency vazio)
 *
 *   bun test server/scraper.test.ts
 */
import { test, expect } from 'bun:test'
import * as cheerio from 'cheerio'
import { parsePrice, parseAmount, isJunkImage, fromJsonLd, detectBlock, pickImage } from './scrape-lib'

/* ─── 1 & 2: separadores de milhar/decimal ─────────────────────── */

test('pt-BR: ponto é milhar, vírgula é decimal', () => {
  expect(parsePrice('R$ 8.499,00')?.price).toBe('8499.00')
  expect(parsePrice('R$ 1.299,90')?.price).toBe('1299.90')
  expect(parsePrice('R$ 12.345.678,90')?.price).toBe('12345678.90')
  expect(parsePrice('8.499,00')?.price).toBe('8499.00')
})

test('en-US: vírgula é milhar, ponto é decimal', () => {
  expect(parsePrice('$1,299.90')?.price).toBe('1299.90')
  expect(parsePrice('$19.99')?.price).toBe('19.99')
  expect(parsePrice('USD 1,000.00')?.price).toBe('1000.00')
})

test('REGRESSÃO: "R$ 8.499" sem decimais não vira 8.50', () => {
  expect(parsePrice('R$ 8.499')?.price).toBe('8499.00')
  expect(parseAmount('8.499')).toBe(8499)
  expect(parseAmount('1.234')).toBe(1234)
})

test('ponto com 1-2 casas continua sendo decimal', () => {
  expect(parseAmount('1.5')).toBe(1.5)
  expect(parseAmount('19.99')).toBe(19.99)
})

test('vírgula sozinha: decide por quantidade de casas', () => {
  expect(parseAmount('8499,00')).toBe(8499)
  expect(parseAmount('8,499')).toBe(8499) // 3 casas = milhar
})

/* ─── preço com ruído da página ────────────────────────────────── */

test('ignora parcelamento e pega o valor à vista', () => {
  expect(parsePrice('R$ 8.499,00 em 12x de R$ 708,25')?.price).toBe('8499.00')
  expect(parsePrice('12x R$ 708,25 sem juros — total R$ 8.499,00')?.price).toBe('8499.00')
})

test('número puro do JSON-LD não passa pelo varredor', () => {
  expect(parsePrice('8499.00')?.price).toBe('8499.00')
  expect(parsePrice(8499)?.price).toBe('8499.00')
})

test('preço inválido devolve null', () => {
  expect(parsePrice('')).toBeNull()
  expect(parsePrice('sem preço')).toBeNull()
  expect(parsePrice(null)).toBeNull()
  expect(parseAmount('0')).toBeNull()
})

/* ─── 5: moeda ─────────────────────────────────────────────────── */

test('detecta e normaliza a moeda', () => {
  expect(parsePrice('R$ 8.499,00')?.currency).toBe('R$')
  expect(parsePrice('US$ 19.99')?.currency).toBe('$')
  expect(parsePrice('€ 49,90')?.currency).toBe('€')
  expect(parsePrice('BRL 100,00')?.currency).toBe('R$')
})

/* ─── 3: Amazon esgotada não deve dar preço de outro produto ───── */

test('JSON-LD: oferta OutOfStock é ignorada', () => {
  const $ = cheerio.load(`<script type="application/ld+json">${JSON.stringify({
    '@type': 'Product',
    name: 'Produto Esgotado',
    offers: { '@type': 'Offer', price: '199.00', priceCurrency: 'BRL', availability: 'https://schema.org/OutOfStock' },
  })}</script>`)
  const ld = fromJsonLd($)
  expect(ld.rawPrice).toBeUndefined()
  expect(ld.title).toBe('Produto Esgotado')
})

test('JSON-LD: oferta InStock é aceita', () => {
  const $ = cheerio.load(`<script type="application/ld+json">${JSON.stringify({
    '@type': 'Product',
    name: 'Disponível',
    offers: { price: '8499.00', priceCurrency: 'BRL', availability: 'https://schema.org/InStock' },
  })}</script>`)
  const ld = fromJsonLd($)
  expect(ld.rawPrice).toBe('8499.00')
  expect(ld.inStock).toBe(true)
})

test('JSON-LD: com várias ofertas, pula as esgotadas', () => {
  const $ = cheerio.load(`<script type="application/ld+json">${JSON.stringify({
    '@type': 'Product',
    name: 'Multi',
    offers: [
      { price: '111.00', availability: 'https://schema.org/OutOfStock' },
      { price: '222.00', availability: 'https://schema.org/InStock' },
    ],
  })}</script>`)
  expect(fromJsonLd($).rawPrice).toBe('222.00')
})

/* ─── 4: imagem — logo/placeholder não são o produto ───────────── */

test('reconhece imagens que não são do produto', () => {
  expect(isJunkImage('https://http2.mlstatic.com/frontend-assets/ml-web/logo__large_plus.png')).toBe(true)
  expect(isJunkImage('https://m.media-amazon.com/images/G/32/x-locale/common/grey-pixel.gif')).toBe(true)
  expect(isJunkImage('https://loja.com/img/placeholder.jpg')).toBe(true)
  expect(isJunkImage('https://loja.com/sprite-icons.png')).toBe(true)
  expect(isJunkImage('data:image/gif;base64,R0lGOD')).toBe(true)
  expect(isJunkImage('https://loja.com/produto_50x50.jpg')).toBe(true)
  expect(isJunkImage('')).toBe(true)
})

test('aceita imagem legítima de produto', () => {
  expect(isJunkImage('https://m.media-amazon.com/images/I/71abc123._AC_SL1500_.jpg')).toBe(false)
  expect(isJunkImage('https://http2.mlstatic.com/D_NQ_NP_2X_123456-MLB.webp')).toBe(false)
})

test('pickImage pula a logo e escolhe a imagem real', () => {
  const $ = cheerio.load(`
    <meta property="og:image" content="https://cdn.loja.com/logo.png">
    <img src="https://cdn.loja.com/produto-real_1500x1500.jpg" width="1500" height="1500">
  `)
  const img = pickImage($, undefined, 'https://loja.com/p/1')
  expect(img).toContain('produto-real')
})

test('pickImage resolve URL relativa', () => {
  const $ = cheerio.load(`<meta property="og:image" content="/fotos/item.jpg">`)
  expect(pickImage($, undefined, 'https://loja.com/p/1')).toBe('https://loja.com/fotos/item.jpg')
})

/* ─── detecção de bloqueio ─────────────────────────────────────── */

test('detecta página anti-bot do Mercado Livre', () => {
  const html = '<html data-assets-prefix="https://http2.mlstatic.com/frontend-assets/suspicious-traffic-frontend/"><title>Mercado Libre</title></html>'
  expect(detectBlock(cheerio.load(html), html, 'mercadolivre.com.br')).toBeTruthy()
})

test('detecta título genérico em vez do produto', () => {
  const html = '<html><head><title>Mercado Libre</title></head></html>'
  const msg = detectBlock(cheerio.load(html), html, 'mercadolivre.com.br')
  expect(msg).toContain('genérica')
})

test('detecta CAPTCHA', () => {
  const html = '<html><title>Amazon.com.br</title><body>Digite os caracteres que você vê abaixo</body></html>'
  expect(detectBlock(cheerio.load(html), html, 'amazon.com.br')).toBeTruthy()
})

test('página normal de produto não é marcada como bloqueio', () => {
  const html = '<html><head><title>iPhone 15 128GB Preto | Loja</title></head><body><h1>iPhone 15</h1></body></html>'
  expect(detectBlock(cheerio.load(html), html, 'loja.com.br')).toBeNull()
})

test('REGRESSÃO: OutOfStock marca inStock=false (Amazon esgotada)', () => {
  const $ = cheerio.load(`<script type="application/ld+json">${JSON.stringify({
    '@type': 'Product',
    name: 'Esgotado',
    offers: { price: '69.00', availability: 'http://schema.org/OutOfStock' },
  })}</script>`)
  const ld = fromJsonLd($)
  expect(ld.inStock).toBe(false)
  expect(ld.rawPrice).toBeUndefined()
})

/* ─── resiliência a HTML hostil ────────────────────────────────── */

test('HTML malformado ou vazio não derruba o parser', () => {
  const casos = [
    '',
    'não sou html',
    '<html><body><div><p>sem fechar',
    '<script type="application/ld+json">{quebrado</script>',
    '<script type="application/ld+json">null</script>',
    '<script type="application/ld+json">[]</script>',
    '<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>',
  ]
  for (const html of casos) {
    const $ = cheerio.load(html)
    expect(() => fromJsonLd($)).not.toThrow()
    expect(() => detectBlock($, html, 'loja.com')).not.toThrow()
    expect(() => pickImage($, undefined, 'https://loja.com/p')).not.toThrow()
  }
})

test('JSON-LD com centenas de nós tem guarda contra laço infinito', () => {
  const graph = { '@graph': Array(200).fill({ '@type': 'Product', name: 'x', offers: { price: '1' } }) }
  const $ = cheerio.load(`<script type="application/ld+json">${JSON.stringify(graph)}</script>`)
  const t = performance.now()
  expect(() => fromJsonLd($)).not.toThrow()
  expect(performance.now() - t).toBeLessThan(2000)
})

test('página com milhares de imagens não trava a seleção', () => {
  const html = Array.from({ length: 3000 }, (_, i) => `<img src="/i${i}.jpg" width="10" height="10">`).join('')
  const $ = cheerio.load(html)
  const t = performance.now()
  expect(() => pickImage($, undefined, 'https://loja.com/p')).not.toThrow()
  expect(performance.now() - t).toBeLessThan(3000)
})
