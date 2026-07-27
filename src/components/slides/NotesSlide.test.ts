/**
 * Notas malformadas não podem derrubar o slide.
 *
 * Bug relatado em uso:
 *   TypeError: Cannot read properties of undefined (reading 'trim')
 *   at NotesSlide (NotesSlide.tsx:137)
 *
 * Causa: `active?.body.trim()` — o optional chaining protege `active`, mas
 * NÃO se propaga para `.trim()`. Bastava uma nota sem `body` (backup antigo,
 * importação de terceiro ou gravação parcial do sync) para o componente
 * inteiro quebrar. O dado real encontrado no banco era `[{"id":"40"}]`.
 *
 *   bun test src/components/slides/NotesSlide.test.ts
 */
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'

const RAW = readFileSync(new URL('./NotesSlide.tsx', import.meta.url).pathname, 'utf8')

/** Código sem comentários — o padrão perigoso é citado na documentação. */
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/* ─── o padrão perigoso não pode voltar ────────────────────────── */

test('REGRESSÃO: nenhum acesso a .body/.title sem proteção', () => {
  // `x?.body.` é a armadilha: parece seguro, mas quebra se body for undefined
  const perigosos = [...SRC.matchAll(/\w+\?\.(body|title)\.\w+/g)].map((m) => m[0])
  expect(perigosos).toEqual([])
})

test('a lista de notas é normalizada antes do uso', () => {
  expect(RAW).toContain('function normalizeNote')
  expect(RAW).toContain('normalizeNotes(rawNotes)')
})

/* ─── comportamento da normalização ────────────────────────────── */

/** Réplica da normalização do componente, para testar o contrato. */
function normalizeNote(n: unknown, i: number) {
  const o = (n ?? {}) as any
  return {
    id: typeof o.id === 'string' && o.id ? o.id : `nota-${i}-x`,
    title: typeof o.title === 'string' ? o.title : 'Sem título',
    body: typeof o.body === 'string' ? o.body : '',
    updatedAt: typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : 0,
    pinned: Boolean(o.pinned),
  }
}
const normalizeNotes = (v: unknown) => (Array.isArray(v) ? v.map(normalizeNote) : [])

test('REGRESSÃO: nota sem body vira string vazia (dado real do banco)', () => {
  const [n] = normalizeNotes([{ id: '40' }])
  expect(n.body).toBe('')
  expect(n.title).toBe('Sem título')
  // a operação que quebrava agora é segura
  expect(() => n.body.trim().match(/\S+/g)).not.toThrow()
})

test('contagem de palavras funciona com nota vazia', () => {
  const [n] = normalizeNotes([{ id: '1' }])
  const words = ((n.body ?? '').trim().match(/\S+/g) ?? []).length
  expect(words).toBe(0)
})

test('valores de tipo errado são coagidos com segurança', () => {
  const [n] = normalizeNotes([{ id: 42, title: null, body: { x: 1 }, updatedAt: 'ontem' }])
  expect(typeof n.id).toBe('string')
  expect(typeof n.title).toBe('string')
  expect(typeof n.body).toBe('string')
  expect(typeof n.updatedAt).toBe('number')
})

test('null, undefined e não-array não quebram', () => {
  expect(normalizeNotes(null)).toEqual([])
  expect(normalizeNotes(undefined)).toEqual([])
  expect(normalizeNotes('texto')).toEqual([])
  expect(normalizeNotes([null, undefined])[0].body).toBe('')
})

test('nota válida passa intacta', () => {
  const orig = { id: 'a', title: 'Minha nota', body: '# oi', updatedAt: 1700000000000, pinned: true }
  expect(normalizeNotes([orig])[0]).toEqual(orig)
})
