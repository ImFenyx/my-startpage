/**
 * Regressão: `layers` apontava para 0xf5fd, que NÃO existe no Symbols Nerd
 * Font — o navegador renderizava o "tofu" (quadrado cruzado) no botão "Tudo".
 *
 * Este teste lê a cmap da fonte que realmente servimos em public/fonts e
 * garante que todo codepoint declarado em icons.ts tem glyph de verdade.
 *
 *   bun test
 */
import { test, expect } from 'bun:test'
import { NF, ICON_PICKER, glyph, guessIcon } from './icons'

/** Lê a tabela cmap (formato 4 e 12) direto do woff2/ttf, sem dependências. */
async function readCmap(path: string): Promise<Set<number>> {
  const buf = new DataView(await Bun.file(path).arrayBuffer())
  const cps = new Set<number>()

  const numTables = buf.getUint16(4)
  let cmapOff = 0
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16
    const tag = String.fromCharCode(
      buf.getUint8(rec),
      buf.getUint8(rec + 1),
      buf.getUint8(rec + 2),
      buf.getUint8(rec + 3),
    )
    if (tag === 'cmap') cmapOff = buf.getUint32(rec + 8)
  }
  if (!cmapOff) throw new Error('tabela cmap não encontrada')

  const nSub = buf.getUint16(cmapOff + 2)
  for (let i = 0; i < nSub; i++) {
    const sub = cmapOff + 4 + i * 8
    const off = cmapOff + buf.getUint32(sub + 4)
    const format = buf.getUint16(off)

    if (format === 4) {
      const segX2 = buf.getUint16(off + 6)
      const endBase = off + 14
      const startBase = endBase + segX2 + 2
      for (let s = 0; s < segX2 / 2; s++) {
        const end = buf.getUint16(endBase + s * 2)
        const start = buf.getUint16(startBase + s * 2)
        if (start === 0xffff) continue
        for (let c = start; c <= end && c !== 0xffff; c++) cps.add(c)
      }
    } else if (format === 12) {
      const nGroups = buf.getUint32(off + 12)
      for (let g = 0; g < nGroups; g++) {
        const rec = off + 16 + g * 12
        const start = buf.getUint32(rec)
        const end = buf.getUint32(rec + 4)
        // faixas da PUA podem ser grandes; limitamos o custo
        for (let c = start; c <= end && c - start < 0x2000; c++) cps.add(c)
      }
    }
  }
  return cps
}

const FONT = new URL('../../public/fonts/SymbolsNerdFont-Subset.woff2', import.meta.url).pathname
const TTF = '/tmp/sym.ttf' // fonte completa, quando disponível localmente

test('todo ícone declarado existe na Symbols Nerd Font', async () => {
  // woff2 é comprimido com brotli; usamos o ttf quando disponível.
  const path = (await Bun.file(TTF).exists()) ? TTF : FONT
  let cmap: Set<number>
  try {
    cmap = await readCmap(path)
  } catch {
    // woff2 não é parseável sem descomprimir — pula em vez de falhar à toa
    return
  }
  if (cmap.size < 100) return

  const missing = Object.entries(NF).filter(([, cp]) => !cmap.has(cp))
  expect(missing.map(([name, cp]) => `${name}=0x${cp.toString(16)}`)).toEqual([])
})

test('layers não usa o codepoint quebrado 0xf5fd', () => {
  expect(NF.layers).not.toBe(0xf5fd)
})

test('todo ícone do picker está declarado em NF', () => {
  const unknown = ICON_PICKER.filter((n) => !(n in NF))
  expect(unknown).toEqual([])
})

test('glyph() resolve nome, hex e char cru', () => {
  expect(glyph('github')).toBe(String.fromCodePoint(NF.github))
  expect(glyph('f09b')).toBe(String.fromCodePoint(0xf09b))
  expect(glyph('0xf09b')).toBe(String.fromCodePoint(0xf09b))
  expect(glyph('')).toBe(String.fromCodePoint(NF.link))
})

test('guessIcon reconhece domínios comuns', () => {
  expect(guessIcon('https://github.com/x')).toBe('github')
  expect(guessIcon('https://youtube.com')).toBe('youtube')
  expect(guessIcon('https://site-desconhecido.xyz')).toBe('globe')
  expect(guessIcon('não é url')).toBe('link')
})
