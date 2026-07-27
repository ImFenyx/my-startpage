/**
 * Coerência entre as allowlists de chave.
 *
 * Bug relatado em uso: `400 Bad Request` a cada autosave.
 *
 * Causa: `tasks:groups` (cache das tarefas do Todoist) e `tasks:lastsync`
 * eram gravadas via `usePersistentState`, que espelha tudo no servidor — mas
 * não constavam na allowlist de `server/db.ts`. Pior: uma única chave
 * desconhecida fazia o `POST /api/sync` inteiro responder 400, então as
 * alterações VÁLIDAS do mesmo lote também se perdiam.
 *
 * Este teste cruza as três listas e falha se elas divergirem.
 *
 *   bun test src/lib/sync-keys.test.ts
 */
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../..', import.meta.url).pathname

const extrairSet = (src: string, nome: string): Set<string> => {
  const m = new RegExp(`${nome}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(src)
  if (!m) throw new Error(`não achei ${nome}`)
  return new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
}

const dbSrc = readFileSync(join(ROOT, 'server/db.ts'), 'utf8')
const syncSrc = readFileSync(join(ROOT, 'src/lib/sync.ts'), 'utf8')
const storageSrc = readFileSync(join(ROOT, 'src/lib/storage.ts'), 'utf8')

const SERVIDOR = extrairSet(dbSrc, 'ALLOWED_KEYS')
const CLIENTE = extrairSet(syncSrc, 'SYNCABLE')
const LOCAL_ONLY = extrairSet(storageSrc, 'LOCAL_ONLY')
const IMPORTAVEIS = extrairSet(storageSrc, 'IMPORTABLE')

/** Todas as chaves realmente usadas em usePersistentState. */
function chavesEmUso(): string[] {
  const out = new Set<string>()
  for (const f of [
    'src/App.tsx',
    'src/components/Pomodoro.tsx',
    'src/components/QuickLinks.tsx',
    'src/components/RightCarousel.tsx',
    'src/components/slides/TasksSlide.tsx',
    'src/components/slides/WishlistSlide.tsx',
    'src/components/slides/NotesSlide.tsx',
  ]) {
    const src = readFileSync(join(ROOT, f), 'utf8')
    for (const m of src.matchAll(/usePersistentState<[^>]*>\(\s*'([^']+)'/g)) out.add(m[1])
  }
  return [...out]
}

test('REGRESSÃO: toda chave persistida ou sincroniza ou é declarada local', () => {
  const orfas = chavesEmUso().filter((k) => !SERVIDOR.has(k) && !LOCAL_ONLY.has(k))
  // uma chave órfã = 400 a cada autosave
  expect(orfas).toEqual([])
})

test('allowlist do cliente é idêntica à do servidor', () => {
  expect([...CLIENTE].sort()).toEqual([...SERVIDOR].sort())
})

test('chaves locais nunca aparecem na allowlist do servidor', () => {
  const vazando = [...LOCAL_ONLY].filter((k) => SERVIDOR.has(k))
  expect(vazando).toEqual([])
})

test('tasks:groups e tasks:lastsync são locais (cache e carimbo)', () => {
  expect(LOCAL_ONLY.has('tasks:groups')).toBe(true)
  expect(LOCAL_ONLY.has('tasks:lastsync')).toBe(true)
})

test('o token do Todoist continua fora de tudo que trafega', () => {
  expect(LOCAL_ONLY.has('todoist_token')).toBe(true)
  expect(SERVIDOR.has('todoist_token')).toBe(false)
  expect(IMPORTAVEIS.has('todoist_token')).toBe(false)
})

test('lista de importação cobre o que o servidor sincroniza', () => {
  const faltando = [...SERVIDOR].filter((k) => !IMPORTAVEIS.has(k))
  expect(faltando).toEqual([])
})

test('POST em lote ignora chave desconhecida em vez de rejeitar o lote', () => {
  const idx = readFileSync(join(ROOT, 'server/index.ts'), 'utf8')
  const inicio = idx.indexOf(".post(\n          '/api/sync'")
  expect(inicio).toBeGreaterThan(-1)
  const bloco = idx.slice(inicio, inicio + 1800)

  // grava as válidas e reporta as demais
  expect(bloco).toContain('ignored')
  expect(bloco).toContain('accepted')
  // e NÃO pode abortar o lote inteiro por uma chave desconhecida
  expect(bloco).not.toMatch(/set\.status = 400[\s\S]{0,120}não é permitida/)
})
