/**
 * Saneamento de URLs vindas do usuário antes de virarem `href` ou `src`.
 *
 * O React 19 bloqueia `javascript:` sozinho, mas NÃO bloqueia:
 *
 *   data:text/html,<script>…</script>   → executa no nosso domínio
 *   vbscript:msgbox(1)                  → IE/Edge legado
 *   blob:https://evil.com/…             → conteúdo arbitrário
 *
 * Verificado com `renderToStaticMarkup`: os três atravessam intactos.
 * Como links da wishlist e dos atalhos são digitados/colados pelo usuário
 * (e podem vir de um backup JSON de terceiro), usamos allowlist de esquema.
 */

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/** Devolve a URL se for segura para navegação; senão, string vazia. */
export function safeHref(raw: string | undefined | null): string {
  if (!raw) return ''
  const s = String(raw).trim()
  if (!s) return ''

  // remove caracteres de controle usados para mascarar o esquema
  // (ex.: "java\0script:", "java\tscript:")
  const clean = s.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, '')

  try {
    const u = new URL(clean, window.location.origin)
    if (!SAFE_SCHEMES.has(u.protocol)) return ''

    /**
     * URLs protocol-relative (`//evil.com`) herdam o esquema da página e
     * resolvem para um host externo sem que isso fique aparente no texto
     * digitado. Como o link vem do usuário ou de um backup importado,
     * exigimos esquema explícito para destinos de outra origem.
     */
    if (clean.startsWith('//')) return ''

    return u.toString()
  } catch {
    return ''
  }
}

/**
 * URL de imagem. Aceita http(s), o proxy interno (`/api/img?...`) e data URIs
 * de imagem rasterizada (o upload manual da wishlist gera `data:image/...`).
 * Recusa `data:text/html` e `data:image/svg+xml`, que executam script.
 */
const SAFE_DATA_IMAGE = /^data:image\/(jpeg|jpg|png|gif|webp|avif|bmp);base64,[a-z0-9+/=\s]+$/i

export function safeImageSrc(raw: string | undefined | null): string {
  if (!raw) return ''
  const s = String(raw).trim()
  if (!s) return ''

  if (s.startsWith('/api/img?')) return s // nosso proxy, já validado no backend
  if (s.startsWith('data:')) return SAFE_DATA_IMAGE.test(s) ? s : ''

  try {
    const u = new URL(s, window.location.origin)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    // SVG remoto é XML executável: barra pela extensão aparente
    if (/\.svgz?($|\?)/i.test(u.pathname)) return ''
    return u.toString()
  } catch {
    return ''
  }
}

/** Normaliza o que o usuário digita ("github.com" → "https://github.com"). */
export function normalizeUserUrl(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`
  return safeHref(withScheme)
}
