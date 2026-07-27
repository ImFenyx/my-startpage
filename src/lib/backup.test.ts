/**
 * Testes de importação/exportação de backup — terceira rodada de auditoria.
 *
 * Vulnerabilidades encontradas:
 *
 *   1. `importAll` fazia `Object.entries(data).forEach(([k,v]) => save(k,v))`,
 *      ou seja, um arquivo JSON qualquer podia gravar QUALQUER chave do
 *      localStorage — inclusive `todoist_token`, sequestrando a credencial.
 *
 *   2. `exportAll` incluía `todoist_token` no arquivo. O backup existe para ser
 *      copiado entre máquinas ou enviado a alguém: vazava a credencial em
 *      texto plano.
 *
 *   bun test src/lib/backup.test.ts
 */
import { test, expect, beforeEach } from 'bun:test'

// localStorage mínimo em memória (o teste roda fora do navegador)
const mem = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size
  },
}
;(globalThis as any).window ??= {
  addEventListener() {},
  removeEventListener() {},
  location: { origin: 'http://localhost:5173' },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
}

const { exportAll, importAll } = await import('./storage')

beforeEach(() => mem.clear())

/* ─── importação ───────────────────────────────────────────────── */

test('REGRESSÃO: backup não pode injetar o token do Todoist', () => {
  const r = importAll({ todoist_token: 'token_do_atacante', 'notes:list': [{ id: '1' }] })
  expect(r.imported).toEqual(['notes:list'])
  expect(r.skipped).toContain('todoist_token')
  expect(mem.get('startpage:todoist_token')).toBeUndefined()
})

test('REGRESSÃO: chaves de prototype pollution são recusadas', () => {
  const payload = JSON.parse('{"__proto__":{"polluted":true},"constructor":{},"notes:list":[]}')
  const r = importAll(payload)
  expect(r.imported).toEqual(['notes:list'])
  expect(({} as any).polluted).toBeUndefined()
})

test('recusa chave desconhecida', () => {
  const r = importAll({ 'chave:aleatoria': 1, 'wishlist:items': [] })
  expect(r.imported).toEqual(['wishlist:items'])
  expect(r.skipped).toContain('chave:aleatoria')
})

test('recusa valor acima de 1 MB', () => {
  const r = importAll({ 'notes:list': 'x'.repeat(1_100_000) })
  expect(r.imported).toEqual([])
  expect(r.skipped[0]).toContain('1 MB')
})

test('recusa payload que não é objeto', () => {
  expect(() => importAll(null)).toThrow(/inválido/i)
  expect(() => importAll([1, 2, 3])).toThrow(/inválido/i)
  expect(() => importAll('texto')).toThrow(/inválido/i)
})

test('importa chaves válidas normalmente', () => {
  const r = importAll({
    'notes:list': [{ id: 'a', title: 'T' }],
    'pomodoro:cfg': { focus: 25 },
    'links:active': 'work',
  })
  expect(r.imported.sort()).toEqual(['links:active', 'notes:list', 'pomodoro:cfg'])
  expect(JSON.parse(mem.get('startpage:links:active')!)).toBe('work')
})

/* ─── exportação ───────────────────────────────────────────────── */

test('REGRESSÃO: export NÃO inclui o token do Todoist', () => {
  mem.set('startpage:todoist_token', '"0123456789abcdef"')
  mem.set('startpage:notes:list', '[{"id":"1"}]')

  const out = exportAll()
  expect(out).not.toHaveProperty('todoist_token')
  expect(out).toHaveProperty('notes:list')
  expect(JSON.stringify(out)).not.toContain('0123456789abcdef')
})

test('export ignora metadados internos de sync', () => {
  mem.set('startpage:__stamp:notes:list', '1700000000000')
  mem.set('startpage:notes:list', '[]')

  const out = exportAll()
  expect(Object.keys(out)).toEqual(['notes:list'])
})

test('ciclo export → import preserva os dados', () => {
  mem.set('startpage:notes:list', '[{"id":"x","title":"Nota"}]')
  mem.set('startpage:wishlist:items', '[{"id":"w"}]')

  const backup = exportAll()
  mem.clear()
  const r = importAll(backup)

  expect(r.imported.sort()).toEqual(['notes:list', 'wishlist:items'])
  expect(JSON.parse(mem.get('startpage:notes:list')!)[0].title).toBe('Nota')
})
