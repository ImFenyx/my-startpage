/**
 * Testes da persistência SQLite.
 *
 *   bun test server/db.test.ts
 */
import { test, expect, beforeAll } from 'bun:test'

// banco temporário: não toca no arquivo real
process.env.DB_PATH = `/tmp/startpage-test-${Date.now()}.sqlite`

let store: typeof import('./db')
beforeAll(async () => {
  store = await import('./db')
})

test('grava e lê', () => {
  store.set('notes:list', [{ id: '1', title: 'A' }], 1000)
  const e = store.get('notes:list')
  expect(e?.value).toEqual([{ id: '1', title: 'A' }])
  expect(e?.updatedAt).toBe(1000)
})

test('last-write-wins: gravação mais nova vence', () => {
  store.set('notes:active', 'x', 1000)
  expect(store.set('notes:active', 'y', 2000)).toBe(true)
  expect(store.get('notes:active')?.value).toBe('y')
})

test('REGRESSÃO: gravação mais ANTIGA não sobrescreve a recente', () => {
  store.set('wishlist:filter', 'novo', 5000)
  const wrote = store.set('wishlist:filter', 'velho', 1000)
  expect(wrote).toBe(false)
  expect(store.get('wishlist:filter')?.value).toBe('novo')
})

test('chave inexistente devolve null', () => {
  expect(store.get('nao:existe')).toBeNull()
})

test('setMany é transacional', () => {
  const r = store.setMany([
    { key: 'links:active', value: 'work', updatedAt: 3000 },
    { key: 'carousel:index', value: 2, updatedAt: 3000 },
  ])
  expect(r['links:active']).toBe(true)
  expect(store.get('carousel:index')?.value).toBe(2)
})

test('guarda histórico de revisões', () => {
  store.set('tasks:view', 'inbox', 1000)
  store.set('tasks:view', 'all', 2000)
  const revs = store.revisions('tasks:view')
  expect(revs.length).toBeGreaterThanOrEqual(2)
  expect(revs[0].value).toBe('all') // mais recente primeiro
})

test('histórico é podado em 20 versões', () => {
  for (let i = 1; i <= 30; i++) store.set('pomodoro:cycles', i, 10_000 + i)
  expect(store.revisions('pomodoro:cycles', 100).length).toBeLessThanOrEqual(20)
})

test('rejeita valor acima de 1 MB', () => {
  expect(() => store.set('notes:list', 'x'.repeat(1_100_000), Date.now())).toThrow(/1 MB/)
})

test('allowlist não inclui o token do Todoist', () => {
  expect(store.ALLOWED_KEYS.has('todoist_token')).toBe(false)
  expect(store.ALLOWED_KEYS.has('notes:list')).toBe(true)
})

test('apaga chave', () => {
  store.set('links:active', 'temp', Date.now())
  store.del('links:active')
  expect(store.get('links:active')).toBeNull()
})

test('getAll devolve tudo', () => {
  const all = store.getAll()
  expect(all.length).toBeGreaterThan(0)
  expect(all.every((e) => typeof e.key === 'string')).toBe(true)
})

/* ─── terceira auditoria: crescimento do WAL ───────────────────── */

test('REGRESSÃO: gravar o MESMO conteúdo não cria revisão nova', () => {
  const key = 'wishlist:filter'
  store.set(key, 'igual', 900_000)
  const antes = store.revisions(key, 999).length

  // autosave real: dezenas de gravações idênticas
  for (let i = 1; i <= 50; i++) store.set(key, 'igual', 900_000 + i)

  expect(store.revisions(key, 999).length).toBe(antes)
})

test('conteúdo diferente continua gerando revisão', () => {
  const key = 'tasks:collapsed'
  store.set(key, ['a'], 950_000)
  store.set(key, ['b'], 950_001)
  expect(store.revisions(key, 999).length).toBeGreaterThanOrEqual(2)
})

test('maintenance() executa sem erro', () => {
  expect(() => store.maintenance()).not.toThrow()
})

/* ─── carimbos no futuro (bug relatado em uso) ─────────────────── */

test('REGRESSÃO: carimbo no futuro é fixado no horário do servidor', () => {
  const futuro = Date.now() + 180 * 86_400_000 // 6 meses à frente
  store.set('carousel:index', 7, futuro)

  const e = store.get('carousel:index')!
  expect(e.updatedAt).toBeLessThan(futuro)
  expect(e.updatedAt).toBeLessThanOrEqual(Date.now() + 1000)
})

test('REGRESSÃO: chave com data futura não trava contra novas gravações', () => {
  const key = 'links:active'
  store.set(key, 'travado', Date.now() + 999 * 86_400_000)

  // sem o saneamento, esta gravação seria recusada para sempre
  const wrote = store.set(key, 'novo', Date.now())
  expect(wrote).toBe(true)
  expect(store.get(key)?.value).toBe('novo')
})

test('sanitizeStamp preserva datas válidas', () => {
  const ontem = Date.now() - 86_400_000
  expect(store.sanitizeStamp(ontem)).toBe(ontem)
  const agora = Date.now()
  expect(store.sanitizeStamp(agora)).toBe(agora)
})

test('sanitizeStamp corrige valores inválidos', () => {
  const now = Date.now()
  expect(store.sanitizeStamp(0)).toBeGreaterThanOrEqual(now)
  expect(store.sanitizeStamp(-1)).toBeGreaterThanOrEqual(now)
  expect(store.sanitizeStamp(NaN)).toBeGreaterThanOrEqual(now)
})

test('repairFutureStamps conserta registros já gravados', () => {
  // simula linha corrompida escrevendo direto no banco
  const futuro = Date.now() + 200 * 86_400_000
  store.set('tasks:view', 'inbox', Date.now())
  store.db.query('UPDATE kv SET updated_at = ?1 WHERE k = ?2').run(futuro, 'tasks:view')

  const fixed = store.repairFutureStamps()
  expect(fixed.some((f) => f.key === 'tasks:view')).toBe(true)
  expect(store.get('tasks:view')!.updatedAt).toBeLessThanOrEqual(Date.now() + 1000)
})

/* ─── SQLITE_LOCKED em transação (bug relatado em uso) ─────────── */

test('REGRESSÃO: setMany repetido não dispara "database table is locked"', () => {
  /**
   * `maybeCheckpoint()` rodava DENTRO da transação de `setMany`. O SQLite
   * recusa `wal_checkpoint` com transação de escrita aberta e devolve
   * SQLITE_LOCKED. Como o autosave usa POST em lote, todo salvamento em
   * lote falhava assim que o contador de escritas atingia o limite.
   */
  const keys = ['notes:list', 'wishlist:items', 'links:categories', 'tasks:local', 'pomodoro:cfg']
  expect(() => {
    for (let round = 0; round < 15; round++) {
      store.setMany(
        keys.map((key, i) => ({
          key,
          value: { round, i, pad: 'x'.repeat(200) },
          updatedAt: Date.now() + round * 1000 + i,
        })),
      )
    }
  }).not.toThrow()
})

test('set() individual intercalado com setMany não trava', () => {
  expect(() => {
    for (let i = 0; i < 40; i++) {
      store.set('notes:active', `n${i}`, Date.now() + 500_000 + i)
      if (i % 4 === 0) {
        store.setMany([{ key: 'carousel:index', value: i, updatedAt: Date.now() + 600_000 + i }])
      }
    }
  }).not.toThrow()
})

test('maintenance() logo após transação não lança', () => {
  store.setMany([{ key: 'tasks:view', value: 'inbox', updatedAt: Date.now() + 700_000 }])
  expect(() => store.maintenance()).not.toThrow()
})

test('dados continuam corretos após lote + checkpoint', () => {
  const stamp = Date.now() + 800_000
  store.setMany([
    { key: 'links:active', value: 'work', updatedAt: stamp },
    { key: 'notes:active', value: 'abc', updatedAt: stamp },
  ])
  store.maintenance()
  expect(store.get('links:active')?.value).toBe('work')
  expect(store.get('notes:active')?.value).toBe('abc')
})
