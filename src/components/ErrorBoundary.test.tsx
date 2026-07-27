/**
 * Error boundary — isolamento de falhas.
 *
 * Antes: zero boundaries. Uma exceção no slide de Notas desmontava a árvore
 * inteira e sobrava tela branca, relógio e Pomodoro inclusive.
 *
 * Nota: `renderToStaticMarkup` NÃO executa error boundaries (o SSR propaga a
 * exceção), então testamos o contrato da classe diretamente — que é onde mora
 * a lógica: getDerivedStateFromError + render do fallback.
 */
import { test, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import ErrorBoundary from './ErrorBoundary'

test('conteúdo saudável passa intacto', () => {
  const html = renderToStaticMarkup(
    <ErrorBoundary name="Teste">
      <p>tudo certo</p>
    </ErrorBoundary>,
  )
  expect(html).toContain('tudo certo')
})

test('getDerivedStateFromError captura o erro em vez de propagar', () => {
  const err = new Error('estourou')
  const next = (ErrorBoundary as any).getDerivedStateFromError(err)
  expect(next).toEqual({ error: err })
})

test('REGRESSÃO: com erro no estado, renderiza fallback e não relança', () => {
  const inst = new (ErrorBoundary as any)({ name: 'Bloco Quebrado', children: null })
  inst.state = { error: new Error('estourou de propósito') }

  const html = renderToStaticMarkup(inst.render())
  expect(html).toContain('Bloco Quebrado')
  expect(html).toContain('estourou de propósito')
})

test('fallback é acessível e oferece recuperação', () => {
  const inst = new (ErrorBoundary as any)({ name: 'X', children: null })
  inst.state = { error: new Error('boom') }

  const html = renderToStaticMarkup(inst.render())
  expect(html).toContain('role="alert"') // leitor de tela anuncia
  expect(html).toContain('Tentar de novo') // reset sem perder dados
  expect(html).toContain('Limpar dados do bloco') // último recurso
})

test('cada bloco tem nome próprio no aviso', () => {
  for (const nome of ['Pomodoro', 'Links Rápidos', 'Bloco de Notas']) {
    const inst = new (ErrorBoundary as any)({ name: nome, children: null })
    inst.state = { error: new Error('x') }
    expect(renderToStaticMarkup(inst.render())).toContain(nome)
  }
})
