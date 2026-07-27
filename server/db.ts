/**
 * Persistência em SQLite (bun:sqlite — nativo, zero dependências).
 *
 * Modelo: key-value versionado por timestamp. O front continua usando as
 * mesmas chaves do localStorage (`notes:list`, `wishlist:items`, …), então a
 * migração é transparente e o localStorage segue como cache/offline.
 *
 * A resolução de conflito é last-write-wins por `updated_at`: uma gravação
 * mais ANTIGA nunca sobrescreve uma mais recente. Isso evita que uma aba
 * parada há horas apague o que você acabou de escrever em outra máquina.
 */
import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const DB_PATH = Bun.env.DB_PATH ?? `${process.cwd()}/data/startpage.sqlite`

mkdirSync(dirname(DB_PATH), { recursive: true })

export const db = new Database(DB_PATH, { create: true })

// WAL: leituras não bloqueiam escritas; muito mais rápido para este padrão.
db.run('PRAGMA journal_mode = WAL')
db.run('PRAGMA synchronous = NORMAL')
db.run('PRAGMA foreign_keys = ON')
db.run('PRAGMA busy_timeout = 5000')
/**
 * Sem isto o arquivo -wal cresce indefinidamente: medido em 4 MB após apenas
 * 200 escritas, enquanto o banco em si tinha 24 KB. O checkpoint automático
 * devolve as páginas ao arquivo principal quando o WAL passa de ~4 MB (1000
 * páginas de 4 KB).
 */
db.run('PRAGMA wal_autocheckpoint = 1000')
db.run('PRAGMA journal_size_limit = 1048576') // devolve o WAL a 1 MB no checkpoint

db.run(`
  CREATE TABLE IF NOT EXISTS kv (
    k          TEXT PRIMARY KEY,
    v          TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT
`)

db.run(`
  CREATE TABLE IF NOT EXISTS revisions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    k          TEXT NOT NULL,
    v          TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT
`)
db.run('CREATE INDEX IF NOT EXISTS idx_rev_key ON revisions (k, id DESC)')

/** Chaves que o servidor aceita — allowlist evita gravação arbitrária. */
export const ALLOWED_KEYS = new Set([
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

/** Tamanho máximo por valor (1 MB) — evita encher o disco por acidente. */
export const MAX_VALUE_BYTES = 1_000_000

const qGet = db.query<{ v: string; updated_at: number }, [string]>(
  'SELECT v, updated_at FROM kv WHERE k = ?',
)
const qAll = db.query<{ k: string; v: string; updated_at: number }, []>(
  'SELECT k, v, updated_at FROM kv',
)
const qSet = db.query<{ k: string }, [string, string, number]>(`
  INSERT INTO kv (k, v, updated_at) VALUES (?1, ?2, ?3)
  ON CONFLICT(k) DO UPDATE SET v = ?2, updated_at = ?3
    WHERE excluded.updated_at >= kv.updated_at
  RETURNING k
`)
const qRev = db.query('INSERT INTO revisions (k, v, updated_at) VALUES (?1, ?2, ?3)')
const qTrimRev = db.query(`
  DELETE FROM revisions WHERE k = ?1 AND id NOT IN (
    SELECT id FROM revisions WHERE k = ?1 ORDER BY id DESC LIMIT 20
  )
`)
const qDel = db.query('DELETE FROM kv WHERE k = ?')
/** Atualiza só o carimbo quando o conteúdo é idêntico (escrita mínima). */
const qTouch = db.query('UPDATE kv SET updated_at = ?1 WHERE k = ?2 AND updated_at < ?1')

export type Entry = { key: string; value: unknown; updatedAt: number }

/**
 * Tolerância de relógio adiantado.
 *
 * Um `updatedAt` no futuro é veneno para o last-write-wins: a entrada trava
 * (nenhuma gravação real consegue superá-la) e ainda sobrescreve o cliente a
 * cada pull. Isso acontece com relógio dessincronizado, fuso mal configurado
 * ou — como ocorreu aqui — dados de teste de carga com timestamp sintético.
 *
 * Carimbos acima de agora + 5 min são fixados no horário do servidor.
 */
const MAX_SKEW = 5 * 60_000

export function sanitizeStamp(updatedAt: number): number {
  const now = Date.now()
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return now
  return updatedAt > now + MAX_SKEW ? now : updatedAt
}

export function get(key: string): Entry | null {
  const row = qGet.get(key)
  if (!row) return null
  return { key, value: safeParse(row.v), updatedAt: row.updated_at }
}

export function getAll(): Entry[] {
  return qAll.all().map((r) => ({ key: r.k, value: safeParse(r.v), updatedAt: r.updated_at }))
}

/** Devolve true se gravou; false se havia versão mais recente no servidor. */
export function set(key: string, value: unknown, updatedAtRaw = Date.now()): boolean {
  const updatedAt = sanitizeStamp(updatedAtRaw)
  const v = JSON.stringify(value)
  if (v.length > MAX_VALUE_BYTES) throw new Error(`Valor de "${key}" excede 1 MB.`)

  // Só registra revisão quando o CONTEÚDO muda. O autosave dispara gravações
  // frequentes com o mesmo texto; sem esta guarda cada uma virava uma linha
  // no histórico, inflando o WAL (medido: 4 MB de WAL para 24 KB de banco).
  const before = qGet.get(key)
  const changed = before?.v !== v

  /**
   * Nada mudou e o carimbo não retrocede: não há o que gravar.
   * Sem esta saída antecipada, cada autosave escrevia uma página no WAL
   * mesmo com texto idêntico — 300 gravações inflavam o -wal em ~1,2 MB.
   */
  if (!changed && before && updatedAt >= before.updated_at) {
    qTouch.run(updatedAt, key)
    maybeCheckpoint()
    return true
  }

  const wrote = qSet.get(key, v, updatedAt) !== null
  if (wrote && changed) {
    // histórico enxuto: últimas 20 versões por chave, útil para desfazer
    qRev.run(key, v, updatedAt)
    qTrimRev.run(key)
    maybeCheckpoint()
  }
  return wrote
}

const setManyTx = db.transaction((entries: Entry[]) => {
  const results: Record<string, boolean> = {}
  for (const e of entries) results[e.key] = set(e.key, e.value, e.updatedAt)
  return results
})

/**
 * Grava várias chaves numa transação só.
 *
 * O checkpoint do WAL é adiado para depois do commit: chamá-lo com a
 * transação aberta dispara `SQLITE_LOCKED: database table is locked`, que era
 * exatamente o erro visto no autosave em lote (`POST /api/sync`).
 */
export function setMany(entries: Entry[]): Record<string, boolean> {
  txDepth++
  try {
    return setManyTx(entries)
  } finally {
    txDepth--
    if (txDepth === 0 && checkpointPending) runCheckpoint()
  }
}

export function del(key: string) {
  qDel.run(key)
}

export function revisions(key: string, limit = 20) {
  return db
    .query<{ id: number; v: string; updated_at: number }, [string, number]>(
      'SELECT id, v, updated_at FROM revisions WHERE k = ? ORDER BY id DESC LIMIT ?',
    )
    .all(key, limit)
    .map((r) => ({ id: r.id, value: safeParse(r.v), updatedAt: r.updated_at }))
}

/** Timestamp da alteração mais recente — base do ETag de /api/sync. */
export function latestStamp(): number {
  const r = db.query<{ m: number | null }, []>('SELECT MAX(updated_at) AS m FROM kv').get()
  return r?.m ?? 0
}

let writesSinceCheckpoint = 0
/**
 * Profundidade de transação. O SQLite recusa `wal_checkpoint` enquanto há uma
 * transação de escrita aberta — o erro é `SQLITE_LOCKED: database table is
 * locked`. Como `setMany()` chama `set()` em laço dentro de uma transação, o
 * checkpoint precisa ser adiado para depois do commit.
 */
let txDepth = 0
let checkpointPending = false

/**
 * Compacta o banco: trunca o WAL e reotimiza índices.
 *
 * O `wal_autocheckpoint` sozinho não basta aqui: a poda do histórico de
 * revisões libera páginas que continuam ocupando o -wal. Medido: 300 escritas
 * geravam 4 MB de WAL para 24 KB de banco; com TRUNCATE cai para 8 KB.
 */
export function maintenance() {
  if (txDepth > 0) {
    checkpointPending = true
    return
  }
  try {
    db.run('PRAGMA wal_checkpoint(TRUNCATE)')
    db.run('PRAGMA optimize')
    writesSinceCheckpoint = 0
    checkpointPending = false
  } catch (e) {
    console.warn('[db] manutenção adiada:', (e as Error).message)
  }
}

/** Checkpoint oportunista, a cada N escritas — barato e mantém o WAL curto. */
function maybeCheckpoint() {
  if (++writesSinceCheckpoint < 20) return

  // Dentro de transação o checkpoint é ilegal: adia para o commit.
  if (txDepth > 0) {
    checkpointPending = true
    return
  }
  runCheckpoint()
}

function runCheckpoint() {
  try {
    db.run('PRAGMA wal_checkpoint(PASSIVE)')
    writesSinceCheckpoint = 0
    checkpointPending = false
  } catch {
    // PASSIVE pode não conseguir o lock se houver leitor ativo; tenta depois.
    checkpointPending = true
  }
}

/**
 * Conserta entradas com carimbo no futuro (relógio errado, dados de teste).
 * Roda no boot: sem isto, uma linha "presa" em 2027 nunca mais aceita
 * gravação e ainda sobrescreve o cliente a cada sincronização.
 */
export function repairFutureStamps(): { key: string; from: number; to: number }[] {
  const limit = Date.now() + MAX_SKEW
  const rows = db
    .query<{ k: string; updated_at: number }, [number]>(
      'SELECT k, updated_at FROM kv WHERE updated_at > ?',
    )
    .all(limit)

  const now = Date.now()
  const fixed = rows.map((r) => ({ key: r.k, from: r.updated_at, to: now }))
  if (fixed.length) {
    const upd = db.query('UPDATE kv SET updated_at = ?1 WHERE k = ?2')
    for (const f of fixed) upd.run(now, f.key)
    db.query('UPDATE revisions SET updated_at = ?1 WHERE updated_at > ?2').run(now, limit)
  }
  return fixed
}

export function stats() {
  const { c } = db.query<{ c: number }, []>('SELECT COUNT(*) AS c FROM kv').get()!
  const { r } = db.query<{ r: number }, []>('SELECT COUNT(*) AS r FROM revisions').get()!
  return { keys: c, revisions: r, path: DB_PATH }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
