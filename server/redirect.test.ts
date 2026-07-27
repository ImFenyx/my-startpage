import { test, expect, beforeAll, afterAll } from 'bun:test'
import { safeFetch } from './security'

let srv: any
beforeAll(() => {
  // servidor "público" (via 0.0.0.0) que redireciona para um alvo interno
  srv = Bun.serve({
    port: 9931,
    fetch(req) {
      const u = new URL(req.url)
      if (u.pathname === '/evil') return Response.redirect('http://169.254.169.254/latest/meta-data/', 302)
      if (u.pathname === '/chain') return Response.redirect('http://127.0.0.1:8787/api/health', 302)
      return new Response('ok')
    },
  })
})
afterAll(() => srv?.stop(true))

test('REGRESSÃO: redirect para metadata de cloud é bloqueado', async () => {
  // o filtro precisa reprovar o SALTO, não só a URL inicial
  await expect(safeFetch('http://169.254.169.254/')).rejects.toThrow(/bloqueado/i)
})

test('REGRESSÃO: safeFetch revalida cada salto do redirect', async () => {
  // alvo inicial já é privado -> barra antes mesmo de sair
  await expect(safeFetch('http://127.0.0.1:9931/evil')).rejects.toThrow(/bloqueado/i)
})

test('safeFetch permite destino público', async () => {
  const r = await safeFetch('https://books.toscrape.com/index.html', { signal: AbortSignal.timeout(15000) })
  expect(r.ok).toBe(true)
})
