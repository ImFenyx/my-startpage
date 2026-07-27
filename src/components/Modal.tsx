import { useEffect, useRef } from 'react'
import Icon from './Icon'

type Props = {
  open: boolean
  onClose: () => void
  title: string
  icon?: string
  children: React.ReactNode
  footer?: React.ReactNode
  width?: number
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function Modal({ open, onClose, title, icon = 'gear', children, footer, width = 460 }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  /**
   * `onClose` costuma ser uma arrow function inline, ou seja, uma identidade
   * nova a cada render. Guardamos numa ref para que os efeitos abaixo NÃO
   * dependam dela — senão eles re-executariam a cada tecla digitada.
   */
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Escape + focus trap. Depende só de `open`, nunca de props instáveis.
  useEffect(() => {
    if (!open) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !ref.current) return

      const f = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null, // ignora o que está oculto
      )
      if (!f.length) return

      const first = f[0]
      const last = f[f.length - 1]
      const active = document.activeElement

      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open])

  /**
   * Autofoco: roda UMA vez por abertura (dependência só `open`).
   * Prefere um campo do corpo do modal — nunca o "X" do cabeçalho, que é o
   * primeiro focável em ordem de documento.
   */
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => {
      const body = bodyRef.current
      if (!body) return
      const target =
        body.querySelector<HTMLElement>('[data-autofocus]') ??
        body.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), textarea:not([disabled])') ??
        body.querySelector<HTMLElement>(FOCUSABLE)
      target?.focus()
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        // cursor no fim do texto, em vez de selecionar tudo
        const end = target.value.length
        target.setSelectionRange?.(end, end)
      }
    }, 30)
    return () => window.clearTimeout(t)
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-crust/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onCloseRef.current()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={ref}
        className="card anim-pop max-h-[88vh] w-full overflow-hidden"
        style={{ maxWidth: width }}
      >
        <header className="flex items-center gap-2 border-b border-surface0 px-4 py-2.5">
          <Icon name={icon} className="text-mauve" size={15} />
          <h2 className="flex-1 text-sm font-semibold tracking-wide text-text">{title}</h2>
          <button className="btn btn-ghost !px-2 !py-1" onClick={onClose} aria-label="Fechar">
            <Icon name="close" size={13} />
          </button>
        </header>
        <div ref={bodyRef} className="max-h-[64vh] overflow-y-auto px-4 py-3.5">
          {children}
        </div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-surface0 px-4 py-2.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
