/**
 * Contraste WCAG — auditoria automatizada da paleta.
 *
 * Medição que motivou este teste (Catppuccin Mocha sobre o fundo base):
 *
 *   overlay1  #7f849c  →  4.44  reprova AA para texto normal
 *   overlay0  #6c7086  →  3.36  só passa em texto grande
 *   overlay0 sobre surface0 →  2.57  reprova tudo
 *
 * Havia 16 blocos de texto pequeno (0.62–0.68rem) usando essas cores —
 * datas de tarefas, contadores e legendas. Numa interface para TDAH, texto
 * que exige esforço para ler é atrito direto.
 *
 *   bun test src/lib/contrast.test.ts
 */
import { test, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/* ─── cálculo WCAG 2.1 ─────────────────────────────────────────── */

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

const PALETTE: Record<string, string> = {
  crust: '#11111b',
  mantle: '#181825',
  base: '#1e1e2e',
  surface0: '#313244',
  surface1: '#45475a',
  surface2: '#585b70',
  overlay0: '#6c7086',
  overlay1: '#7f849c',
  overlay2: '#9399b2',
  subtext0: '#a6adc8',
  subtext1: '#bac2de',
  text: '#cdd6f4',
  mauve: '#cba6f7',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  red: '#f38ba8',
  peach: '#fab387',
  blue: '#89b4fa',
  lavender: '#b4befe',
}

const AA_NORMAL = 4.5
const BACKGROUNDS = ['base', 'mantle', 'crust', 'surface0'] as const

/* ─── garantias sobre a paleta ─────────────────────────────────── */

test('subtext0 passa AA em todos os fundos usados', () => {
  for (const bg of BACKGROUNDS) {
    expect(contrast(PALETTE.subtext0, PALETTE[bg])).toBeGreaterThanOrEqual(AA_NORMAL)
  }
})

test('cores de destaque passam AA sobre o fundo', () => {
  for (const c of ['mauve', 'green', 'yellow', 'red', 'peach', 'blue', 'lavender', 'text']) {
    expect(contrast(PALETTE[c], PALETTE.base)).toBeGreaterThanOrEqual(AA_NORMAL)
  }
})

test('documenta as cores que NÃO servem para texto pequeno', () => {
  // se algum dia isto passar, a paleta mudou e o teste abaixo pode relaxar
  expect(contrast(PALETTE.overlay0, PALETTE.base)).toBeLessThan(AA_NORMAL)
  expect(contrast(PALETTE.overlay1, PALETTE.base)).toBeLessThan(AA_NORMAL)
})

/* ─── varredura do código ──────────────────────────────────────── */

const SRC = new URL('..', import.meta.url).pathname

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return walk(p)
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : []
  })
}

/** Texto abaixo de 0.75rem conta como "normal" para o WCAG (não é large text). */
const SMALL_TEXT = /text-\[0\.(6\d|7[0-4])rem\]/

test('REGRESSÃO: texto pequeno não usa overlay0/overlay1', () => {
  const offenders: string[] = []

  for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/className="([^"]*)"/g)) {
      const cls = m[1]
      if (!SMALL_TEXT.test(cls)) continue
      if (/\btext-overlay[01]\b/.test(cls)) {
        offenders.push(`${file.replace(SRC, '')}: ${cls.slice(0, 60)}`)
      }
    }
  }
  expect(offenders).toEqual([])
})

test('opacidade não anula o contraste de texto visível', () => {
  /**
   * `opacity-35` sobre subtext0 derruba o contraste efetivo abaixo de 3:1.
   * `opacity-0` é ignorado: são controles revelados no hover/focus, que ao
   * ficarem visíveis voltam a 100%.
   */
  const offenders: string[] = []
  for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/className="([^"]*)"/g)) {
      const cls = m[1]
      // `disabled:opacity-*` é isento no WCAG (controles inativos)
      const cleaned = cls.replace(/\bdisabled:opacity-\d+\b/g, '')
      const hit = /\bopacity-(\d+)\b/.exec(cleaned)
      if (!hit) continue
      const v = Number(hit[1])
      if (v === 0) continue // aparece no hover/focus
      if (v < 50) offenders.push(`${file.replace(SRC, '')}: opacity-${v}`)
    }
  }
  expect(offenders).toEqual([])
})
