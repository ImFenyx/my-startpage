import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../Icon'
import Modal from '../Modal'
import { usePersistentState, uid } from '../../lib/storage'
import * as todoist from '../../lib/todoist'
import { VIEWS, type ViewMode, type TaskGroup, type Destination } from '../../lib/todoist'
import type { Task } from '../../lib/types'
import { safeHref } from '../../lib/safe-url'

const PRIO_COLOR: Record<number, string> = {
  4: 'var(--color-red)',
  3: 'var(--color-peach)',
  2: 'var(--color-blue)',
  1: 'var(--color-overlay0)',
}

const PRIO_LABEL: Record<number, string> = { 4: 'p1', 3: 'p2', 2: 'p3', 1: 'p4' }

const todayISO = () => new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD local

type Editing = {
  task: Task
  content: string
  priority: 1 | 2 | 3 | 4
  due: string
  dest: string // "projectId:sectionId"
}

/**
 * Normaliza uma tarefa local vinda do storage.
 *
 * O dado pode chegar corrompido (backup antigo, gravação parcial do sync ou
 * valor de outro tipo). Sem `source`, o app tratava o item como sendo do
 * Todoist e tentava `DELETE /tasks/undefined`, recebendo
 * `400 Invalid argument value (task_id)` — tarefa fantasma impossível de apagar.
 */
function normalizeLocalTask(t: unknown, i: number): Task {
  const o = (t !== null && typeof t === 'object' ? t : {}) as Partial<Task>
  return {
    id: typeof o.id === 'string' && o.id ? o.id : `local-${i}-${Date.now().toString(36)}`,
    content: typeof o.content === 'string' ? o.content : '',
    done: Boolean(o.done),
    priority: ([1, 2, 3, 4] as const).includes(o.priority as 1) ? (o.priority as 1 | 2 | 3 | 4) : 1,
    due: typeof o.due === 'string' ? o.due : null,
    source: 'local', // esta lista é, por definição, local
    createdAt: typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : Date.now(),
    labels: Array.isArray(o.labels) ? o.labels.filter((l): l is string => typeof l === 'string') : [],
  }
}

/** Descarta entradas irrecuperáveis (número solto, null) e normaliza o resto. */
function normalizeLocalTasks(v: unknown): Task[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((t) => t !== null && typeof t === 'object')
    .map(normalizeLocalTask)
}

export default function TasksSlide() {
  const [rawLocal, setLocal] = usePersistentState<Task[]>('tasks:local', [])
  const local = useMemo(() => normalizeLocalTasks(rawLocal), [rawLocal])
  const [groups, setGroups] = usePersistentState<TaskGroup[]>('tasks:groups', [])
  const [view, setView] = usePersistentState<ViewMode>('tasks:view', 'inbox')
  const [collapsed, setCollapsed] = usePersistentState<string[]>('tasks:collapsed', [])
  const [token, setTokenState] = useState(() => todoist.getToken())
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [err, setErr] = useState('')
  const [cfg, setCfg] = useState(false)
  const [draftToken, setDraftToken] = useState('')
  const [test, setTest] = useState<{ state: 'idle' | 'testing' | 'ok' | 'fail'; msg: string }>({
    state: 'idle',
    msg: '',
  })
  const [input, setInput] = useState('')
  const [lastSync, setLastSync] = usePersistentState<number>('tasks:lastsync', 0)

  const [editing, setEditing] = useState<Editing | null>(null)
  const [saving, setSaving] = useState(false)
  const [dests, setDests] = useState<Destination[]>([])
  const [confirmDel, setConfirmDel] = useState<Task | null>(null)

  // migra visualizações antigas ("today"/"upcoming") que possam estar no storage
  useEffect(() => {
    if (view !== 'inbox' && view !== 'all') setView('inbox')
  }, [view, setView])

  const sync = useCallback(
    async (t = token, mode = view) => {
      if (!t) return
      setStatus('loading')
      setErr('')
      try {
        const { groups: g } = await todoist.fetchTasks(t, mode)
        setGroups(g)
        setLastSync(Date.now())
        setStatus('ok')
      } catch (e: any) {
        setErr(String(e?.message ?? e))
        setStatus('error')
      }
    },
    [token, view, setGroups, setLastSync],
  )

  useEffect(() => {
    if (token) sync(token, view)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, view])

  useEffect(() => {
    if (!token) return
    const id = setInterval(() => sync(), 5 * 60_000)
    return () => clearInterval(id)
  }, [token, sync])

  const allGroups = useMemo<TaskGroup[]>(() => {
    const g = [...groups]
    if (local.length) g.push({ id: '__local__', name: 'Locais', icon: 'save', tasks: local })
    return g
  }, [groups, local])

  const flat = useMemo(() => allGroups.flatMap((g) => g.tasks), [allGroups])
  const doneCount = flat.filter((t) => t.done).length
  const pct = flat.length ? Math.round((doneCount / flat.length) * 100) : 0

  const toggleGroup = (id: string) =>
    setCollapsed((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))

  const patchLocalGroups = (id: string, patch: Partial<Task>) =>
    setGroups((gs) =>
      gs.map((g) => ({ ...g, tasks: g.tasks.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
    )

  const toggle = async (t: Task) => {
    const remoteId = t.source === 'todoist' && typeof t.id === 'string' && t.id ? t.id : null
    if (!remoteId) {
      setLocal((ls) => ls.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))
      return
    }
    patchLocalGroups(t.id, { done: !t.done })
    try {
      if (!t.done) await todoist.closeTask(token, remoteId)
      else await todoist.reopenTask(token, remoteId)
    } catch (e: any) {
      setErr(String(e?.message ?? e))
      patchLocalGroups(t.id, { done: t.done })
    }
  }

  const add = async () => {
    const content = input.trim()
    if (!content) return
    setInput('')
    if (token) {
      try {
        await todoist.createTask(token, content)
        await sync()
        return
      } catch (e: any) {
        setErr(String(e?.message ?? e))
      }
    }
    setLocal((ls) => [
      { id: uid(), content, done: false, priority: 1, source: 'local', createdAt: Date.now() },
      ...ls,
    ])
  }

  /** Abre o editor; para tarefas do Todoist, carrega projetos/seções em paralelo. */
  const openEditor = async (t: Task) => {
    setEditing({
      task: t,
      content: t.content,
      priority: (t.priority ?? 1) as 1 | 2 | 3 | 4,
      due: t.due ?? '',
      dest: `${t.projectId ?? ''}:${t.sectionId ?? ''}`,
    })
    if (t.source === 'todoist' && !dests.length) {
      try {
        setDests(await todoist.fetchDestinations(token))
      } catch {
        /* segue sem a lista de destinos */
      }
    }
  }

  const saveEdit = async () => {
    if (!editing) return
    const { task } = editing
    const content = editing.content.trim()
    if (!content) return

    if (task.source === 'local') {
      setLocal((ls) => ls.map((x) => (x.id === task.id ? { ...x, content, priority: editing.priority } : x)))
      setEditing(null)
      return
    }

    setSaving(true)
    setErr('')
    try {
      await todoist.updateTask(token, task.id, {
        content,
        priority: editing.priority,
        dueString: editing.due !== (task.due ?? '') ? editing.due : undefined,
      })

      const orig = `${task.projectId ?? ''}:${task.sectionId ?? ''}`
      if (editing.dest !== orig) {
        const [projectId, sectionId] = editing.dest.split(':')
        await todoist.moveTask(token, task.id, {
          projectId,
          sectionId: sectionId || null,
          label: '',
        })
      }

      setEditing(null)
      await sync()
    } catch (e: any) {
      setErr(String(e?.message ?? e))
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async (t: Task) => {
    setConfirmDel(null)

    /**
     * Só chamamos a API para tarefas que comprovadamente vieram do Todoist e
     * têm id utilizável. Qualquer outra coisa é removida localmente — antes,
     * um item corrompido virava `DELETE /tasks/undefined` e ficava preso na
     * tela para sempre.
     */
    const remoteId = t.source === 'todoist' && typeof t.id === 'string' && t.id ? t.id : null

    if (!remoteId) {
      setLocal((ls) => ls.filter((x) => x.id !== t.id))
      setGroups((gs) => gs.map((g) => ({ ...g, tasks: g.tasks.filter((x) => x.id !== t.id) })))
      return
    }
    // some da tela na hora; volta se a API recusar
    const snapshot = groups
    setGroups((gs) => gs.map((g) => ({ ...g, tasks: g.tasks.filter((x) => x.id !== t.id) })))
    try {
      await todoist.deleteTask(token, remoteId)
    } catch (e: any) {
      setErr(String(e?.message ?? e))
      setGroups(snapshot)
    }
  }

  const today = todayISO()

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* header */}
      <header className="flex items-center gap-2 px-4 pt-3 pb-2">
        <Icon name="tasks" className="text-mauve" size={16} />
        <h2 className="text-[1rem] font-semibold text-text">Tarefas</h2>

        <span
          className="ml-1 flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.62rem]"
          style={{
            borderColor: token ? 'color-mix(in oklab, var(--color-green) 40%, transparent)' : 'var(--color-surface1)',
            color: token ? 'var(--color-green)' : 'var(--color-subtext0)',
          }}
          title={
            token
              ? `Todoist conectado${lastSync ? ` · sync ${new Date(lastSync).toLocaleTimeString('pt-BR')}` : ''}`
              : 'Modo local'
          }
        >
          <Icon name={token ? 'cloud' : 'save'} size={9} />
          {token ? 'todoist' : 'local'}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <button
            className="btn btn-ghost !px-2 !py-1"
            onClick={() => sync()}
            disabled={!token || status === 'loading'}
            title="Sincronizar agora"
          >
            <Icon name="reset" size={12} className={status === 'loading' ? 'animate-spin' : ''} />
          </button>
          <button
            className="btn btn-ghost !px-2 !py-1"
            onClick={() => {
              setDraftToken(token)
              setTest({ state: 'idle', msg: '' })
              setCfg(true)
            }}
            title="Configurar Todoist"
          >
            <Icon name="gear" size={12} />
          </button>
        </div>
      </header>

      {/* visualizações */}
      <nav className="flex flex-wrap gap-1.5 px-4 pb-2">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className="chip !py-0.5 !text-[0.68rem]"
            data-active={view === v.id}
            onClick={() => setView(v.id)}
            title={v.hint}
          >
            <Icon name={v.icon} size={9} />
            {v.label}
          </button>
        ))}
      </nav>

      {/* progresso */}
      <div className="px-4 pb-2">
        <div className="mb-1 flex items-center justify-between text-[0.68rem] text-subtext0">
          <span>
            {doneCount} de {flat.length} concluídas
          </span>
          <span className="font-mono text-mauve">{pct}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface0">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${pct}%`,
              background: 'linear-gradient(90deg, var(--color-mauve), var(--color-pink))',
            }}
          />
        </div>
      </div>

      {err && (
        <p className="mx-4 mb-2 flex items-start gap-2 rounded-lg border border-red/30 bg-red/10 px-2.5 py-1.5 text-[0.68rem] text-red">
          <Icon name="warning" size={11} className="mt-0.5" />
          <span className="min-w-0 flex-1 break-words">{err}</span>
          <button className="btn btn-ghost !px-1 !py-0" onClick={() => setErr('')} title="Dispensar">
            <Icon name="close" size={9} />
          </button>
        </p>
      )}

      {/* lista agrupada */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
        {allGroups.map((g) => {
          const isCollapsed = collapsed.includes(g.id)
          return (
            <section key={g.id} className="mb-2">
              <button
                className="group mb-1 flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left transition-colors hover:bg-surface0/50"
                onClick={() => toggleGroup(g.id)}
                title={isCollapsed ? 'Expandir seção' : 'Recolher seção'}
              >
                <Icon
                  name={isCollapsed ? 'right' : 'down'}
                  size={9}
                  className="text-overlay0 transition-colors group-hover:text-mauve"
                />
                <span className="text-[0.74rem] font-semibold text-text">{g.name}</span>
                <span className="font-mono text-[0.62rem] text-subtext0">{g.tasks.length}</span>
                <span className="ml-2 h-px flex-1 bg-surface0" />
              </button>

              {!isCollapsed && (
                <ul className="space-y-1.5">
                  {g.tasks.map((t) => {
                    const overdue = t.due && t.due < today
                    return (
                      <li key={`${t.source}-${t.id}`}>
                        <div
                          className="group flex items-center gap-2.5 rounded-xl border border-surface0 bg-surface0/40 px-3 py-2 transition-all hover:border-surface1 hover:bg-surface0"
                          style={{ opacity: t.done ? 0.45 : 1 }}
                        >
                          <button
                            onClick={() => toggle(t)}
                            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border transition-all"
                            style={{
                              borderColor: t.done ? 'var(--color-mauve)' : PRIO_COLOR[t.priority ?? 1],
                              background: t.done ? 'var(--color-mauve)' : 'transparent',
                            }}
                            aria-label={t.done ? 'Desmarcar' : 'Concluir'}
                          >
                            {t.done && <Icon name="check" size={9} style={{ color: 'var(--color-crust)' }} />}
                          </button>

                          <button
                            className="min-w-0 flex-1 text-left"
                            onDoubleClick={() => openEditor(t)}
                            title="Duplo-clique para editar"
                          >
                            <div
                              className="truncate text-sm"
                              style={{ textDecoration: t.done ? 'line-through' : undefined }}
                            >
                              {t.content}
                            </div>
                            {(t.due || (t.labels?.length ?? 0) > 0) && (
                              <div className="mt-0.5 flex items-center gap-2 text-[0.62rem]">
                                {t.due && (
                                  <span
                                    className="flex items-center gap-1 font-mono"
                                    style={{ color: overdue ? 'var(--color-red)' : 'var(--color-subtext0)' }}
                                  >
                                    <Icon name="calendar" size={8} />
                                    {new Date(t.due + 'T00:00:00').toLocaleDateString('pt-BR', {
                                      day: '2-digit',
                                      month: 'short',
                                    })}
                                  </span>
                                )}
                                {t.labels?.slice(0, 2).map((l) => (
                                  <span key={l} className="text-lavender">
                                    @{l}
                                  </span>
                                ))}
                              </div>
                            )}
                          </button>

                          {/* ações */}
                          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                            <button
                              className="btn btn-ghost !px-1.5 !py-0.5 hover:!text-mauve"
                              onClick={() => openEditor(t)}
                              title="Editar"
                              aria-label={`Editar ${t.content}`}
                            >
                              <Icon name="pencil" size={10} />
                            </button>
                            <button
                              className="btn btn-ghost !px-1.5 !py-0.5 hover:!text-red"
                              onClick={() => setConfirmDel(t)}
                              title="Excluir"
                              aria-label={`Excluir ${t.content}`}
                            >
                              <Icon name="trash" size={10} />
                            </button>
                            {t.source === 'todoist' && (
                              <a
                                href={safeHref(t.url)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-ghost !px-1.5 !py-0.5"
                                title="Abrir no Todoist"
                              >
                                <Icon name="external" size={10} />
                              </a>
                            )}
                          </div>
                        </div>
                      </li>
                    )
                  })}

                  {!g.tasks.length && <li className="px-3 py-1 text-[0.68rem] text-subtext0">vazia</li>}
                </ul>
              )}
            </section>
          )
        })}

        {!flat.length && (
          <div className="grid h-full place-items-center text-center">
            <div className="flex flex-col items-center gap-2 text-overlay0">
              <Icon
                name={status === 'loading' ? 'reset' : 'check'}
                size={30}
                className={status === 'loading' ? 'animate-spin text-mauve' : 'text-green'}
              />
              <p className="text-sm">
                {status === 'loading' ? 'Carregando…' : 'Nenhuma tarefa nesta visualização.'}
              </p>
              {!token && (
                <button className="btn btn-ghost text-xs" onClick={() => setCfg(true)}>
                  <Icon name="link" size={11} /> conectar Todoist
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* input */}
      <div className="flex items-center gap-2 border-t border-surface0 px-4 py-2.5">
        <Icon name="plus" className="text-overlay0" size={12} />
        <input
          className="field !border-0 !bg-transparent !px-0 text-sm"
          placeholder={token ? 'Nova tarefa… aceita "amanhã 9h #Casa p1"' : 'Nova tarefa local…'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn btn-accent !py-1 text-xs" onClick={add} disabled={!input.trim()}>
          Add
        </button>
      </div>

      {/* ─── modal: editar ─────────────────────────────────────── */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Editar tarefa"
        icon="pencil"
        width={500}
        footer={
          <>
            <button
              className="btn hover:!text-red"
              onClick={() => {
                const t = editing!.task
                setEditing(null)
                setConfirmDel(t)
              }}
            >
              <Icon name="trash" size={11} /> Excluir
            </button>
            <button className="btn" onClick={() => setEditing(null)}>
              Cancelar
            </button>
            <button
              className="btn btn-accent"
              disabled={!(editing?.content ?? '').trim() || saving}
              onClick={saveEdit}
            >
              <Icon name={saving ? 'reset' : 'check'} size={12} className={saving ? 'animate-spin' : ''} />
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </>
        }
      >
        {editing && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs text-subtext0">
              Tarefa
              <textarea
                data-autofocus
                className="field resize-none text-sm"
                rows={2}
                value={editing.content}
                onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    saveEdit()
                  }
                }}
              />
            </label>

            <div className="flex flex-col gap-1 text-xs text-subtext0">
              Prioridade
              <div className="flex gap-1.5">
                {([4, 3, 2, 1] as const).map((p) => (
                  <button
                    key={p}
                    className="chip !py-0.5 !text-[0.7rem]"
                    data-active={editing.priority === p}
                    onClick={() => setEditing({ ...editing, priority: p })}
                    style={editing.priority === p ? { borderColor: PRIO_COLOR[p], color: PRIO_COLOR[p] } : undefined}
                  >
                    <Icon name="flag" size={9} style={{ color: PRIO_COLOR[p] }} />
                    {PRIO_LABEL[p]}
                  </button>
                ))}
              </div>
            </div>

            {editing.task.source === 'todoist' && (
              <>
                <label className="flex flex-col gap-1 text-xs text-subtext0">
                  Data (linguagem natural ou AAAA-MM-DD; vazio remove)
                  <input
                    className="field font-mono text-sm"
                    placeholder="amanhã 9h · próxima segunda · 2026-08-22"
                    value={editing.due}
                    onChange={(e) => setEditing({ ...editing, due: e.target.value })}
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs text-subtext0">
                  Projeto / seção
                  <select
                    className="field !py-1 text-sm"
                    value={editing.dest}
                    onChange={(e) => setEditing({ ...editing, dest: e.target.value })}
                    disabled={!dests.length}
                  >
                    {!dests.length && <option>carregando…</option>}
                    {dests.map((d) => (
                      <option key={`${d.projectId}:${d.sectionId ?? ''}`} value={`${d.projectId}:${d.sectionId ?? ''}`}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}

            <p className="flex items-start gap-2 rounded-lg bg-crust px-3 py-2 text-[0.68rem] leading-relaxed text-subtext0">
              <Icon name="info" size={11} className="mt-0.5 text-lavender" />
              <b className="text-subtext0">Enter</b> salva · <b className="text-subtext0">Shift+Enter</b> quebra
              linha. Alterações vão direto para o Todoist.
            </p>
          </div>
        )}
      </Modal>

      {/* ─── modal: confirmar exclusão ─────────────────────────── */}
      <Modal
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        title="Excluir tarefa"
        icon="trash"
        width={420}
        footer={
          <>
            <button className="btn" onClick={() => setConfirmDel(null)}>
              Cancelar
            </button>
            <button
              className="btn"
              style={{
                background: 'color-mix(in oklab, var(--color-red) 18%, var(--color-surface0))',
                borderColor: 'var(--color-red)',
                color: 'var(--color-red)',
              }}
              onClick={() => doDelete(confirmDel!)}
            >
              <Icon name="trash" size={11} /> Excluir
            </button>
          </>
        }
      >
        {confirmDel && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-subtext1">Esta ação é permanente:</p>
            <p className="rounded-lg border border-surface0 bg-crust px-3 py-2 text-sm">
              {confirmDel.content}
            </p>
            <p className="text-[0.68rem] text-subtext0">
              {confirmDel.source === 'todoist'
                ? 'A tarefa será apagada da sua conta do Todoist.'
                : 'A tarefa local será removida deste navegador.'}
            </p>
          </div>
        )}
      </Modal>

      {/* ─── modal: configuração ───────────────────────────────── */}
      <Modal
        open={cfg}
        onClose={() => setCfg(false)}
        title="Integração Todoist"
        icon="tasks"
        width={500}
        footer={
          <>
            <button
              className="btn"
              onClick={() => {
                todoist.setToken('')
                setTokenState('')
                setGroups([])
                setTest({ state: 'idle', msg: '' })
                setCfg(false)
              }}
            >
              <Icon name="close" size={11} /> Desconectar
            </button>
            <button
              className="btn"
              disabled={!draftToken.trim() || test.state === 'testing'}
              onClick={async () => {
                setTest({ state: 'testing', msg: '' })
                try {
                  const who = await todoist.verifyToken(draftToken.trim())
                  setTest({ state: 'ok', msg: `Conectado como ${who}` })
                } catch (e: any) {
                  setTest({ state: 'fail', msg: String(e?.message ?? e) })
                }
              }}
            >
              <Icon
                name={test.state === 'testing' ? 'reset' : 'bolt'}
                size={11}
                className={test.state === 'testing' ? 'animate-spin' : ''}
              />
              Testar
            </button>
            <button
              className="btn btn-accent"
              onClick={() => {
                todoist.setToken(draftToken.trim())
                setTokenState(draftToken.trim())
                setDests([])
                setCfg(false)
              }}
            >
              <Icon name="check" size={12} /> Salvar & sincronizar
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-subtext0">
            API token (Unified API v1)
            <input
              data-autofocus
              className="field font-mono text-xs"
              type="password"
              placeholder="0123456789abcdef0123456789abcdef01234567"
              value={draftToken}
              onChange={(e) => {
                setDraftToken(e.target.value)
                setTest({ state: 'idle', msg: '' })
              }}
            />
          </label>

          {test.state !== 'idle' && test.state !== 'testing' && (
            <p
              className="flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-[0.7rem] leading-relaxed"
              style={{
                background:
                  test.state === 'ok'
                    ? 'color-mix(in oklab, var(--color-green) 12%, transparent)'
                    : 'color-mix(in oklab, var(--color-red) 12%, transparent)',
                color: test.state === 'ok' ? 'var(--color-green)' : 'var(--color-red)',
              }}
            >
              <Icon name={test.state === 'ok' ? 'check' : 'warning'} size={11} className="mt-0.5" />
              <span className="min-w-0 break-words">{test.msg}</span>
            </p>
          )}

          <ol className="list-decimal space-y-1 rounded-lg bg-crust px-5 py-3 text-[0.72rem] leading-relaxed text-subtext0">
            <li>
              Abra{' '}
              <a
                className="text-blue underline"
                href="https://app.todoist.com/app/settings/integrations/developer"
                target="_blank"
                rel="noreferrer"
              >
                Todoist → Configurações → Integrações → Desenvolvedor
              </a>
              .
            </li>
            <li>
              Copie o <b className="text-subtext0">API token</b> (40 caracteres hex), cole acima e clique em{' '}
              <b className="text-subtext0">Testar</b>.
            </li>
            <li>
              O campo de nova tarefa aceita linguagem natural do Quick Add:{' '}
              <code className="text-peach">Pagar boleto amanhã 9h #Casa p1</code>.
            </li>
          </ol>

          <div className="rounded-lg bg-crust px-3 py-2 text-[0.7rem] leading-relaxed text-overlay1">
            <b className="text-subtext0">Visualizações</b> (abas no topo do slide):
            <ul className="mt-1 space-y-0.5">
              {VIEWS.map((v) => (
                <li key={v.id} className="flex items-center gap-1.5">
                  <Icon name={v.icon} size={9} className="text-mauve" />
                  <b className="text-subtext0">{v.label}</b>
                  <span className="text-overlay0">— {v.hint}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="flex items-start gap-2 text-[0.68rem] leading-relaxed text-subtext0">
            <Icon name="lock" size={11} className="mt-0.5 text-yellow" />
            O token fica só no <b>localStorage</b> deste navegador — nada é enviado a terceiros. Se um bloqueador
            impedir a chamada direta, ela é repetida pelo proxy local do Elysia.
          </p>
        </div>
      </Modal>
    </div>
  )
}
