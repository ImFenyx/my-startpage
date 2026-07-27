import { memo, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon'
import Modal from './Modal'
import { usePersistentState, uid } from '../lib/storage'
import { DEFAULT_CATEGORIES } from '../lib/defaults'
import { ICON_PICKER, guessIcon, glyph } from '../lib/icons'
import { safeHref, normalizeUserUrl } from '../lib/safe-url'
import type { Category, QuickLink } from '../lib/types'

const PER_PAGE = 5 // 5 por página, conforme o wireframe

function QuickLinks() {
  const [cats, setCats] = usePersistentState<Category[]>('links:categories', DEFAULT_CATEGORIES)
  const [activeId, setActiveId] = usePersistentState<string>('links:active', DEFAULT_CATEGORIES[0].id)
  const [page, setPage] = useState(0)

  const [linkModal, setLinkModal] = useState<{ open: boolean; edit?: QuickLink }>({ open: false })
  const [catModal, setCatModal] = useState(false)
  const [manage, setManage] = useState(false)

  const active = useMemo(() => cats.find((c) => c.id === activeId) ?? cats[0], [cats, activeId])
  const links = active?.links ?? []
  const pages = Math.max(1, Math.ceil(links.length / PER_PAGE))

  useEffect(() => {
    setPage(0)
  }, [activeId])
  useEffect(() => {
    if (page > pages - 1) setPage(Math.max(0, pages - 1))
  }, [pages, page])

  const slice = links.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)
  const go = (d: number) => setPage((p) => (p + d + pages) % pages)

  const upsertLink = (l: QuickLink) => {
    setCats((cs) =>
      cs.map((c) =>
        c.id !== active.id
          ? c
          : {
              ...c,
              links: c.links.some((x) => x.id === l.id)
                ? c.links.map((x) => (x.id === l.id ? l : x))
                : [...c.links, l],
            },
      ),
    )
  }
  const removeLink = (id: string) =>
    setCats((cs) => cs.map((c) => (c.id !== active.id ? c : { ...c, links: c.links.filter((x) => x.id !== id) })))

  return (
    <section className="card flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* header */}
      <header className="flex items-center gap-2 border-b border-surface0 px-3 py-2">
        <Icon name="grid" className="text-mauve" size={13} />
        <h2 className="text-[0.78rem] font-semibold tracking-wide text-text">Links Rápidos</h2>
        <span className="font-mono text-[0.66rem] text-subtext0">
          {links.length} · pág {page + 1}/{pages}
        </span>
        <button
          className="btn btn-ghost ml-auto !px-1.5 !py-0.5"
          title="Gerenciar links desta categoria"
          onClick={() => setManage(true)}
        >
          <Icon name="sliders" size={12} />
        </button>
      </header>

      {/* carrossel */}
      <div className="flex min-h-0 flex-1 items-center gap-1.5 px-2 py-2">
        <button
          className="btn btn-ghost h-full !w-7 shrink-0 !px-0 disabled:opacity-30"
          onClick={() => go(-1)}
          disabled={pages < 2}
          aria-label="Página anterior"
          title="Anterior (←)"
        >
          <Icon name="left" size={13} />
        </button>

        <div key={`${active?.id}-${page}`} className="anim-in grid min-h-0 flex-1 grid-cols-5 gap-1.5">
          {slice.map((l) => (
            <a
              key={l.id}
              href={safeHref(l.url)}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-transparent px-1 py-2 text-center transition-all hover:border-mauve/40 hover:bg-surface0/70"
              title={`${l.label} — ${l.url}`}
            >
              <Icon
                name={l.icon}
                size={22}
                className="text-subtext0 transition-colors group-hover:text-mauve"
                style={l.color ? { color: l.color } : undefined}
              />
              <span className="w-full truncate text-[0.66rem] text-subtext0 transition-colors group-hover:text-text">
                {l.label}
              </span>
            </a>
          ))}

          {slice.length < PER_PAGE && (
            <button
              onClick={() => setLinkModal({ open: true })}
              className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-surface1 px-1 py-2 text-overlay0 transition-all hover:border-mauve hover:text-mauve"
              title="Adicionar link"
            >
              <Icon name="plus" size={18} />
              <span className="text-[0.62rem]">novo</span>
            </button>
          )}
          {Array.from({ length: Math.max(0, PER_PAGE - slice.length - 1) }).map((_, i) => (
            <div key={`e${i}`} />
          ))}
        </div>

        <button
          className="btn btn-ghost h-full !w-7 shrink-0 !px-0 disabled:opacity-30"
          onClick={() => go(1)}
          disabled={pages < 2}
          aria-label="Próxima página"
          title="Próxima (→)"
        >
          <Icon name="right" size={13} />
        </button>
      </div>

      {/* dots */}
      {pages > 1 && (
        <div className="flex justify-center gap-1 pb-1.5">
          {Array.from({ length: pages }).map((_, i) => (
            <button
              key={i}
              onClick={() => setPage(i)}
              aria-label={`Página ${i + 1}`}
              className="h-1 rounded-full transition-all"
              style={{
                width: i === page ? 16 : 6,
                background: i === page ? 'var(--color-mauve)' : 'var(--color-surface1)',
              }}
            />
          ))}
        </div>
      )}

      {/* tabs de categoria */}
      <footer className="flex flex-wrap items-center gap-1.5 border-t border-surface0 px-3 py-2">
        {cats.map((c) => (
          <button
            key={c.id}
            className="chip"
            data-active={c.id === active?.id}
            onClick={() => setActiveId(c.id)}
            onDoubleClick={() => {
              if (cats.length > 1 && confirm(`Excluir a categoria "${c.name}" e seus links?`)) {
                setCats((cs) => cs.filter((x) => x.id !== c.id))
                if (activeId === c.id) setActiveId(cats.find((x) => x.id !== c.id)!.id)
              }
            }}
            title="Clique para trocar · duplo-clique para excluir"
          >
            <Icon name={c.icon} size={11} />
            {c.name}
          </button>
        ))}
        <button className="chip !px-2 text-mauve" onClick={() => setCatModal(true)} title="Nova categoria">
          <Icon name="plus" size={11} />
        </button>
      </footer>

      <LinkModal
        state={linkModal}
        onClose={() => setLinkModal({ open: false })}
        onSave={(l) => {
          upsertLink(l)
          setLinkModal({ open: false })
        }}
      />

      <CategoryModal
        open={catModal}
        onClose={() => setCatModal(false)}
        onSave={(name, icon) => {
          const c: Category = { id: uid(), name, icon, links: [] }
          setCats((cs) => [...cs, c])
          setActiveId(c.id)
          setCatModal(false)
        }}
      />

      <Modal
        open={manage}
        onClose={() => setManage(false)}
        title={`Links de "${active?.name}"`}
        icon="folder"
        width={520}
        footer={
          <button
            className="btn btn-accent"
            onClick={() => {
              setManage(false)
              setLinkModal({ open: true })
            }}
          >
            <Icon name="plus" size={12} /> Novo link
          </button>
        }
      >
        <ul className="flex flex-col gap-1.5">
          {links.map((l, i) => (
            <li key={l.id} className="flex items-center gap-2 rounded-lg bg-surface0/50 px-2.5 py-1.5">
              <Icon name={l.icon} className="text-mauve" size={15} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{l.label}</div>
                <div className="truncate font-mono text-[0.66rem] text-subtext0">{l.url}</div>
              </div>
              <button
                className="btn btn-ghost !px-1.5 !py-1 disabled:opacity-30"
                disabled={i === 0}
                onClick={() =>
                  setCats((cs) =>
                    cs.map((c) => {
                      if (c.id !== active.id) return c
                      const arr = [...c.links]
                      ;[arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]
                      return { ...c, links: arr }
                    }),
                  )
                }
                title="Subir"
              >
                <Icon name="up" size={11} />
              </button>
              <button
                className="btn btn-ghost !px-1.5 !py-1 disabled:opacity-30"
                disabled={i === links.length - 1}
                onClick={() =>
                  setCats((cs) =>
                    cs.map((c) => {
                      if (c.id !== active.id) return c
                      const arr = [...c.links]
                      ;[arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]
                      return { ...c, links: arr }
                    }),
                  )
                }
                title="Descer"
              >
                <Icon name="down" size={11} />
              </button>
              <button
                className="btn btn-ghost !px-1.5 !py-1"
                onClick={() => {
                  setManage(false)
                  setLinkModal({ open: true, edit: l })
                }}
                title="Editar"
              >
                <Icon name="pencil" size={11} />
              </button>
              <button
                className="btn btn-ghost !px-1.5 !py-1 hover:!text-red"
                onClick={() => removeLink(l.id)}
                title="Excluir"
              >
                <Icon name="trash" size={11} />
              </button>
            </li>
          ))}
          {!links.length && <p className="py-6 text-center text-sm text-overlay0">Nenhum link ainda.</p>}
        </ul>
      </Modal>
    </section>
  )
}

/* ───────────────────────── modais ───────────────────────── */

function LinkModal({
  state,
  onClose,
  onSave,
}: {
  state: { open: boolean; edit?: QuickLink }
  onClose: () => void
  onSave: (l: QuickLink) => void
}) {
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [icon, setIcon] = useState('link')
  const [q, setQ] = useState('')
  const touched = useRef(false)

  useEffect(() => {
    if (state.open) {
      setLabel(state.edit?.label ?? '')
      setUrl(state.edit?.url ?? '')
      setIcon(state.edit?.icon ?? 'link')
      setQ('')
      touched.current = !!state.edit
    }
  }, [state.open, state.edit])

  const onUrlChange = (v: string) => {
    setUrl(v)
    if (!touched.current && v.length > 6) setIcon(guessIcon(v))
    if (!label && v.length > 8) {
      try {
        const h = new URL(v.startsWith('http') ? v : `https://${v}`).hostname.replace(/^www\./, '')
        setLabel(h.split('.')[0].replace(/^\w/, (m) => m.toUpperCase()))
      } catch {
        /* noop */
      }
    }
  }

  const list = q ? ICON_PICKER.filter((i) => i.toLowerCase().includes(q.toLowerCase())) : ICON_PICKER

  const submit = () => {
    if (!label.trim() || !url.trim()) return
    const href = normalizeUserUrl(url)
    if (!href) return // esquema não permitido (javascript:, data:, …)
    onSave({ id: state.edit?.id ?? uid(), label: label.trim(), url: href, icon })
  }

  return (
    <Modal
      open={state.open}
      onClose={onClose}
      title={state.edit ? 'Editar link' : 'Novo link'}
      icon="link"
      width={470}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-accent" onClick={submit} disabled={!label.trim() || !url.trim()}>
            <Icon name="check" size={12} /> Salvar
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-subtext0">
          URL
          <input
            data-autofocus
            className="field font-mono text-sm"
            placeholder="https://github.com"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-subtext0">
          Nome
          <input
            className="field text-sm"
            placeholder="GitHub"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>

        <div className="flex flex-col gap-1.5 text-xs text-subtext0">
          <div className="flex items-center gap-2">
            <span>Ícone Nerd Font</span>
            <span className="flex items-center gap-1.5 rounded-md bg-crust px-2 py-0.5">
              <Icon name={icon} className="text-mauve" size={14} />
              <code className="text-[0.66rem] text-subtext0">{icon}</code>
            </span>
            <input
              className="field ml-auto max-w-[150px] !py-1 text-xs"
              placeholder="buscar ou hex (f09b)"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                const hex = e.target.value.replace(/^(0x|U\+|\\u)/i, '')
                if (/^[0-9a-f]{4,6}$/i.test(hex) && glyph(hex) !== hex) {
                  setIcon(hex)
                  touched.current = true
                }
              }}
            />
          </div>
          <div className="grid max-h-40 grid-cols-10 gap-1 overflow-y-auto rounded-lg bg-crust p-2">
            {list.map((n) => (
              <button
                key={n}
                title={n}
                onClick={() => {
                  setIcon(n)
                  touched.current = true
                }}
                className="grid aspect-square place-items-center rounded-md transition-colors hover:bg-surface1"
                style={{
                  background: icon === n ? 'color-mix(in oklab, var(--color-mauve) 25%, transparent)' : undefined,
                  color: icon === n ? 'var(--color-mauve)' : 'var(--color-subtext0)',
                }}
              >
                <Icon name={n} size={15} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function CategoryModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean
  onClose: () => void
  onSave: (name: string, icon: string) => void
}) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('folder')
  useEffect(() => {
    if (open) {
      setName('')
      setIcon('folder')
    }
  }, [open])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova categoria"
      icon="folder"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-accent" disabled={!name.trim()} onClick={() => onSave(name.trim().toLowerCase(), icon)}>
            <Icon name="check" size={12} /> Criar
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-subtext0">
          Nome
          <input
            data-autofocus
            className="field text-sm"
            placeholder="ex.: estudos, jogos, financeiro"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim().toLowerCase(), icon)}
          />
        </label>
        <div className="flex flex-col gap-1.5 text-xs text-subtext0">
          Ícone
          <div className="grid max-h-40 grid-cols-10 gap-1 overflow-y-auto rounded-lg bg-crust p-2">
            {ICON_PICKER.map((n) => (
              <button
                key={n}
                title={n}
                onClick={() => setIcon(n)}
                className="grid aspect-square place-items-center rounded-md transition-colors hover:bg-surface1"
                style={{
                  background: icon === n ? 'color-mix(in oklab, var(--color-mauve) 25%, transparent)' : undefined,
                  color: icon === n ? 'var(--color-mauve)' : 'var(--color-subtext0)',
                }}
              >
                <Icon name={n} size={15} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

/**
 * memo: este bloco não recebe props e não precisa re-renderizar quando um
 * irmão atualiza (o Clock dispara 1 render/s no App).
 */
export default memo(QuickLinks)
