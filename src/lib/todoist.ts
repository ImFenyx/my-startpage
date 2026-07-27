import type { Task } from './types'

/**
 * Todoist — Unified API v1.
 *
 * ⚠️ A REST API v2 (`/rest/v2/*`) foi DESLIGADA (retorna 410 Gone).
 * Tudo agora vive sob `https://api.todoist.com/api/v1/`, com respostas
 * paginadas no formato `{ results: [...], next_cursor }`.
 *
 * O endpoint público manda CORS refletindo o Origin, então a chamada
 * direta do navegador funciona. Se algo no meio do caminho bloquear
 * (adblock, extensão de privacidade, DNS, rede corporativa), caímos
 * automaticamente no proxy do backend Elysia em /api/todoist/*.
 */
const API = 'https://api.todoist.com/api/v1'
const PROXY = '/api/todoist'

export type TodoistTask = {
  id: string
  content: string
  description?: string
  checked: boolean
  priority: number // 4 = p1 (urgente) … 1 = p4
  project_id?: string
  section_id?: string | null
  parent_id?: string | null
  child_order?: number
  day_order?: number
  labels?: string[]
  due?: { date: string; string?: string; is_recurring?: boolean; lang?: string } | null
  deadline?: { date: string } | null
  is_deleted?: boolean
}

export type TodoistProject = {
  id: string
  name: string
  /** A API v1 já expôs esse flag com nomes diferentes; tratamos os dois. */
  inbox_project?: boolean
  is_inbox_project?: boolean
  child_order?: number
  is_archived?: boolean
  is_deleted?: boolean
}

export type TodoistSection = {
  id: string
  project_id: string
  name: string
  section_order?: number
  is_archived?: boolean
  is_deleted?: boolean
}

type Paginated<T> = { results: T[]; next_cursor: string | null }

/** Modos de visualização do slide de tarefas. */
export type ViewMode = 'inbox' | 'all'

export const VIEWS: { id: ViewMode; label: string; icon: string; hint: string }[] = [
  { id: 'inbox', label: 'Inbox', icon: 'folder', hint: 'Inbox completo, agrupado por seção' },
  { id: 'all', label: 'Tudo', icon: 'layers', hint: 'Todas as tarefas ativas, por projeto' },
]

export function getToken(): string {
  return localStorage.getItem('startpage:todoist_token') ?? ''
}

export function setToken(t: string) {
  if (t) localStorage.setItem('startpage:todoist_token', t)
  else localStorage.removeItem('startpage:todoist_token')
}

/** Mensagens de erro em português, com a causa provável. */
function describe(status: number, body: string) {
  const short = body.replace(/\s+/g, ' ').trim().slice(0, 140)
  switch (status) {
    case 401:
      return 'Token inválido ou expirado (401). Copie novamente em Todoist → Configurações → Integrações → Desenvolvedor.'
    case 403:
      return 'Acesso negado (403). O token não tem permissão para este recurso.'
    case 404:
      return 'Recurso não encontrado (404). A tarefa pode ter sido apagada no Todoist.'
    case 410:
      return 'Endpoint desativado (410). Esta versão da API foi descontinuada pelo Todoist.'
    case 429:
      return 'Muitas requisições (429). Aguarde alguns segundos antes de sincronizar de novo.'
    default:
      return `Todoist respondeu ${status}${short ? `: ${short}` : ''}`
  }
}

/**
 * Faz a chamada direto na API; se a rede falhar (TypeError = CORS,
 * DNS, offline, extensão bloqueando), tenta de novo pelo proxy local.
 */
async function req<T>(path: string, token: string, init: RequestInit = {}): Promise<T | null> {
  if (!token) throw new Error('Nenhum token configurado.')

  const options: RequestInit = {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  }

  let res: Response
  try {
    res = await fetch(API + path, options)
  } catch {
    // Chamada direta falhou antes de chegar numa resposta HTTP → tenta o proxy.
    try {
      res = await fetch(PROXY + path, options)
    } catch {
      throw new Error(
        'Não foi possível alcançar o Todoist. Verifique sua conexão, ' +
          'desative bloqueadores para esta página ou rode o backend (bun run dev) para usar o proxy.',
      )
    }
  }

  if (!res.ok) throw new Error(describe(res.status, await res.text().catch(() => '')))
  if (res.status === 204) return null
  const text = await res.text()
  return text ? (JSON.parse(text) as T) : null
}

/** Percorre todas as páginas de um endpoint paginado. */
async function paginate<T>(base: string, token: string, cap = 600): Promise<T[]> {
  const out: T[] = []
  let cursor: string | null = null
  const sep = base.includes('?') ? '&' : '?'

  do {
    const url: string = `${base}${sep}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const page: Paginated<T> | null = await req<Paginated<T>>(url, token)
    if (!page) break
    out.push(...(page.results ?? []))
    cursor = page.next_cursor
  } while (cursor && out.length < cap)

  return out
}

/** Converte o objeto da API v1 no nosso `Task`. */
function toTask(t: TodoistTask): Task {
  return {
    id: t.id,
    content: t.content,
    done: Boolean(t.checked),
    priority: Math.min(4, Math.max(1, t.priority ?? 1)) as 1 | 2 | 3 | 4,
    // `due.date` pode vir como "2026-07-26" ou "2026-07-26T15:00:00"
    due: t.due?.date ? t.due.date.slice(0, 10) : null,
    url: `https://app.todoist.com/app/task/${t.id}`,
    source: 'todoist',
    createdAt: Date.now(),
    sectionId: t.section_id ?? null,
    projectId: t.project_id ?? null,
    parentId: t.parent_id ?? null,
    labels: t.labels ?? [],
  }
}

const alive = (x: { is_deleted?: boolean; is_archived?: boolean }) => !x.is_deleted && !x.is_archived

function sortTasks(a: TodoistTask, b: TodoistTask) {
  return (
    b.priority - a.priority ||
    (a.day_order ?? 9999) - (b.day_order ?? 9999) ||
    (a.child_order ?? 0) - (b.child_order ?? 0)
  )
}

/** Valida o token e devolve o nome do usuário (usado no botão "Testar"). */
export async function verifyToken(token: string): Promise<string> {
  const user = await req<{ full_name?: string; email?: string }>('/user', token)
  return user?.full_name || user?.email || 'conta conectada'
}

export type TaskGroup = {
  id: string
  name: string
  icon?: string
  tasks: Task[]
}

export type FetchResult = {
  groups: TaskGroup[]
  total: number
}

/** Acha o projeto Inbox (o flag mudou de nome entre versões da API). */
export async function findInbox(token: string): Promise<TodoistProject | null> {
  const projects = await paginate<TodoistProject>('/projects', token)
  return (
    projects.find((p) => p.inbox_project === true || p.is_inbox_project === true) ??
    projects.find((p) => p.name.toLowerCase() === 'inbox') ??
    null
  )
}

/**
 * Busca as tarefas conforme o modo escolhido, já agrupadas.
 *
 * - inbox → TODAS as tarefas do Inbox, agrupadas pelas SEÇÕES do projeto
 * - all   → todas as tarefas ativas, agrupadas por projeto
 */
export async function fetchTasks(token: string, mode: ViewMode): Promise<FetchResult> {
  return mode === 'inbox' ? fetchInboxGrouped(token) : fetchAllGrouped(token)
}

/** Inbox completo, agrupado pelas seções reais do projeto. */
async function fetchInboxGrouped(token: string): Promise<FetchResult> {
  const inbox = await findInbox(token)
  if (!inbox) throw new Error('Não foi possível localizar o projeto Inbox na sua conta.')

  const [sections, raw] = await Promise.all([
    paginate<TodoistSection>(`/sections?project_id=${inbox.id}`, token),
    paginate<TodoistTask>(`/tasks?project_id=${inbox.id}`, token),
  ])

  const tasks = raw.filter((t) => alive(t) && !t.checked).sort(sortTasks)

  const ordered = sections
    .filter(alive)
    .sort((a, b) => (a.section_order ?? 0) - (b.section_order ?? 0))

  const groups: TaskGroup[] = []

  // tarefas soltas (sem seção) primeiro, como no app do Todoist
  const loose = tasks.filter((t) => !t.section_id).map(toTask)
  if (loose.length) groups.push({ id: '__none__', name: 'Sem seção', icon: 'dots', tasks: loose })

  for (const s of ordered) {
    const list = tasks.filter((t) => t.section_id === s.id).map(toTask)
    // mantém a seção visível mesmo vazia, espelhando o app (ex.: "Trabalho")
    groups.push({ id: s.id, name: s.name, icon: 'folder', tasks: list })
  }

  return { groups, total: tasks.length }
}

/** Todas as tarefas ativas, agrupadas por projeto. */
async function fetchAllGrouped(token: string): Promise<FetchResult> {
  const [projects, raw] = await Promise.all([
    paginate<TodoistProject>('/projects', token),
    paginate<TodoistTask>('/tasks', token),
  ])

  const tasks = raw.filter((t) => alive(t) && !t.checked).sort(sortTasks)
  const byId = new Map(projects.filter(alive).map((p) => [p.id, p]))

  const groups: TaskGroup[] = []
  for (const p of projects
    .filter(alive)
    .sort(
      (a, b) =>
        Number(b.inbox_project ?? b.is_inbox_project ?? false) -
          Number(a.inbox_project ?? a.is_inbox_project ?? false) ||
        (a.child_order ?? 0) - (b.child_order ?? 0),
    )) {
    const list = tasks.filter((t) => t.project_id === p.id).map(toTask)
    if (list.length) groups.push({ id: p.id, name: p.name, icon: 'folder', tasks: list })
  }

  // tarefas de projetos que não vieram na listagem (compartilhados, etc.)
  const orphans = tasks.filter((t) => !t.project_id || !byId.has(t.project_id)).map(toTask)
  if (orphans.length) groups.push({ id: '__other__', name: 'Outros', icon: 'dots', tasks: orphans })

  return { groups, total: tasks.length }
}

/** Destinos possíveis para mover uma tarefa (usado no modal de edição). */
export type Destination = { projectId: string; sectionId: string | null; label: string }

export async function fetchDestinations(token: string): Promise<Destination[]> {
  const [projects, sections] = await Promise.all([
    paginate<TodoistProject>('/projects', token),
    paginate<TodoistSection>('/sections', token),
  ])

  const ordered = projects
    .filter(alive)
    .sort(
      (a, b) =>
        Number(b.inbox_project ?? b.is_inbox_project ?? false) -
          Number(a.inbox_project ?? a.is_inbox_project ?? false) ||
        (a.child_order ?? 0) - (b.child_order ?? 0),
    )

  const out: Destination[] = []
  for (const p of ordered) {
    out.push({ projectId: p.id, sectionId: null, label: p.name })
    for (const s of sections
      .filter((s) => alive(s) && s.project_id === p.id)
      .sort((a, b) => (a.section_order ?? 0) - (b.section_order ?? 0))) {
      out.push({ projectId: p.id, sectionId: s.id, label: `${p.name} / ${s.name}` })
    }
  }
  return out
}

export type TaskPatch = {
  content?: string
  description?: string
  priority?: 1 | 2 | 3 | 4
  /** Data em linguagem natural ou ISO; string vazia remove a data. */
  dueString?: string | null
}

/** Edita conteúdo, prioridade e data. POST /api/v1/tasks/{id} */
export async function updateTask(token: string, id: string, patch: TaskPatch): Promise<Task> {
  const body: Record<string, unknown> = {}
  if (patch.content !== undefined) body.content = patch.content
  if (patch.description !== undefined) body.description = patch.description
  if (patch.priority !== undefined) body.priority = patch.priority
  if (patch.dueString !== undefined) {
    // string vazia limpa a data; a API v1 aceita due_string com "no date"
    body.due_string = patch.dueString ? patch.dueString : 'no date'
  }

  const t = await req<TodoistTask>(`/tasks/${requireId(id, 'editar')}`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!t) throw new Error('O Todoist não retornou a tarefa atualizada.')
  return toTask(t)
}

/** Move a tarefa para outro projeto/seção. POST /api/v1/tasks/{id}/move */
export async function moveTask(token: string, id: string, dest: Destination) {
  await req(`/tasks/${requireId(id, 'mover')}/move`, token, {
    method: 'POST',
    body: JSON.stringify(
      dest.sectionId ? { section_id: dest.sectionId } : { project_id: dest.projectId },
    ),
  })
}

/** Exclui a tarefa de vez. DELETE /api/v1/tasks/{id} */
export async function deleteTask(token: string, id: string) {
  await req(`/tasks/${requireId(id, 'excluir')}`, token, { method: 'DELETE' })
}

/**
 * Falha cedo quando o id não é utilizável.
 *
 * Uma tarefa corrompida sem `id` gerava `DELETE /tasks/undefined` e a API
 * devolvia `400 Invalid argument value (task_id)` — erro opaco para o usuário.
 */
function requireId(id: string, op: string): string {
  if (typeof id !== 'string' || !id || id === 'undefined' || id === 'null') {
    throw new Error(`Não é possível ${op}: a tarefa não tem um ID válido do Todoist.`)
  }
  return id
}

export async function closeTask(token: string, id: string) {
  await req(`/tasks/${requireId(id, 'concluir')}/close`, token, { method: 'POST' })
}

export async function reopenTask(token: string, id: string) {
  await req(`/tasks/${requireId(id, 'reabrir')}/reopen`, token, { method: 'POST' })
}

/**
 * Cria tarefa via Quick Add — aceita linguagem natural:
 * "Pagar boleto amanhã 9h #Financeiro @casa p1"
 */
export async function createTask(token: string, text: string): Promise<Task> {
  const t = await req<TodoistTask>('/tasks/quick', token, {
    method: 'POST',
    body: JSON.stringify({ text, auto_reminder: true }),
  })
  if (!t) throw new Error('O Todoist não retornou a tarefa criada.')
  return toTask(t)
}
