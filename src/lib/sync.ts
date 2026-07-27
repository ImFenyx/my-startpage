/**
 * Sincronização com o backend SQLite.
 *
 * Estratégia offline-first: o localStorage continua sendo a fonte de leitura
 * imediata (síncrono, nunca perde a última tecla) e o servidor é a fonte de
 * verdade compartilhada entre máquinas.
 *
 *   boot     → puxa do servidor o que for mais recente e reconcilia
 *   escrita  → grava local na hora, empurra para o servidor com debounce
 *   conflito → last-write-wins por timestamp, decidido no servidor
 *
 * Se o backend estiver fora do ar, tudo continua funcionando só com
 * localStorage — o sync volta sozinho quando o servidor responder.
 */
const API = '/api/sync'
const STAMP_PREFIX = 'startpage:__stamp:'

/**
 * Chaves que o servidor aceita — espelha a allowlist de `server/db.ts`.
 * Filtrar aqui evita gastar requisição com algo que voltaria 400.
 */
const SYNCABLE = new Set([
  'notes:list',
  'notes:active',
  'wishlist:items',
  'wishlist:filter',
  'links:categories',
  'links:active',
  'tasks:local',
  'tasks:view',
  'tasks:collapsed',
  'pomodoro:cfg',
  'pomodoro:phase',
  'pomodoro:cycles',
  'carousel:index',
])

export function isSyncable(key: string) {
  return SYNCABLE.has(key)
}

export type SyncState = 'off' | 'idle' | 'syncing' | 'error'

type Listener = (state: SyncState, detail?: string) => void
const listeners = new Set<Listener>()

let state: SyncState = 'off'
let available = false

export function onSyncState(fn: Listener) {
  listeners.add(fn)
  fn(state)
  return () => listeners.delete(fn)
}

function setState(s: SyncState, detail?: string) {
  state = s
  listeners.forEach((fn) => fn(s, detail))
}

/**
 * Tolerância de relógio adiantado — espelha a regra do servidor.
 * Um carimbo no futuro trava a chave: nada mais consegue superá-la.
 */
const MAX_SKEW = 5 * 60_000

function sane(at: number): number {
  const now = Date.now()
  if (!Number.isFinite(at) || at <= 0) return now
  return at > now + MAX_SKEW ? now + MAX_SKEW : at
}

/** Timestamp local da última alteração de cada chave. */
export function localStamp(key: string): number {
  const raw = Number(localStorage.getItem(STAMP_PREFIX + key) ?? 0)
  const ok = sane(raw)
  if (ok !== raw && raw > 0) localStorage.setItem(STAMP_PREFIX + key, String(ok))
  return ok
}

export function touch(key: string, at = Date.now()) {
  localStorage.setItem(STAMP_PREFIX + key, String(sane(at)))
}

/** O backend está no ar? Consultado uma vez no boot. */
export async function probe(): Promise<boolean> {
  try {
    const r = await fetch('/api/health', { signal: AbortSignal.timeout(2500) })
    available = r.ok
  } catch {
    available = false
  }
  setState(available ? 'idle' : 'off')
  return available
}

export function isAvailable() {
  return available
}

/**
 * Reconcilia servidor ↔ local no boot.
 * Devolve as chaves que o servidor tinha mais atualizadas (para o app recarregar).
 */
let lastEtag = ''

export async function pull(): Promise<string[]> {
  if (!available) return []
  setState('syncing')
  try {
    const r = await fetch(API, {
      headers: lastEtag ? { 'If-None-Match': lastEtag } : {},
      signal: AbortSignal.timeout(8000),
    })
    if (r.status === 304) {
      setState('idle')
      return [] // nada mudou no servidor
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    lastEtag = r.headers.get('etag') ?? ''
    const { entries } = (await r.json()) as {
      entries: { key: string; value: unknown; updatedAt: number }[]
    }

    const updated: string[] = []
    const toPush: { key: string; value: unknown; updatedAt: number }[] = []

    for (const e of entries) {
      if (!isSyncable(e.key)) continue
      const mine = localStamp(e.key)
      const theirs = sane(e.updatedAt)
      if (theirs > mine) {
        localStorage.setItem(`startpage:${e.key}`, JSON.stringify(e.value))
        touch(e.key, theirs)
        updated.push(e.key)
      } else if (mine > theirs) {
        const raw = localStorage.getItem(`startpage:${e.key}`)
        if (raw) toPush.push({ key: e.key, value: JSON.parse(raw), updatedAt: mine })
      }
    }

    if (toPush.length) await pushMany(toPush)
    setState('idle')
    return updated
  } catch (e) {
    setState('error', String((e as Error).message))
    return []
  }
}

async function pushMany(entries: { key: string; value: unknown; updatedAt: number }[]) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
    signal: AbortSignal.timeout(8000),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
}

/* ─── fila de escrita com debounce ─────────────────────────────── */

const pending = new Map<string, unknown>()
let timer: number | undefined

/** Enfileira uma gravação; várias mudanças viram uma única requisição. */
export function push(key: string, value: unknown) {
  touch(key)
  if (!available || !isSyncable(key)) return

  pending.set(key, value)
  window.clearTimeout(timer)
  timer = window.setTimeout(flush, 800)
}

let inFlight = false

export async function flush() {
  if (!available || !pending.size || inFlight) return
  inFlight = true

  const entries = [...pending].map(([key, value]) => ({
    key,
    value,
    updatedAt: localStamp(key) || Date.now(),
  }))
  pending.clear()

  setState('syncing')
  try {
    await pushMany(entries)
    setState('idle')
  } catch (e) {
    /**
     * Devolve para a fila SEM sobrescrever o que chegou durante o envio:
     * se o usuário editou a mesma chave enquanto a requisição estava em voo,
     * o valor novo é mais recente e deve prevalecer.
     */
    for (const e2 of entries) {
      if (!pending.has(e2.key)) pending.set(e2.key, e2.value)
    }
    setState('error', String((e as Error).message))
  } finally {
    inFlight = false
    // ficou algo na fila (novo ou devolvido)? agenda outra tentativa
    if (pending.size) {
      window.clearTimeout(timer)
      timer = window.setTimeout(flush, 2000)
    }
  }
}

// não perde alterações ao fechar a aba
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeunload', () => {
    if (!available || !pending.size) return
    const entries = [...pending].map(([key, value]) => ({
      key,
      value,
      updatedAt: localStamp(key) || Date.now(),
    }))
    navigator.sendBeacon?.(API, new Blob([JSON.stringify({ entries })], { type: 'application/json' }))
  })
}
