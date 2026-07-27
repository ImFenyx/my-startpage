import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import Modal from './Modal'
import { usePersistentState } from '../lib/storage'
import { DEFAULT_POMODORO } from '../lib/defaults'
import type { Phase, PomodoroSettings } from '../lib/types'

const PHASE_META: Record<Phase, { label: string; icon: string; color: string }> = {
  focus: { label: 'Foco', icon: 'brain', color: 'var(--color-mauve)' },
  short: { label: 'Pausa curta', icon: 'coffee', color: 'var(--color-green)' },
  long: { label: 'Pausa longa', icon: 'bed', color: 'var(--color-sky)' },
}

/** bip curto via WebAudio (sem arquivo externo) */
function beep(times = 2) {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    const ctx = new Ctx()
    let t = ctx.currentTime
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.setValueAtTime(i % 2 ? 660 : 880, t)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26)
      o.connect(g).connect(ctx.destination)
      o.start(t)
      o.stop(t + 0.28)
      t += 0.32
    }
    setTimeout(() => ctx.close(), 1600)
  } catch {
    /* noop */
  }
}

export default function Pomodoro() {
  const [cfg, setCfg] = usePersistentState<PomodoroSettings>('pomodoro:cfg', DEFAULT_POMODORO)
  const [phase, setPhase] = usePersistentState<Phase>('pomodoro:phase', 'focus')
  const [cycles, setCycles] = usePersistentState<number>('pomodoro:cycles', 0)
  const [left, setLeft] = useState(() => cfg.focus * 60)
  const [running, setRunning] = useState(false)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(cfg)

  const total = (phase === 'focus' ? cfg.focus : phase === 'short' ? cfg.short : cfg.long) * 60
  const deadline = useRef<number | null>(null)

  // ao trocar de fase ou configuração, recalcula o restante (se parado)
  useEffect(() => {
    if (!running) setLeft(total)
  }, [total, phase]) // eslint-disable-line react-hooks/exhaustive-deps

  const nextPhase = useCallback(() => {
    if (phase === 'focus') {
      const c = cycles + 1
      setCycles(c)
      const p: Phase = c % cfg.longEvery === 0 ? 'long' : 'short'
      setPhase(p)
      return p
    }
    setPhase('focus')
    return 'focus' as Phase
  }, [phase, cycles, cfg.longEvery, setCycles, setPhase])

  const finish = useCallback(() => {
    if (cfg.sound) beep(phase === 'focus' ? 3 : 2)
    if (cfg.notify && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(phase === 'focus' ? '🧠 Foco concluído!' : '☕ Pausa acabou', {
        body: phase === 'focus' ? 'Hora de respirar um pouco.' : 'Bora voltar pro foco.',
      })
    }
    const p = nextPhase()
    const nt = (p === 'focus' ? cfg.focus : p === 'short' ? cfg.short : cfg.long) * 60
    setLeft(nt)
    if (cfg.autoStart) {
      deadline.current = Date.now() + nt * 1000
      setRunning(true)
    } else {
      deadline.current = null
      setRunning(false)
    }
  }, [cfg, phase, nextPhase])

  // timer baseado em timestamp (imune a throttling de aba em background)
  useEffect(() => {
    if (!running) return
    if (deadline.current == null) deadline.current = Date.now() + left * 1000
    const id = window.setInterval(() => {
      const rem = Math.round(((deadline.current ?? 0) - Date.now()) / 1000)
      if (rem <= 0) {
        window.clearInterval(id)
        finish()
      } else {
        // só re-renderiza quando o segundo exibido realmente muda:
        // o intervalo roda a 250 ms para não "pular", mas 3 de cada 4
        // disparos são descartados aqui.
        setLeft((prev) => (prev === rem ? prev : rem))
      }
    }, 250)
    return () => window.clearInterval(id)
  }, [running, finish]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = () => {
    if (running) {
      setRunning(false)
      deadline.current = null
    } else {
      deadline.current = Date.now() + left * 1000
      setRunning(true)
    }
  }

  const reset = () => {
    setRunning(false)
    deadline.current = null
    setLeft(total)
  }

  const skip = () => {
    setRunning(false)
    deadline.current = null
    const p = nextPhase()
    setLeft((p === 'focus' ? cfg.focus : p === 'short' ? cfg.short : cfg.long) * 60)
  }

  /**
   * Atalhos globais: espaço = play/pause, R = reset, S = skip.
   *
   * O handler vai numa ref para que o listener seja registrado UMA vez.
   * Antes, o efeito não tinha array de dependências e re-executava a cada
   * render — com o timer ativo isso significava remover e re-adicionar o
   * listener ~4x por segundo.
   */
  const handlersRef = useRef({ toggle, reset, skip })
  handlersRef.current = { toggle, reset, skip }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el?.matches('input, textarea, select, [contenteditable="true"]')) return
      if (document.querySelector('[role="dialog"]')) return
      if (e.code === 'Space') {
        e.preventDefault()
        handlersRef.current.toggle()
      } else if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) handlersRef.current.reset()
      else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) handlersRef.current.skip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // título da aba mostra o cronômetro
  useEffect(() => {
    document.title = running
      ? `${fmt(left)} · ${PHASE_META[phase].label}`
      : 'Startpage'
    return () => {
      document.title = 'Startpage'
    }
  }, [left, running, phase])

  const meta = PHASE_META[phase]
  const pct = total ? (1 - left / total) * 100 : 0

  return (
    <>
      <div
        className="card relative overflow-hidden px-3 py-2.5"
        style={{ borderColor: running ? `color-mix(in oklab, ${meta.color} 45%, transparent)` : undefined }}
      >
        {/* barra de progresso de fundo */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 transition-[width] duration-500 ease-linear"
          style={{ width: `${pct}%`, background: `color-mix(in oklab, ${meta.color} 11%, transparent)` }}
          aria-hidden
        />

        {/*
          Região viva: leitores de tela anunciam a troca de fase. Antes, ir de
          "foco" para "pausa" era completamente silencioso.
        */}
        <span className="sr-only" role="status" aria-live="polite">
          {meta.label}
          {running ? ' em andamento' : ' pausado'}, {fmt(left)} restantes
        </span>

        <div className="relative flex items-center gap-3">
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-1.5 text-[0.66rem] font-semibold tracking-[0.14em] uppercase" style={{ color: meta.color }}>
              <Icon name={meta.icon} size={11} />
              <span>{meta.label}</span>
              <span className="text-overlay0 normal-case tracking-normal">
                · ciclo {(cycles % cfg.longEvery) + (phase === 'focus' ? 1 : 0) || cfg.longEvery}/{cfg.longEvery}
              </span>
            </div>
            <div
              className="font-mono text-[2rem] font-bold leading-none tabular-nums"
              style={{ color: running ? meta.color : 'var(--color-text)' }}
            >
              {fmt(left)}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              className="btn btn-accent !h-9 !w-11"
              onClick={toggle}
              title={running ? 'Pausar (Espaço)' : 'Iniciar (Espaço)'}
              aria-label={running ? 'Pausar' : 'Iniciar'}
            >
              <Icon name={running ? 'pause' : 'play'} size={14} />
            </button>
            <button className="btn !h-9 !w-9" onClick={reset} title="Reiniciar (R)" aria-label="Reiniciar">
              <Icon name="reset" size={14} />
            </button>
            <button className="btn !h-9 !w-9" onClick={skip} title="Pular fase (S)" aria-label="Pular">
              <Icon name="skip" size={13} />
            </button>
            <button
              className="btn !h-9 !w-9"
              onClick={() => {
                setDraft(cfg)
                setOpen(true)
              }}
              title="Configurações do Pomodoro"
              aria-label="Configurações"
            >
              <Icon name="gear" size={14} />
            </button>
          </div>
        </div>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Configurações do Pomodoro"
        icon="timer"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setDraft(DEFAULT_POMODORO)}>
              <Icon name="reset" size={12} /> Padrão
            </button>
            <button className="btn" onClick={() => setOpen(false)}>
              Cancelar
            </button>
            <button
              className="btn btn-accent"
              onClick={() => {
                setCfg(draft)
                setRunning(false)
                deadline.current = null
                const t = (phase === 'focus' ? draft.focus : phase === 'short' ? draft.short : draft.long) * 60
                setLeft(t)
                if (draft.notify && 'Notification' in window && Notification.permission === 'default') {
                  Notification.requestPermission()
                }
                setOpen(false)
              }}
            >
              <Icon name="check" size={12} /> Salvar
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {(
            [
              ['focus', 'Foco', 'brain', 1, 90],
              ['short', 'Pausa curta', 'coffee', 1, 30],
              ['long', 'Pausa longa', 'bed', 1, 60],
              ['longEvery', 'Pausa longa a cada X focos', 'layers', 2, 8],
            ] as const
          ).map(([key, label, icon, min, max]) => (
            <label key={key} className="flex flex-col gap-1.5">
              <span className="flex items-center gap-2 text-xs text-subtext0">
                <Icon name={icon} className="text-mauve" size={12} />
                {label}
                <b className="ml-auto font-mono text-sm text-text">
                  {draft[key]}
                  {key === 'longEvery' ? '' : ' min'}
                </b>
              </span>
              <input
                type="range"
                min={min}
                max={max}
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
                className="w-full"
              />
            </label>
          ))}

          <div className="flex flex-col gap-2 border-t border-surface0 pt-3">
            {(
              [
                ['autoStart', 'Iniciar próxima fase automaticamente', 'rocket'],
                ['sound', 'Alerta sonoro ao terminar', 'bolt'],
                ['notify', 'Notificação do navegador', 'info'],
              ] as const
            ).map(([key, label, icon]) => (
              <label key={key} className="flex cursor-pointer items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={draft[key]}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })}
                  className="h-4 w-4 accent-mauve"
                />
                <Icon name={icon} className="text-overlay1" size={12} />
                <span className="text-subtext1">{label}</span>
              </label>
            ))}
          </div>

          <p className="rounded-lg bg-crust px-3 py-2 text-[0.72rem] leading-relaxed text-subtext0">
            <Icon name="info" className="mr-1 text-lavender" size={11} />
            Atalhos: <b className="font-mono text-subtext0">Espaço</b> play/pause ·{' '}
            <b className="font-mono text-subtext0">R</b> reiniciar ·{' '}
            <b className="font-mono text-subtext0">S</b> pular.
          </p>
        </div>
      </Modal>
    </>
  )
}

function fmt(s: number) {
  const m = Math.floor(Math.max(0, s) / 60)
  const ss = Math.max(0, s) % 60
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}
