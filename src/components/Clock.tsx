import { memo, useEffect, useMemo, useState } from 'react'
import Icon from './Icon'

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

function saudacao(h: number) {
  if (h < 5) return { txt: 'boa madrugada', icon: 'star' }
  if (h < 12) return { txt: 'bom dia', icon: 'coffee' }
  if (h < 18) return { txt: 'boa tarde', icon: 'bolt' }
  return { txt: 'boa noite', icon: 'bed' }
}

function Clock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    // sincroniza no segundo cheio para não "pular"
    let id: number
    const tick = () => {
      const d = new Date()
      setNow(d)
      id = window.setTimeout(tick, 1000 - d.getMilliseconds())
    }
    id = window.setTimeout(tick, 1000 - new Date().getMilliseconds())
    return () => window.clearTimeout(id)
  }, [])

  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const greet = useMemo(() => saudacao(now.getHours()), [now.getHours()])

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 text-[0.72rem] font-semibold tracking-[0.18em] text-subtext0 uppercase">
        <Icon name={greet.icon} className="text-mauve" size={12} />
        <span>{greet.txt}</span>
      </div>

      <div
        className="flex items-baseline font-mono font-bold leading-[0.9] tracking-tight text-text tabular-nums"
        style={{ fontSize: 'clamp(3.1rem, 7.2vw, 6.2rem)' }}
        aria-label={`Agora são ${hh}:${mm}`}
      >
        <span>{hh}</span>
        <span className="animate-pulse text-mauve" style={{ animationDuration: '2s' }}>:</span>
        <span>{mm}</span>
        <span
          className="ml-2 font-sans font-semibold text-overlay1 tabular-nums"
          style={{ fontSize: 'clamp(0.9rem, 1.5vw, 1.35rem)' }}
        >
          {ss}
        </span>
      </div>

      <div className="mt-1 flex items-center gap-2 text-[0.82rem] text-subtext0">
        <Icon name="calendar" className="text-lavender" size={12} />
        <span className="capitalize">{DIAS[now.getDay()]}</span>
        <span className="text-surface2">•</span>
        <span>
          {now.getDate()} de {MESES[now.getMonth()]} de {now.getFullYear()}
        </span>
      </div>
    </div>
  )
}

/**
 * memo: este bloco não recebe props e não precisa re-renderizar quando um
 * irmão atualiza (o Clock dispara 1 render/s no App).
 */
export default memo(Clock)
