import { test, expect } from 'bun:test'
import { timeAgo } from './time-ago'

const MIN = 60_000
const H = 3_600_000
const D = 86_400_000

test('menos de um minuto é "agora"', () => {
  expect(timeAgo(1_000, 1_000)).toBe('agora')
  expect(timeAgo(1_000, 1_000 + 59_000)).toBe('agora')
})

test('carimbo no futuro (relógio errado) não gera texto negativo', () => {
  expect(timeAgo(5_000, 1_000)).toBe('agora')
})

test('minutos, horas e dias', () => {
  expect(timeAgo(0, 5 * MIN)).toBe('há 5 min')
  expect(timeAgo(0, 59 * MIN)).toBe('há 59 min')
  expect(timeAgo(0, 3 * H)).toBe('há 3 h')
  expect(timeAgo(0, 23 * H)).toBe('há 23 h')
  expect(timeAgo(0, 2 * D)).toBe('há 2 d')
})

test('a cadência típica do vigia (3,5 dias) aparece em dias', () => {
  expect(timeAgo(0, 84 * H)).toBe('há 3 d')
})

test('semanas, meses e anos com plural correto', () => {
  expect(timeAgo(0, 7 * D)).toBe('há 1 sem')
  expect(timeAgo(0, 30 * D)).toBe('há 4 sem') // 30 dias ainda são semanas
  expect(timeAgo(0, 35 * D)).toBe('há 1 mês')
  expect(timeAgo(0, 90 * D)).toBe('há 3 meses')
  expect(timeAgo(0, 365 * D)).toBe('há 1 ano')
  expect(timeAgo(0, 800 * D)).toBe('há 2 anos')
})
