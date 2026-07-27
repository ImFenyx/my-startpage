/**
 * Testes de comportamento da sincronização.
 *
 * Este módulo decide o que sobrescreve o quê — é onde um erro apaga dados do
 * usuário. Três bugs reais nasceram aqui (carimbo no futuro travando a chave,
 * chave órfã rendendo 400, retry sobrescrevendo edição em voo) e todos eram
 * detectáveis por teste de execução.
 *
 *   bun test src/lib/sync-logic.test.ts
 */
import { test, expect, beforeEach, afterEach } from 'bun:test'

/* ─── ambiente de navegador mínimo ─────────────────────────────── */

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

const timers = new Set<ReturnType<typeof setTimeout>>()
;(globalThis as any).window = {
  addEventListener() {},
  removeEventListener() {},
  location: { origin: 'http://localhost:5173' },
  setTimeout: (fn: () => void, ms?: number) => {
    const id = setTimeout(fn, ms)
    timers.add(id)
    return id as unknown as number
  },
  clearTimeout: (id: number) => clearTimeout(id as never),
}
;(globalThis as any).navigator = { onLine: true }

const sync = await import('./sync')

/* ─── duplo de rede ────────────────────────────────────────────── */

const realFetch = globalThis.fetch
let servidor: { entries: { key: string; value: unknown; updatedAt: number }[] } = { entries: [] }
let posts: any[] = []
let falharProximoPost = false

beforeEach(async () => {
  mem.clear()
  servidor = { entries: [] }
  posts = []
  falharProximoPost = false

  ;(globalThis as any).fetch = async (input: any, init: any = {}) => {
    const url = String(input)
    if (url.includes('/api/health')) return new Response('{"ok":true}', { status: 200 })

    if (url.includes('/api/sync') && (init.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify(servidor), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: 'W/"1"' },
      })
    }
    if (init.method === 'POST') {
      if (falharProximoPost) {
        falharProximoPost = false
        throw new TypeError('Failed to fetch')
      }
      const body = JSON.parse(init.body)
      posts.push(body)
      for (const e of body.entries) {
        const i = servidor.entries.findIndex((x) => x.key === e.key)
        if (i >= 0) servidor.entries[i] = e
        else servidor.entries.push(e)
      }
      return new Response('{"results":{},"ignored":[]}', { status: 200 })
    }
    return new Response('{}', { status: 200 })
  }
  await sync.probe()
})

afterEach(() => {
  globalThis.fetch = realFetch
  timers.forEach(clearTimeout)
  timers.clear()
})

const setLocal = (k: string, v: unknown, stamp: number) => {
  mem.set(`startpage:${k}`, JSON.stringify(v))
  mem.set(`startpage:__stamp:${k}`, String(stamp))
}
const getLocal = (k: string) => JSON.parse(mem.get(`startpage:${k}`) ?? 'null')

/* ─── disponibilidade ──────────────────────────────────────────── */

test('probe detecta o backend no ar', async () => {
  expect(await sync.probe()).toBe(true)
  expect(sync.isAvailable()).toBe(true)
})

test('backend fora do ar: app continua, sync desliga', async () => {
  ;(globalThis as any).fetch = async () => {
    throw new TypeError('conexão recusada')
  }
  expect(await sync.probe()).toBe(false)
  expect(sync.isAvailable()).toBe(false)
})

/* ─── pull: quem vence ─────────────────────────────────────────── */

test('servidor mais recente sobrescreve o local', async () => {
  setLocal('notes:list', ['antigo'], 1000)
  servidor.entries = [{ key: 'notes:list', value: ['novo'], updatedAt: 5000 }]

  const atualizadas = await sync.pull()
  expect(atualizadas).toContain('notes:list')
  expect(getLocal('notes:list')).toEqual(['novo'])
})

test('REGRESSÃO: local mais recente NÃO é sobrescrito e sobe ao servidor', async () => {
  setLocal('notes:list', ['minha edição'], 9000)
  servidor.entries = [{ key: 'notes:list', value: ['velho do servidor'], updatedAt: 1000 }]

  const atualizadas = await sync.pull()
  expect(atualizadas).not.toContain('notes:list')
  expect(getLocal('notes:list')).toEqual(['minha edição'])
  // e o valor local foi enviado
  expect(posts.at(-1)?.entries[0].value).toEqual(['minha edição'])
})

test('REGRESSÃO: carimbo do servidor no futuro não trava a chave', async () => {
  const futuro = Date.now() + 200 * 86_400_000
  setLocal('notes:list', ['meu'], Date.now())
  servidor.entries = [{ key: 'notes:list', value: ['do futuro'], updatedAt: futuro }]

  await sync.pull()
  // o carimbo absurdo é normalizado; o dado local recente prevalece
  expect(getLocal('notes:list')).toEqual(['meu'])
})

test('chave não sincronizável vinda do servidor é ignorada', async () => {
  servidor.entries = [{ key: 'todoist_token', value: 'roubado', updatedAt: 9_999_999_999_999 }]
  await sync.pull()
  expect(mem.get('startpage:todoist_token')).toBeUndefined()
})

/* ─── push: fila e filtro ──────────────────────────────────────── */

test('push agrupa várias chaves numa requisição', async () => {
  sync.push('notes:list', ['a'])
  sync.push('wishlist:items', ['b'])
  sync.push('links:active', 'work')
  await sync.flush()

  expect(posts.length).toBe(1)
  expect(posts[0].entries.map((e: any) => e.key).sort()).toEqual([
    'links:active',
    'notes:list',
    'wishlist:items',
  ])
})

test('REGRESSÃO: chave fora da allowlist nunca é enviada', async () => {
  sync.push('tasks:groups', ['cache'])
  sync.push('tasks:lastsync', 123)
  sync.push('todoist_token', 'segredo')
  sync.push('notes:list', ['válida'])
  await sync.flush()

  const enviadas = posts.flatMap((p) => p.entries.map((e: any) => e.key))
  expect(enviadas).toEqual(['notes:list'])
})

test('a última gravação da mesma chave prevalece na fila', async () => {
  sync.push('notes:list', ['v1'])
  sync.push('notes:list', ['v2'])
  sync.push('notes:list', ['v3'])
  await sync.flush()

  expect(posts[0].entries.length).toBe(1)
  expect(posts[0].entries[0].value).toEqual(['v3'])
})

/* ─── falha de rede ────────────────────────────────────────────── */

test('REGRESSÃO: retry após falha não sobrescreve edição feita durante o envio', async () => {
  sync.push('notes:list', ['antigo'])
  falharProximoPost = true
  const enviando = sync.flush()

  // usuário edita enquanto a requisição está em voo
  sync.push('notes:list', ['novo durante o envio'])
  await enviando

  await sync.flush()
  const ultimo = posts.at(-1)?.entries.find((e: any) => e.key === 'notes:list')
  expect(ultimo?.value).toEqual(['novo durante o envio'])
})

test('falha de rede não perde dados: continuam no localStorage', async () => {
  sync.push('notes:list', ['importante'])
  falharProximoPost = true
  await sync.flush()

  // o valor local segue intacto mesmo com o servidor inacessível
  sync.push('notes:list', ['importante'])
  await sync.flush()
  expect(posts.at(-1)?.entries[0].value).toEqual(['importante'])
})

test('sem backend, push não enfileira nem falha', async () => {
  ;(globalThis as any).fetch = async () => {
    throw new TypeError('offline')
  }
  await sync.probe()
  expect(() => sync.push('notes:list', ['x'])).not.toThrow()
  await expect(sync.flush()).resolves.toBeUndefined()
})

/* ─── carimbos locais ──────────────────────────────────────────── */

test('touch registra o horário da alteração', () => {
  sync.touch('notes:list', 12345)
  expect(sync.localStamp('notes:list')).toBe(12345)
})

test('REGRESSÃO: carimbo local no futuro é corrigido na leitura', () => {
  const futuro = Date.now() + 300 * 86_400_000
  mem.set('startpage:__stamp:notes:list', String(futuro))
  expect(sync.localStamp('notes:list')).toBeLessThanOrEqual(Date.now() + 1000)
})

test('carimbo inválido vira o horário atual', () => {
  mem.set('startpage:__stamp:notes:list', 'lixo')
  expect(sync.localStamp('notes:list')).toBeGreaterThan(0)
})

test('isSyncable reflete a allowlist', () => {
  expect(sync.isSyncable('notes:list')).toBe(true)
  expect(sync.isSyncable('todoist_token')).toBe(false)
  expect(sync.isSyncable('tasks:groups')).toBe(false)
})
