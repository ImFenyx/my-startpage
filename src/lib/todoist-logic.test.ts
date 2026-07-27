/**
 * Testes de comportamento do cliente Todoist.
 *
 * Até aqui este módulo só tinha verificação estática (grep no código-fonte),
 * apesar de concentrar a lógica que gerou vários bugs em uso: migração da
 * REST v2 para a Unified v1, paginação por cursor, mapeamento de campos e
 * validação de id.
 *
 * O `fetch` é substituído por um duplo controlado, então nada sai da máquina.
 *
 *   bun test src/lib/todoist-logic.test.ts
 */
import { test, expect, beforeEach, afterEach } from 'bun:test'

// localStorage em memória (o módulo lê o token dele no import)
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

const todoist = await import('./todoist')

const realFetch = globalThis.fetch
type Rota = { status?: number; body?: unknown }
let rotas: Record<string, Rota | Rota[]> = {}
let chamadas: { url: string; method: string; body?: string }[] = []

beforeEach(() => {
  rotas = {}
  chamadas = []
  ;(globalThis as any).fetch = async (input: any, init: any = {}) => {
    const url = String(input)
    chamadas.push({ url, method: init.method ?? 'GET', body: init.body })

    const chave = Object.keys(rotas).find((k) => url.includes(k))
    if (!chave) return new Response('{}', { status: 200 })

    const entry = rotas[chave]
    const r = Array.isArray(entry) ? (entry.shift() ?? { status: 200, body: {} }) : entry
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }
})

afterEach(() => {
  globalThis.fetch = realFetch
})

const tarefaAPI = (over: Record<string, unknown> = {}) => ({
  id: '6XGgmFVcrG5RRjVr',
  content: 'Comprar pão',
  checked: false,
  priority: 1,
  child_order: 1,
  ...over,
})

/* ─── endpoints: a v2 foi desligada ────────────────────────────── */

test('REGRESSÃO: usa /api/v1, nunca a REST v2 desligada', async () => {
  rotas['/tasks/filter'] = { body: { results: [], next_cursor: null } }
  await todoist.fetchTasks('tok', 'inbox').catch(() => {})
  for (const c of chamadas) {
    expect(c.url).not.toContain('/rest/v2/')
    expect(c.url).toContain('/api/v1/')
  }
})

/* ─── paginação por cursor ─────────────────────────────────────── */

test('percorre todas as páginas via next_cursor', async () => {
  rotas['/projects'] = [
    { body: { results: [{ id: 'p1', name: 'Inbox', inbox_project: true }], next_cursor: 'c2' } },
    { body: { results: [{ id: 'p2', name: 'Outro' }], next_cursor: null } },
  ]
  rotas['/sections'] = { body: { results: [], next_cursor: null } }
  rotas['/tasks?'] = { body: { results: [tarefaAPI()], next_cursor: null } }

  const r = await todoist.fetchTasks('tok', 'inbox')
  expect(r.total).toBe(1)
  // duas chamadas a /projects: a segunda com o cursor
  const projetos = chamadas.filter((c) => c.url.includes('/projects'))
  expect(projetos.length).toBe(2)
  expect(projetos[1].url).toContain('cursor=c2')
})

/* ─── mapeamento de campos v1 ──────────────────────────────────── */

test('mapeia checked/priority/due para o modelo interno', async () => {
  rotas['/projects'] = { body: { results: [{ id: 'p1', name: 'Inbox', inbox_project: true }], next_cursor: null } }
  rotas['/sections'] = { body: { results: [], next_cursor: null } }
  rotas['/tasks?'] = {
    body: {
      results: [tarefaAPI({ priority: 4, due: { date: '2026-08-22T15:00:00' }, labels: ['casa'] })],
      next_cursor: null,
    },
  }

  const { groups } = await todoist.fetchTasks('tok', 'inbox')
  const t = groups.flatMap((g) => g.tasks)[0]
  expect(t.priority).toBe(4)
  expect(t.due).toBe('2026-08-22') // hora é descartada
  expect(t.source).toBe('todoist')
  expect(t.labels).toEqual(['casa'])
  expect(t.url).toContain('app.todoist.com')
})

test('tarefas concluídas e apagadas são filtradas', async () => {
  rotas['/projects'] = { body: { results: [{ id: 'p1', name: 'Inbox', inbox_project: true }], next_cursor: null } }
  rotas['/sections'] = { body: { results: [], next_cursor: null } }
  rotas['/tasks?'] = {
    body: {
      results: [
        tarefaAPI({ id: 'a' }),
        tarefaAPI({ id: 'b', checked: true }),
        tarefaAPI({ id: 'c', is_deleted: true }),
      ],
      next_cursor: null,
    },
  }
  const { total } = await todoist.fetchTasks('tok', 'inbox')
  expect(total).toBe(1)
})

/* ─── agrupamento por seção (a razão de existir da visão Inbox) ── */

test('agrupa pelas seções do Inbox, preservando ordem e vazias', async () => {
  rotas['/projects'] = { body: { results: [{ id: 'p1', name: 'Inbox', inbox_project: true }], next_cursor: null } }
  rotas['/sections'] = {
    body: {
      results: [
        { id: 's2', project_id: 'p1', name: 'Acadêmico', section_order: 2 },
        { id: 's1', project_id: 'p1', name: 'Pessoal', section_order: 1 },
        { id: 's3', project_id: 'p1', name: 'Trabalho', section_order: 3 },
      ],
      next_cursor: null,
    },
  }
  rotas['/tasks?'] = {
    body: {
      results: [
        tarefaAPI({ id: 'a', section_id: 's1', content: 'Casamento' }),
        tarefaAPI({ id: 'b', section_id: 's2', content: 'Prova' }),
        tarefaAPI({ id: 'c', content: 'Solta' }),
      ],
      next_cursor: null,
    },
  }

  const { groups } = await todoist.fetchTasks('tok', 'inbox')
  expect(groups.map((g) => g.name)).toEqual(['Sem seção', 'Pessoal', 'Acadêmico', 'Trabalho'])
  expect(groups.find((g) => g.name === 'Trabalho')!.tasks).toEqual([]) // vazia é mantida
  expect(groups.find((g) => g.name === 'Pessoal')!.tasks[0].content).toBe('Casamento')
})

test('ordena por prioridade e depois por day_order', async () => {
  rotas['/projects'] = { body: { results: [{ id: 'p1', name: 'Inbox', inbox_project: true }], next_cursor: null } }
  rotas['/sections'] = { body: { results: [], next_cursor: null } }
  rotas['/tasks?'] = {
    body: {
      results: [
        tarefaAPI({ id: 'a', content: 'p4', priority: 1, day_order: 1 }),
        tarefaAPI({ id: 'b', content: 'p1', priority: 4, day_order: 5 }),
        tarefaAPI({ id: 'c', content: 'p2', priority: 3, day_order: 2 }),
      ],
      next_cursor: null,
    },
  }
  const { groups } = await todoist.fetchTasks('tok', 'inbox')
  expect(groups.flatMap((g) => g.tasks).map((t) => t.content)).toEqual(['p1', 'p2', 'p4'])
})

/* ─── erros traduzidos ─────────────────────────────────────────── */

test('401 explica que o token é inválido', async () => {
  rotas['/user'] = { status: 401, body: { error: 'Unauthorized' } }
  await expect(todoist.verifyToken('ruim')).rejects.toThrow(/Token inválido|401/i)
})

test('429 orienta a aguardar', async () => {
  rotas['/user'] = { status: 429, body: {} }
  await expect(todoist.verifyToken('t')).rejects.toThrow(/Muitas requisições|429/i)
})

test('410 avisa sobre endpoint descontinuado', async () => {
  rotas['/user'] = { status: 410, body: {} }
  await expect(todoist.verifyToken('t')).rejects.toThrow(/desativado|410/i)
})

test('sem token, falha antes de qualquer requisição', async () => {
  await expect(todoist.fetchTasks('', 'inbox')).rejects.toThrow(/token/i)
  expect(chamadas.length).toBe(0)
})

/* ─── validação de id (bug da tarefa fantasma) ─────────────────── */

test('REGRESSÃO: id inválido falha localmente, sem gerar 400 na API', async () => {
  for (const ruim of ['', 'undefined', 'null']) {
    await expect(todoist.deleteTask('tok', ruim)).rejects.toThrow(/ID válido/)
  }
  expect(chamadas.length).toBe(0) // nenhuma requisição saiu
})

test('id válido chega à API com o método correto', async () => {
  rotas['/tasks/'] = { status: 204, body: null }
  await todoist.deleteTask('tok', '6XGgmFVcrG5RRjVr')
  expect(chamadas[0].method).toBe('DELETE')
  expect(chamadas[0].url).toContain('/api/v1/tasks/6XGgmFVcrG5RRjVr')
})

/* ─── Quick Add ────────────────────────────────────────────────── */

test('criação usa Quick Add com o texto em linguagem natural', async () => {
  rotas['/tasks/quick'] = { body: tarefaAPI({ content: 'Pagar boleto' }) }
  const t = await todoist.createTask('tok', 'Pagar boleto amanhã 9h #Casa p1')
  expect(chamadas[0].url).toContain('/tasks/quick')
  expect(JSON.parse(chamadas[0].body!).text).toBe('Pagar boleto amanhã 9h #Casa p1')
  expect(t.source).toBe('todoist')
})

/* ─── fallback pelo proxy ──────────────────────────────────────── */

test('rede bloqueada cai no proxy local do Elysia', async () => {
  let primeira = true
  ;(globalThis as any).fetch = async (input: any) => {
    const url = String(input)
    chamadas.push({ url, method: 'GET' })
    if (primeira && url.startsWith('https://api.todoist.com')) {
      primeira = false
      throw new TypeError('Failed to fetch') // adblock / DNS
    }
    return new Response(JSON.stringify({ full_name: 'Fulano' }), { status: 200 })
  }

  const nome = await todoist.verifyToken('tok')
  expect(nome).toBe('Fulano')
  expect(chamadas[0].url).toContain('api.todoist.com')
  expect(chamadas[1].url).toContain('/api/todoist/')
})

/* ─── token ────────────────────────────────────────────────────── */

test('token é lido e gravado no localStorage', () => {
  todoist.setToken('abc123')
  expect(todoist.getToken()).toBe('abc123')
  todoist.setToken('')
  expect(todoist.getToken()).toBe('')
})
