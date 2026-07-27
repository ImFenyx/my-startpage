/**
 * Regressão: digitar num campo do modal roubava o foco para o botão "Fechar".
 *
 * Causa: o efeito de autofoco tinha `onClose` (arrow inline, identidade nova a
 * cada render) na lista de dependências. Cada tecla → setState → re-render →
 * novo `onClose` → efeito re-executa → foca o primeiro focável do modal, que é
 * o "X" do cabeçalho.
 *
 *   bun test
 */
import { test, expect, afterEach } from 'bun:test'
import { useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Modal from './Modal'

/** O componente ainda renderiza (sanity check do SSR). */
test('modal renderiza título e conteúdo', () => {
  const html = renderToStaticMarkup(
    <Modal open onClose={() => {}} title="Editar tarefa">
      <input data-autofocus defaultValue="oi" />
    </Modal>,
  )
  expect(html).toContain('Editar tarefa')
  expect(html).toContain('data-autofocus')
})

test('modal fechado não renderiza nada', () => {
  const html = renderToStaticMarkup(
    <Modal open={false} onClose={() => {}} title="X">
      <input />
    </Modal>,
  )
  expect(html).toBe('')
})

/**
 * O ponto central da correção: o efeito de autofoco depende apenas de `open`.
 * Se `onClose` voltar para a lista de dependências, este teste falha.
 */
test('efeito de autofoco não depende de onClose', async () => {
  const src = await Bun.file(new URL('./Modal.tsx', import.meta.url)).text()

  // todos os arrays de dependência de useEffect no arquivo
  const deps = [...src.matchAll(/useEffect\([\s\S]*?\},\s*(\[[^\]]*\])\)/g)].map((m) => m[1])

  expect(deps.length).toBeGreaterThan(0)
  for (const d of deps) {
    expect(d).not.toContain('onClose')
  }
  // e o autofoco deve estar atrelado a `open`
  expect(deps.some((d) => d.includes('open'))).toBe(true)
})

test('onClose é acessado via ref, não capturado no efeito', async () => {
  const src = await Bun.file(new URL('./Modal.tsx', import.meta.url)).text()
  expect(src).toContain('onCloseRef')
  expect(src).toContain('onCloseRef.current = onClose')
})

test('autofoco procura o campo dentro do corpo, não o botão fechar', async () => {
  const src = await Bun.file(new URL('./Modal.tsx', import.meta.url)).text()
  // busca ancorada em bodyRef (corpo), com preferência por [data-autofocus]
  expect(src).toContain('bodyRef')
  expect(src).toContain('[data-autofocus]')
})

afterEach(() => {})
