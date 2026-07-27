import { useCallback, useEffect, useRef, useState } from 'react'
import * as sync from './sync'

const PREFIX = 'startpage:'

/**
 * Chaves que NÃO saem desta máquina.
 *
 *  - `todoist_token`  — segredo, nunca deve trafegar.
 *  - `tasks:groups`   — cache das tarefas do Todoist; é rederivado a cada
 *                       sync (5 min) e pode ficar grande. Sincronizar cache
 *                       de dado remoto só gasta banda e gera conflito.
 *  - `tasks:lastsync` — carimbo de "última sincronização", por natureza local
 *                       a cada máquina.
 *
 * Enviá-las ao servidor rendia `400 Chave não permitida` a cada autosave.
 */
const LOCAL_ONLY = new Set(['todoist_token', 'tasks:groups', 'tasks:lastsync'])

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw == null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function save<T>(key: string, value: T) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
    // espelha no servidor (nunca segredos)
    if (!LOCAL_ONLY.has(key)) sync.push(key, value)
  } catch (e) {
    console.warn('[storage] falha ao salvar', key, e)
  }
}

/** useState persistido em localStorage, com sync entre abas. */
export function usePersistentState<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() => load(key, initial))
  const initialRef = useRef(initial)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    save(key, state)
  }, [key, state])

  useEffect(() => {
    // sincronia entre abas
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREFIX + key && e.newValue) {
        try {
          setState(JSON.parse(e.newValue))
        } catch {
          /* ignore */
        }
      }
    }
    // recarrega quando o pull inicial trouxer versão mais nova do servidor
    const onPulled = (e: Event) => {
      const keys = (e as CustomEvent<string[]>).detail
      if (keys.includes(key)) setState(load(key, initialRef.current))
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('startpage:pulled', onPulled)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('startpage:pulled', onPulled)
    }
  }, [key])

  return [state, setState] as const
}

/** Debounce genérico para autosave (evita gravar a cada tecla). */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delay = 500,
) {
  const timer = useRef<number | undefined>(undefined)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const run = useCallback(
    (...args: A) => {
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => fnRef.current(...args), delay)
    },
    [delay],
  )

  useEffect(() => () => window.clearTimeout(timer.current), [])
  return run
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

/** Exporta todos os dados do startpage como objeto (backup). */
/**
 * Exporta os dados para backup.
 *
 * O token do Todoist e os carimbos internos de sync FICAM DE FORA: o arquivo
 * é feito para ser copiado entre máquinas ou enviado para alguém, e antes ele
 * carregava a credencial da conta em texto plano.
 */
export function exportAll(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k?.startsWith(PREFIX)) continue

    const bare = k.slice(PREFIX.length)
    if (LOCAL_ONLY.has(bare)) continue // nunca exporta segredos
    if (bare.startsWith('__stamp:')) continue // metadado interno de sync

    try {
      out[bare] = JSON.parse(localStorage.getItem(k)!)
    } catch {
      /* ignore */
    }
  }
  return out
}

/** Chaves aceitas num backup — espelha a allowlist do servidor. */
const IMPORTABLE = new Set([
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

/** Chaves que jamais podem vir de um arquivo (prototype pollution). */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])

export type ImportResult = { imported: string[]; skipped: string[] }

/**
 * Importa um backup JSON.
 *
 * Antes isto era `Object.entries(data).forEach(([k,v]) => save(k,v))`, ou seja,
 * um arquivo qualquer podia gravar QUALQUER chave — inclusive
 * `todoist_token`, sequestrando a credencial da conta. Agora só passam chaves
 * conhecidas, e o token nunca é importável.
 */
export function importAll(data: unknown): ImportResult {
  const imported: string[] = []
  const skipped: string[] = []

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Backup inválido: esperado um objeto JSON.')
  }

  for (const [k, v] of Object.entries(data)) {
    if (FORBIDDEN.has(k) || !IMPORTABLE.has(k)) {
      skipped.push(k)
      continue
    }
    try {
      const size = JSON.stringify(v)?.length ?? 0
      if (size > 1_000_000) {
        skipped.push(`${k} (>1 MB)`)
        continue
      }
      save(k, v)
      imported.push(k)
    } catch {
      skipped.push(k)
    }
  }
  return { imported, skipped }
}
