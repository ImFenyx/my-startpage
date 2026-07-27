/**
 * Garante que os testes nunca escrevam no banco real.
 *
 * Histórico: testes de carga rodaram contra `data/startpage.sqlite` e
 * deixaram registros sintéticos que causaram três bugs em uso —
 * carimbos em 2027 (sync travado), nota sem `body` (slide quebrado) e
 * a entrada `[60]` em tasks:local (tarefa impossível de apagar).
 *
 *   bun test src/lib/test-isolation.test.ts
 */
import { test, expect } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../..', import.meta.url).pathname

test('DB_PATH aponta para arquivo temporário durante os testes', () => {
  const p = process.env.DB_PATH ?? ''
  expect(p).toBeTruthy()
  expect(p).not.toContain('data/startpage.sqlite')
  expect(p).toMatch(/tmp|temp/i)
})

test('bunfig.toml carrega o preload de isolamento', () => {
  const cfg = readFileSync(join(ROOT, 'bunfig.toml'), 'utf8')
  expect(cfg).toContain('preload')
  expect(cfg).toContain('test-setup.ts')
})

test('test-setup redireciona DB_PATH mesmo se apontar para o banco real', () => {
  const setup = readFileSync(join(ROOT, 'test-setup.ts'), 'utf8')
  expect(setup).toContain('DB_PATH')
  expect(setup).toContain('data/startpage.sqlite')
  expect(setup).toContain('tmpdir')
})

test('o banco real não é tocado por esta execução', () => {
  const real = join(ROOT, 'data/startpage.sqlite')
  if (!existsSync(real)) return // ainda não criado, tudo bem
  expect(process.env.DB_PATH).not.toBe(real)
})

test('.gitignore protege o banco e os temporários', () => {
  const gi = readFileSync(join(ROOT, '.gitignore'), 'utf8')
  expect(gi).toContain('data/')
  expect(gi).toContain('*.sqlite')
})
