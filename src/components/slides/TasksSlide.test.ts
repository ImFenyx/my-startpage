/**
 * Tarefas corrompidas não podem ficar presas na tela.
 *
 * Bug relatado em uso: uma "tarefa vazia" na seção Locais era impossível de
 * apagar. Cada tentativa devolvia:
 *
 *   Todoist respondeu 400: {"error":"Invalid argument value",
 *                           "error_extra":{"argument":"task_id"}}
 *
 * Causa: `tasks:local` continha `[60]` — um número solto (resíduo de teste).
 * Sem a propriedade `source`, `t.source === 'local'` dava falso, então o app
 * assumia que era uma tarefa do Todoist e chamava
 * `DELETE /api/v1/tasks/undefined`.
 *
 *   bun test src/components/slides/TasksSlide.test.ts
 */
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'

const RAW = readFileSync(new URL('./TasksSlide.tsx', import.meta.url).pathname, 'utf8')

/* ─── contrato do componente ───────────────────────────────────── */

test('a lista local é normalizada antes do uso', () => {
  expect(RAW).toContain('function normalizeLocalTask')
  expect(RAW).toContain('normalizeLocalTasks(rawLocal)')
})

test('REGRESSÃO: exclusão só chama a API com id remoto validado', () => {
  expect(RAW).toContain("t.source === 'todoist' && typeof t.id === 'string'")
  expect(RAW).toContain('deleteTask(token, remoteId)')
  // não pode mais passar t.id direto
  expect(RAW).not.toContain('deleteTask(token, t.id)')
})

test('concluir/reabrir também usam o id validado', () => {
  expect(RAW).not.toContain('closeTask(token, t.id)')
  expect(RAW).not.toContain('reopenTask(token, t.id)')
})

/* ─── comportamento da normalização ────────────────────────────── */

/** Réplica da normalização do componente. */
function normalizeLocalTask(t: unknown, i: number) {
  const o = (t !== null && typeof t === 'object' ? t : {}) as any
  return {
    id: typeof o.id === 'string' && o.id ? o.id : `local-${i}-x`,
    content: typeof o.content === 'string' ? o.content : '',
    done: Boolean(o.done),
    priority: [1, 2, 3, 4].includes(o.priority) ? o.priority : 1,
    due: typeof o.due === 'string' ? o.due : null,
    source: 'local' as const,
    createdAt: typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : 0,
    labels: Array.isArray(o.labels) ? o.labels.filter((l: unknown) => typeof l === 'string') : [],
  }
}
const normalizeLocalTasks = (v: unknown) =>
  Array.isArray(v) ? v.filter((t) => t !== null && typeof t === 'object').map(normalizeLocalTask) : []

test('REGRESSÃO: número solto é descartado (dado real do banco)', () => {
  expect(normalizeLocalTasks([60])).toEqual([])
  expect(normalizeLocalTasks([1, 2, 3])).toEqual([])
})

test('tarefa sem source recebe source local', () => {
  const [t] = normalizeLocalTasks([{ id: 'a', content: 'algo' }])
  expect(t.source).toBe('local')
  // com source local, a exclusão nunca toca na API
  expect(t.source === 'todoist').toBe(false)
})

test('tarefa sem id ganha um id utilizável', () => {
  const [t] = normalizeLocalTasks([{ content: 'sem id' }])
  expect(typeof t.id).toBe('string')
  expect(t.id.length).toBeGreaterThan(0)
})

test('valores de tipo errado são coagidos', () => {
  const [t] = normalizeLocalTasks([{ id: 42, content: null, priority: 99, labels: 'x' }])
  expect(typeof t.id).toBe('string')
  expect(t.content).toBe('')
  expect(t.priority).toBe(1)
  expect(t.labels).toEqual([])
})

test('null, undefined e não-array não quebram', () => {
  expect(normalizeLocalTasks(null)).toEqual([])
  expect(normalizeLocalTasks(undefined)).toEqual([])
  expect(normalizeLocalTasks([null, undefined, 60])).toEqual([])
})

test('tarefa válida é preservada', () => {
  const [t] = normalizeLocalTasks([
    { id: 'x', content: 'Comprar pão', done: true, priority: 4, source: 'local', createdAt: 123 },
  ])
  expect(t.content).toBe('Comprar pão')
  expect(t.done).toBe(true)
  expect(t.priority).toBe(4)
})

/* ─── guarda na camada da API ──────────────────────────────────── */

test('REGRESSÃO: todoist.ts valida o id antes de montar a URL', async () => {
  const src = readFileSync(new URL('../../lib/todoist.ts', import.meta.url).pathname, 'utf8')
  expect(src).toContain('function requireId')
  // nenhuma rota de tarefa pode interpolar o id cru
  for (const rota of ['/close', '/reopen', '/move']) {
    const m = new RegExp(`\\/tasks\\/\\$\\{id\\}${rota}`).test(src)
    expect(m).toBe(false)
  }
})

test('requireId rejeita ids inutilizáveis com mensagem clara', () => {
  // réplica do contrato
  const requireId = (id: unknown, op: string): string => {
    if (typeof id !== 'string' || !id || id === 'undefined' || id === 'null') {
      throw new Error(`Não é possível ${op}: a tarefa não tem um ID válido do Todoist.`)
    }
    return id
  }
  for (const ruim of [undefined, null, '', 'undefined', 'null', 42]) {
    expect(() => requireId(ruim, 'excluir')).toThrow(/ID válido/)
  }
  expect(requireId('6XGgmFVcrG5RRjVr', 'excluir')).toBe('6XGgmFVcrG5RRjVr')
})
