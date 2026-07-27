import { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import Icon from '../Icon'
import { usePersistentState, useDebouncedCallback, uid } from '../../lib/storage'
import { DEFAULT_NOTES } from '../../lib/defaults'
import type { Note } from '../../lib/types'

marked.setOptions({ breaks: true, gfm: true })

/**
 * Sanitização do markdown.
 *
 * As notas são suas, mas podem chegar de um backup JSON importado ou do sync,
 * então tratamos o conteúdo como não confiável. Além do DOMPurify:
 *
 *  - allowlist de tags/atributos (nada de <script>, <iframe>, on*);
 *  - links externos ganham rel="noopener noreferrer" via hook;
 *  - se o DOMPurify não estiver operante (ambiente sem DOM), devolvemos
 *    texto escapado em vez de HTML cru — falha fechada, não aberta.
 */
const ALLOWED_TAGS = [
  'h1','h2','h3','h4','h5','h6','p','br','hr','strong','em','del','ins','sub','sup',
  'ul','ol','li','blockquote','pre','code','a','img','table','thead','tbody','tr','th','td','input','span','div',
]
const ALLOWED_ATTR = ['href','title','alt','src','class','type','checked','disabled','start','colspan','rowspan']

let hookInstalled = false
function installHook() {
  if (hookInstalled || typeof DOMPurify.addHook !== 'function') return
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('href')) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
  hookInstalled = true
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

function renderMarkdown(src: string): string {
  const raw = marked.parse(src, { async: false }) as string
  // fail-safe: sem DOMPurify operante, nunca injetamos HTML
  if (typeof DOMPurify?.sanitize !== 'function' || DOMPurify.isSupported === false) {
    return `<pre>${escapeHtml(src)}</pre>`
  }
  installHook()
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'svg', 'math'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'formaction'],
  })
}

/**
 * Normaliza uma nota vinda do storage.
 *
 * O dado pode chegar incompleto: backup antigo, importação de terceiro,
 * gravação parcial do sync ou objeto malformado. Sem isto, uma nota sem
 * `body` quebrava o componente inteiro em `active.body.trim()` — o optional
 * chaining de `active?.body.trim()` protege apenas `active`, não `body`.
 */
function normalizeNote(n: unknown, i: number): Note {
  const o = (n ?? {}) as Partial<Note>
  return {
    id: typeof o.id === 'string' && o.id ? o.id : `nota-${i}-${Date.now().toString(36)}`,
    title: typeof o.title === 'string' ? o.title : 'Sem título',
    body: typeof o.body === 'string' ? o.body : '',
    updatedAt: typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : Date.now(),
    pinned: Boolean(o.pinned),
  }
}

function normalizeNotes(v: unknown): Note[] {
  if (!Array.isArray(v)) return []
  return v.map(normalizeNote)
}

export default function NotesSlide() {
  const [rawNotes, setNotes] = usePersistentState<Note[]>('notes:list', DEFAULT_NOTES)

  // Toda leitura passa pela normalização — inclusive dados que cheguem via sync.
  const notes = useMemo(() => normalizeNotes(rawNotes), [rawNotes])
  const [activeId, setActiveId] = usePersistentState<string>('notes:active', DEFAULT_NOTES[0].id)
  const [preview, setPreview] = useState(false)
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle')
  const taRef = useRef<HTMLTextAreaElement>(null)

  const active = useMemo(() => notes.find((n) => n.id === activeId) ?? notes[0], [notes, activeId])

  useEffect(() => {
    if (!notes.length) {
      const n: Note = { id: uid(), title: 'Nova nota', body: '', updatedAt: Date.now() }
      setNotes([n])
      setActiveId(n.id)
    }
  }, [notes.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const flagSaved = useDebouncedCallback(() => setSaved('saved'), 450)

  const update = (patch: Partial<Note>) => {
    setSaved('saving')
    flagSaved()
    setNotes((ns) => ns.map((n) => (n.id === active.id ? { ...n, ...patch, updatedAt: Date.now() } : n)))
  }

  useEffect(() => {
    if (saved !== 'saved') return
    const t = setTimeout(() => setSaved('idle'), 1400)
    return () => clearTimeout(t)
  }, [saved])

  const addNote = () => {
    const n: Note = { id: uid(), title: 'Nova nota', body: '# ', updatedAt: Date.now() }
    setNotes((ns) => [n, ...ns])
    setActiveId(n.id)
    setPreview(false)
    setTimeout(() => taRef.current?.focus(), 40)
  }

  const del = (id: string) => {
    if (!confirm('Excluir esta nota?')) return
    setNotes((ns) => {
      const rest = ns.filter((n) => n.id !== id)
      if (id === activeId && rest.length) setActiveId(rest[0].id)
      return rest
    })
  }

  const exportMd = () => {
    const blob = new Blob([active.body], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${active.title.replace(/[^\w\-À-ÿ ]/g, '').trim() || 'nota'}.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // Tab dentro do textarea insere indentação em vez de trocar o foco
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.currentTarget
      const { selectionStart: s, selectionEnd: en, value } = el
      el.value = value.slice(0, s) + '  ' + value.slice(en)
      el.selectionStart = el.selectionEnd = s + 2
      update({ body: el.value })
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
      e.preventDefault()
      setPreview((p) => !p)
    }
  }

  const html = useMemo(() => renderMarkdown(active?.body ?? ''), [active?.body])


  const words = ((active?.body ?? '').trim().match(/\S+/g) ?? []).length

  if (!active) return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 px-4 pt-3 pb-2">
        <Icon name="note" className="text-mauve" size={15} />
        <input
          className="min-w-0 flex-1 border-0 bg-transparent text-[1rem] font-semibold text-text outline-none focus:text-mauve"
          value={active.title}
          onChange={(e) => update({ title: e.target.value })}
          aria-label="Título da nota"
        />

        <span
          className="flex shrink-0 items-center gap-1 font-mono text-[0.62rem] transition-opacity"
          style={{ color: saved === 'saved' ? 'var(--color-green)' : 'var(--color-subtext0)', opacity: saved === 'idle' ? 0.6 : 1 }}
        >
          <Icon name={saved === 'saved' ? 'check' : 'save'} size={9} />
          {saved === 'saving' ? 'salvando…' : saved === 'saved' ? 'salvo' : `${words}p`}
        </span>

        <button
          className="btn btn-ghost !px-2 !py-1"
          onClick={() => setPreview((p) => !p)}
          title="Alternar preview markdown (Ctrl+E)"
          style={{ color: preview ? 'var(--color-mauve)' : undefined }}
        >
          <Icon name={preview ? 'pencil' : 'eye'} size={12} />
        </button>
        <button className="btn btn-ghost !px-2 !py-1" onClick={exportMd} title="Exportar .md">
          <Icon name="upload" size={12} />
        </button>
      </header>

      {/* editor / preview */}
      <div className="min-h-0 flex-1 px-4 pb-2">
        {preview ? (
          <div
            className="md h-full overflow-y-auto rounded-xl border border-surface0 bg-crust/60 px-4 py-3 text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <textarea
            ref={taRef}
            className="h-full w-full resize-none rounded-xl border border-surface0 bg-crust/60 px-4 py-3 font-mono text-[0.82rem] leading-relaxed outline-none transition-colors focus:border-mauve/60"
            placeholder={'# Foco do dia\n\n- [ ] uma coisa de cada vez\n\n**Markdown** suportado · Ctrl+E alterna o preview'}
            value={active.body}
            onChange={(e) => update({ body: e.target.value })}
            onKeyDown={onKeyDown}
            spellCheck={false}
          />
        )}
      </div>

      {/* blocos salvos */}
      <footer className="flex items-stretch gap-2 border-t border-surface0 px-4 py-2.5">
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
          {notes.map((n) => (
            <button
              key={n.id}
              onClick={() => setActiveId(n.id)}
              onDoubleClick={() => del(n.id)}
              className="group relative flex w-[132px] shrink-0 flex-col gap-0.5 rounded-lg border px-2.5 py-1.5 text-left transition-all"
              style={{
                borderColor: n.id === active.id ? 'var(--color-mauve)' : 'var(--color-surface0)',
                background: n.id === active.id ? 'color-mix(in oklab, var(--color-mauve) 12%, transparent)' : 'var(--color-surface0)/40',
              }}
              title={`${n.title} — duplo-clique para excluir`}
            >
              <span className="flex items-center gap-1 truncate text-[0.7rem] font-semibold">
                <Icon name="note" size={9} className="shrink-0 text-overlay1" />
                <span className="truncate"># {n.title}</span>
              </span>
              <span className="font-mono text-[0.6rem] text-overlay0">
                {new Date(n.updatedAt).toLocaleDateString('pt-BR')}
              </span>
            </button>
          ))}
        </div>
        <button className="btn btn-accent shrink-0 !px-3" onClick={addNote} title="Nova nota">
          <Icon name="plus" size={13} />
        </button>
      </footer>
    </div>
  )
}
