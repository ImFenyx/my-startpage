/**
 * Testes ponta a ponta contra o servidor Elysia real.
 *
 * Os demais testes exercitam módulos isolados. Aqui subimos o servidor de
 * verdade e batemos via HTTP, cobrindo o que só aparece na integração:
 * roteamento, validação de schema, CORS, cabeçalhos, códigos de status e o
 * ciclo completo de sincronização.
 *
 *   bun test server/e2e.test.ts
 */
import { test, expect, beforeAll, afterAll } from 'bun:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

/**
 * Porta derivada do PID: `bun test` executa os arquivos em paralelo e uma
 * porta fixa colide com outra suíte (ou com o servidor de desenvolvimento),
 * fazendo o beforeAll estourar o timeout.
 */
const PORT = 9000 + (process.pid % 900)
const BASE = `http://localhost:${PORT}`

let proc: ReturnType<typeof Bun.spawn>
const DB = `${tmpdir()}/e2e-${process.pid}-${Date.now()}.sqlite`

beforeAll(async () => {
  /**
   * Falha cedo e com mensagem útil se as dependências do servidor estiverem
   * incompletas — sem isto o sintoma é um timeout opaco de 10 s no hook.
   */
  const elysia = new URL('../node_modules/elysia/dist/index.mjs', import.meta.url).pathname
  if (!(await Bun.file(elysia).exists())) {
    throw new Error(
      'Dependências incompletas: node_modules/elysia/dist não existe.\n' +
        'Rode: rm -rf node_modules ~/.bun/install/cache bun.lock && bun install',
    )
  }

  proc = Bun.spawn(['bun', 'run', 'server/index.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  // espera o servidor responder (instalação limpa pode compilar na 1ª vez)
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(400) })
      if (r.ok) return
    } catch {
      /* ainda subindo */
    }
    await Bun.sleep(100)
  }
  const erro = await new Response(proc.stderr).text().catch(() => '')
  throw new Error(`servidor não subiu na porta ${PORT}. stderr: ${erro.slice(0, 300)}`)
}, 30_000) // timeout explícito do hook

afterAll(async () => {
  proc?.kill()
  await Bun.sleep(80) // deixa o SQLite fechar antes de remover
  for (const sufixo of ['', '-wal', '-shm']) rmSync(DB + sufixo, { force: true })
})

const j = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) })

/* ─── saúde ────────────────────────────────────────────────────── */

test('health responde com runtime e estatísticas', async () => {
  const { status, body } = await j(await fetch(`${BASE}/api/health`))
  expect(status).toBe(200)
  expect(body.ok).toBe(true)
  expect(body.runtime).toContain('bun')
  expect(body.db).toHaveProperty('keys')
})

test('rota inexistente devolve 404 sem stack trace', async () => {
  const { status, body } = await j(await fetch(`${BASE}/api/nao-existe`))
  expect(status).toBe(404)
  expect(JSON.stringify(body)).not.toContain('at ')
})

/* ─── cabeçalhos de segurança ──────────────────────────────────── */

test('respostas trazem cabeçalhos de segurança', async () => {
  const r = await fetch(`${BASE}/api/health`)
  expect(r.headers.get('x-content-type-options')).toBe('nosniff')
  expect(r.headers.get('x-frame-options')).toBe('DENY')
  expect(r.headers.get('referrer-policy')).toBe('no-referrer')
})

test('CORS aceita o front local e recusa origem estranha', async () => {
  const ok = await fetch(`${BASE}/api/health`, { headers: { Origin: 'http://localhost:5173' } })
  expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')

  const mau = await fetch(`${BASE}/api/health`, { headers: { Origin: 'https://evil.com' } })
  expect(mau.headers.get('access-control-allow-origin')).toBeNull()
})

/* ─── SSRF ─────────────────────────────────────────────────────── */

test('scrape recusa endereços internos', async () => {
  for (const alvo of ['http://127.0.0.1:8787/api/health', 'http://169.254.169.254/', 'http://192.168.1.1/']) {
    const { status, body } = await j(await fetch(`${BASE}/api/scrape?url=${encodeURIComponent(alvo)}`))
    expect(status).toBe(400)
    expect(body.error).toMatch(/privada|local/i)
  }
})

test('scrape recusa esquema não-HTTP', async () => {
  const { status } = await j(await fetch(`${BASE}/api/scrape?url=file:///etc/passwd`))
  expect(status).toBe(400)
})

test('scrape sem parâmetro devolve 400 de validação', async () => {
  const { status } = await j(await fetch(`${BASE}/api/scrape`))
  expect(status).toBe(400)
})

/* ─── ciclo completo de sync ───────────────────────────────────── */

test('PUT → GET devolve o mesmo valor', async () => {
  const valor = [{ id: 'n1', title: 'Nota', body: '# oi' }]
  const put = await j(
    await fetch(`${BASE}/api/sync/notes:list`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: valor, updatedAt: Date.now() }),
    }),
  )
  expect(put.status).toBe(200)
  expect(put.body.wrote).toBe(true)

  const get = await j(await fetch(`${BASE}/api/sync/notes:list`))
  expect(get.body.value).toEqual(valor)
})

test('gravação mais antiga não sobrescreve a recente', async () => {
  const agora = Date.now()
  await fetch(`${BASE}/api/sync/wishlist:filter`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 'novo', updatedAt: agora }),
  })
  const velho = await j(
    await fetch(`${BASE}/api/sync/wishlist:filter`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'velho', updatedAt: agora - 60_000 }),
    }),
  )
  expect(velho.body.wrote).toBe(false)
  expect(velho.body.current.value).toBe('novo')
})

test('REGRESSÃO: carimbo no futuro é normalizado', async () => {
  const futuro = Date.now() + 200 * 86_400_000
  const { body } = await j(
    await fetch(`${BASE}/api/sync/carousel:index`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 2, updatedAt: futuro }),
    }),
  )
  expect(body.current.updatedAt).toBeLessThan(futuro)
})

test('REGRESSÃO: lote com chave desconhecida grava as válidas', async () => {
  const { status, body } = await j(
    await fetch(`${BASE}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entries: [
          { key: 'links:active', value: 'work' },
          { key: 'tasks:groups', value: ['cache'] },
        ],
      }),
    }),
  )
  expect(status).toBe(200)
  expect(body.results['links:active']).toBe(true)
  expect(body.ignored).toContain('tasks:groups')
})

test('REGRESSÃO: 50 lotes seguidos sem SQLITE_LOCKED', async () => {
  for (let i = 0; i < 50; i++) {
    const r = await fetch(`${BASE}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entries: [
          { key: 'notes:list', value: [{ id: String(i) }] },
          { key: 'wishlist:items', value: [i] },
          { key: 'pomodoro:cycles', value: i },
        ],
      }),
    })
    expect(r.status).toBe(200)
  }
})

test('token do Todoist não pode ser gravado pelo sync', async () => {
  const { status, body } = await j(
    await fetch(`${BASE}/api/sync/todoist_token`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'roubado' }),
    }),
  )
  expect(status).toBe(400)
  expect(body.error).toMatch(/não é permitida/i)
})

test('valor acima de 1 MB é rejeitado', async () => {
  const r = await fetch(`${BASE}/api/sync/notes:list`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 'x'.repeat(1_100_000) }),
  })
  expect(r.status).toBeGreaterThanOrEqual(400)
})

test('ETag evita transferir o payload quando nada mudou', async () => {
  const r1 = await fetch(`${BASE}/api/sync`)
  const etag = r1.headers.get('etag')
  expect(etag).toBeTruthy()

  const r2 = await fetch(`${BASE}/api/sync`, { headers: { 'If-None-Match': etag! } })
  expect(r2.status).toBe(304)
})

test('DELETE remove a chave', async () => {
  await fetch(`${BASE}/api/sync/notes:active`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 'temp' }),
  })
  const del = await j(await fetch(`${BASE}/api/sync/notes:active`, { method: 'DELETE' }))
  expect(del.body.deleted).toBe(true)

  const get = await fetch(`${BASE}/api/sync/notes:active`)
  expect(get.status).toBe(404)
})

test('diagnóstico lista as chaves e sinaliza datas futuras', async () => {
  const { status, body } = await j(await fetch(`${BASE}/api/sync/_debug`))
  expect(status).toBe(200)
  expect(Array.isArray(body.entries)).toBe(true)
  expect(body.entries.every((e: any) => e.inFuture === false)).toBe(true)
})

/* ─── proxy do Todoist ─────────────────────────────────────────── */

test('proxy exige Authorization', async () => {
  const { status } = await j(await fetch(`${BASE}/api/todoist/user`))
  expect(status).toBe(401)
})

test('proxy recusa caminho com traversal', async () => {
  const { status } = await j(
    await fetch(`${BASE}/api/todoist/../oauth`, { headers: { Authorization: 'Bearer x' } }),
  )
  expect(status).toBeGreaterThanOrEqual(400)
})

/* ─── concorrência (várias abas abertas) ───────────────────────── */

test('gravações simultâneas na mesma chave: vence o maior timestamp', async () => {
  const base = Date.now()
  const rs = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      fetch(`${BASE}/api/sync/notes:list`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: [`aba-${i}`], updatedAt: base + i }),
      }),
    ),
  )
  expect(rs.every((r) => r.ok)).toBe(true)

  const { body } = await j(await fetch(`${BASE}/api/sync/notes:list`))
  expect(body.value).toEqual(['aba-4']) // o mais recente vence
})

test('REGRESSÃO: 100 lotes concorrentes sem erro nem SQLITE_LOCKED', async () => {
  const rs = await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      fetch(`${BASE}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: [
            { key: 'wishlist:items', value: [i] },
            { key: 'tasks:local', value: [i] },
          ],
        }),
      }),
    ),
  )
  expect(rs.filter((r) => !r.ok).length).toBe(0)

  const { body } = await j(await fetch(`${BASE}/api/sync/_debug`))
  expect(body.entries.every((e: any) => !e.inFuture)).toBe(true)
})
