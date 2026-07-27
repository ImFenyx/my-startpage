import { memo, lazy, Suspense, useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import ErrorBoundary from './ErrorBoundary'
import TasksSlide from './slides/TasksSlide'
import { usePersistentState } from '../lib/storage'

// Wishlist e Notas saem do bundle inicial: Notas carrega marked + DOMPurify
// (~60 KB) e só é necessária quando o slide é aberto de fato.
const WishlistSlide = lazy(() => import('./slides/WishlistSlide'))
const NotesSlide = lazy(() => import('./slides/NotesSlide'))

const Loading = () => (
  <div className="grid h-full place-items-center text-overlay0">
    <Icon name="reset" size={22} className="animate-spin text-mauve" />
  </div>
)

const SLIDES = [
  { id: 'tasks', label: 'Tarefas de Hoje', icon: 'tasks', Comp: TasksSlide },
  { id: 'wishlist', label: 'Wishlist & Metas', icon: 'heart', Comp: WishlistSlide },
  { id: 'notes', label: 'Bloco de Notas', icon: 'note', Comp: NotesSlide },
] as const

function RightCarousel() {
  const [idx, setIdx] = usePersistentState<number>('carousel:index', 0)
  const [dir, setDir] = useState(1)

  const go = (d: number) => {
    setDir(d)
    setIdx((i) => (i + d + SLIDES.length) % SLIDES.length)
  }

  // atalhos: 1/2/3 troca de slide, setas ←/→ navegam.
  // Handler em ref → listener registrado uma única vez (antes o efeito não
  // tinha deps e remontava o listener a cada render).
  const navRef = useRef({ go, setDir, setIdx, idx })
  navRef.current = { go, setDir, setIdx, idx }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el?.matches('input, textarea, select, [contenteditable="true"]')) return
      if (document.querySelector('[role="dialog"]')) return
      const nav = navRef.current
      if (e.key === 'ArrowRight') nav.go(1)
      else if (e.key === 'ArrowLeft') nav.go(-1)
      else if (['1', '2', '3'].includes(e.key)) {
        const n = Number(e.key) - 1
        nav.setDir(n > nav.idx ? 1 : -1)
        nav.setIdx(n)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const Current = SLIDES[idx].Comp

  return (
    <section className="card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* header do carrossel */}
      <header className="flex items-center gap-2 border-b border-surface0 px-2.5 py-2">
        <button className="btn btn-ghost !px-2 !py-1" onClick={() => go(-1)} aria-label="Slide anterior" title="Anterior (←)">
          <Icon name="left" size={13} />
        </button>

        <nav className="flex flex-1 justify-center gap-1.5">
          {SLIDES.map((s, i) => (
            <button
              key={s.id}
              className="chip !py-1"
              data-active={i === idx}
              onClick={() => {
                setDir(i > idx ? 1 : -1)
                setIdx(i)
              }}
              title={`${s.label} (tecla ${i + 1})`}
            >
              <Icon name={s.icon} size={11} />
              <span className="hidden sm:inline">{s.label}</span>
            </button>
          ))}
        </nav>

        <button className="btn btn-ghost !px-2 !py-1" onClick={() => go(1)} aria-label="Próximo slide" title="Próximo (→)">
          <Icon name="right" size={13} />
        </button>
      </header>

      {/* slide */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          key={idx}
          className="absolute inset-0"
          style={{ animation: `slideIn${dir > 0 ? 'R' : 'L'} .24s ease-out both` }}
        >
          {/* key = idx: trocar de slide limpa um erro anterior */}
          <ErrorBoundary key={SLIDES[idx].id} name={SLIDES[idx].label}>
            <Suspense fallback={<Loading />}>
              <Current />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>

      <style>{`
        @keyframes slideInR { from { opacity:0; transform: translateX(18px) } to { opacity:1; transform:none } }
        @keyframes slideInL { from { opacity:0; transform: translateX(-18px) } to { opacity:1; transform:none } }
      `}</style>
    </section>
  )
}

/**
 * memo: este bloco não recebe props e não precisa re-renderizar quando um
 * irmão atualiza (o Clock dispara 1 render/s no App).
 */
export default memo(RightCarousel)
