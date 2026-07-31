/**
 * Tempo relativo curto em pt-BR: "agora", "há 5 min", "há 3 h", "há 2 d"…
 * Usado para mostrar há quanto tempo um preço da wishlist foi confirmado.
 */
export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000))
  if (s < 60) return 'agora'
  const min = Math.floor(s / 60)
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  if (d < 7) return `há ${d} d`
  const w = Math.floor(d / 7)
  if (w < 5) return `há ${w} sem`
  const m = Math.floor(d / 30)
  if (m < 12) return `há ${m} ${m === 1 ? 'mês' : 'meses'}`
  const a = Math.floor(d / 365)
  return `há ${a} ${a === 1 ? 'ano' : 'anos'}`
}
