/**
 * Regressão: colisão de namespace entre o Catppuccin e o Tailwind.
 *
 * Declaramos `--color-base` (o fundo #1e1e2e do Mocha) no @theme. O Tailwind v4
 * gera utilitários de cor a partir desses tokens, então `.text-base` deixou de
 * ser "tamanho de fonte base" e virou `color: var(--color-base)` — texto quase
 * preto sobre fundo escuro, ilegível.
 *
 * O mesmo vale para qualquer classe `text-<token>` cujo token exista na paleta.
 *
 *   bun test
 */
import { test, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('..', import.meta.url).pathname

/** Tokens de cor do @theme que colidem com utilitários nativos do Tailwind. */
const COLLIDING = ['base', 'text']

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return walk(p)
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : []
  })
}

const files = walk(SRC)

test('encontra arquivos para analisar', () => {
  expect(files.length).toBeGreaterThan(5)
})

/**
 * `text-base` é a armadilha principal: parece tamanho, mas o @theme o
 * transforma em cor de fundo escura. Para tamanho, use text-[1rem].
 */
test('nenhum componente usa text-base (virou cor por causa de --color-base)', () => {
  const offenders = files
    .map((f) => ({ f, hits: [...readFileSync(f, 'utf8').matchAll(/\btext-base\b/g)] }))
    .filter((x) => x.hits.length)
    .map((x) => x.f.replace(SRC, ''))

  expect(offenders).toEqual([])
})

/** Garante que a paleta realmente declara os tokens que causam a colisão. */
test('o @theme declara --color-base e --color-text', () => {
  const css = readFileSync(join(SRC, 'index.css'), 'utf8')
  for (const t of COLLIDING) {
    expect(css).toContain(`--color-${t}:`)
  }
})

/**
 * Títulos precisam de cor explícita legível. Se um <h2> não trouxer nenhuma
 * classe de cor, ele herda do contexto e pode sumir no fundo.
 */
test('todo <h2> tem classe de cor explícita', () => {
  const bad: string[] = []
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/<h2[^>]*className="([^"]*)"/g)) {
      const cls = m[1]
      if (!/\btext-(text|subtext0|subtext1|mauve|lavender|blue|green|peach|red)\b/.test(cls)) {
        bad.push(`${f.replace(SRC, '')}: ${cls}`)
      }
    }
  }
  expect(bad).toEqual([])
})

/**
 * Armadilha do optional chaining.
 *
 * `x?.body.trim()` protege apenas `x` — se `body` for undefined, quebra
 * exatamente igual. Foi assim que uma nota sem `body` derrubou o slide
 * inteiro em produção:
 *
 *   TypeError: Cannot read properties of undefined (reading 'trim')
 *
 * O correto é `x?.body?.trim()` ou `(x?.body ?? '').trim()`.
 */
test('REGRESSÃO: nenhum x?.prop.metodo() no código', () => {
  const METODOS = 'trim|map|filter|slice|toLowerCase|toUpperCase|replace|match|split|join|includes|padStart'
  const perigosos: string[] = []

  for (const f of files) {
    const semComentarios = readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

    for (const m of semComentarios.matchAll(new RegExp(`\\w+\\?\\.\\w+\\.(${METODOS})\\b`, 'g'))) {
      perigosos.push(`${f.replace(SRC, '')}: ${m[0]}`)
    }
  }
  expect(perigosos).toEqual([])
})
