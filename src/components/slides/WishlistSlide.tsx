import { useMemo, useRef, useState } from 'react'
import Icon from '../Icon'
import Modal from '../Modal'
import { usePersistentState, uid } from '../../lib/storage'
import { DEFAULT_WISHLIST, WISH_CATEGORIES } from '../../lib/defaults'
import { safeHref, safeImageSrc } from '../../lib/safe-url'
import type { WishItem } from '../../lib/types'

const PRIO: Record<WishItem['priority'], string> = {
  Alta: 'var(--color-red)',
  Média: 'var(--color-peach)',
  Baixa: 'var(--color-blue)',
}

const CAT_ICON: Record<string, string> = {
  Tech: 'code',
  Roupa: 'tag',
  Deco: 'home',
  Livro: 'notebook',
  Meta: 'trophy',
  Outro: 'star',
}

const empty = (): WishItem => ({
  id: uid(),
  name: '',
  url: '',
  price: '',
  currency: 'R$',
  image: '',
  category: 'Tech',
  priority: 'Alta',
  done: false,
  createdAt: Date.now(),
})

export default function WishlistSlide() {
  const [items, setItems] = usePersistentState<WishItem[]>('wishlist:items', DEFAULT_WISHLIST)
  const [filter, setFilter] = usePersistentState<string>('wishlist:filter', 'Todos')
  const [editor, setEditor] = useState<WishItem | null>(null)
  const [scraping, setScraping] = useState(false)
  const [scrapeMsg, setScrapeMsg] = useState('')
  const [scrapeOk, setScrapeOk] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  const cats = useMemo(() => ['Todos', ...WISH_CATEGORIES], [])
  const list = items.filter((i) => filter === 'Todos' || i.category === filter)
  const total = list
    .filter((i) => !i.done && i.price)
    .reduce((s, i) => s + (parseFloat(String(i.price).replace(/\./g, '').replace(',', '.')) || 0), 0)

  const save = (it: WishItem) => {
    setItems((xs) => (xs.some((x) => x.id === it.id) ? xs.map((x) => (x.id === it.id ? it : x)) : [it, ...xs]))
    setEditor(null)
    setScrapeMsg('')
  }

  const scrape = async (url: string) => {
    if (!editor || !/^https?:\/\//i.test(url.startsWith('http') ? url : `https://${url}`)) return
    const target = /^https?:\/\//i.test(url) ? url : `https://${url}`
    setScraping(true)
    setScrapeMsg('')
    try {
      const r = await fetch(`/api/scrape?url=${encodeURIComponent(target)}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'falhou')
      // Se a loja bloqueou, o título costuma ser genérico ("Mercado Libre")
      // e a imagem é a logo — nesse caso não sobrescrevemos o que já existe.
      setEditor((e) =>
        e
          ? {
              ...e,
              url: target,
              name: e.name || (d.blocked ? '' : (d.title ?? '')),
              image: d.image && !d.blocked ? `/api/img?url=${encodeURIComponent(d.image)}` : e.image,
              price: d.price ? Number(d.price).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : e.price,
              currency: d.currency || e.currency,
            }
          : e,
      )
      const warns: string[] = d.warnings ?? []
      setScrapeOk(!warns.length)
      if (warns.length) setScrapeMsg(`${d.siteName}: ${warns.join(' ')}`)
      else setScrapeMsg(`Dados obtidos de ${d.siteName}`)
    } catch (e: any) {
      setScrapeOk(false)
      setScrapeMsg(`Backend offline ou loja bloqueada (${String(e.message).slice(0, 60)}) — preencha manualmente.`)
    } finally {
      setScraping(false)
    }
  }

  const onFile = (f?: File) => {
    if (!f || !editor) return
    const reader = new FileReader()
    reader.onload = () => setEditor((e) => (e ? { ...e, image: String(reader.result) } : e))
    reader.readAsDataURL(f)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 px-4 pt-3 pb-2">
        <Icon name="heart" className="text-mauve" size={15} />
        <h2 className="text-[1rem] font-semibold text-text">Wishlist &amp; Metas</h2>
        <span className="font-mono text-[0.66rem] text-subtext0">
          {list.filter((i) => !i.done).length} abertos
        </span>
        {total > 0 && (
          <span className="rounded-full bg-surface0 px-2 py-0.5 font-mono text-[0.62rem] text-green">
            R$ {total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </span>
        )}
        <button
          className="btn btn-accent ml-auto !py-1 text-xs"
          onClick={() => {
            setEditor(empty())
            setScrapeMsg('')
          }}
        >
          <Icon name="plus" size={11} /> Criar
        </button>
      </header>

      <nav className="flex flex-wrap gap-1.5 px-4 pb-2">
        {cats.map((c) => (
          <button key={c} className="chip !py-0.5 !text-[0.68rem]" data-active={filter === c} onClick={() => setFilter(c)}>
            {c !== 'Todos' && <Icon name={CAT_ICON[c] ?? 'tag'} size={9} />}
            {c}
          </button>
        ))}
      </nav>

      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-3">
        {list.map((it) => (
          <li
            key={it.id}
            className="group flex gap-3 rounded-xl border border-surface0 bg-surface0/40 p-2.5 transition-all hover:border-surface1 hover:bg-surface0"
            style={{ opacity: it.done ? 0.45 : 1 }}
          >
            {/* imagem */}
            <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-surface1 bg-crust">
              {it.image ? (
                <img
                  src={safeImageSrc(it.image)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                  onError={(e) => ((e.currentTarget.style.display = 'none'))}
                />
              ) : (
                <Icon name={CAT_ICON[it.category] ?? 'image'} size={20} className="text-surface2" />
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
              <div className="flex items-center gap-2">
                {it.url ? (
                  <a
                    href={safeHref(it.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-sm font-semibold hover:text-mauve hover:underline"
                    style={{ textDecoration: it.done ? 'line-through' : undefined }}
                  >
                    {it.name}
                  </a>
                ) : (
                  <span className="truncate text-sm font-semibold" style={{ textDecoration: it.done ? 'line-through' : undefined }}>
                    {it.name}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 text-[0.64rem] text-subtext0">
                <span className="flex items-center gap-1">
                  <Icon name={CAT_ICON[it.category] ?? 'tag'} size={9} />
                  {it.category}
                </span>
                <span className="text-surface2">•</span>
                <span style={{ color: PRIO[it.priority] }}>{it.priority}</span>
                {it.url && (
                  <>
                    <span className="text-surface2">•</span>
                    <span className="truncate">{safeHost(it.url)}</span>
                  </>
                )}
              </div>

              {it.price && (
                <div className="font-mono text-sm font-bold text-green">
                  {it.currency || 'R$'} {it.price}
                </div>
              )}
            </div>

            <div className="flex shrink-0 flex-col justify-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                className="btn btn-ghost !px-1.5 !py-0.5"
                onClick={() => setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))}
                title={it.done ? 'Reabrir' : 'Marcar como conquistado'}
              >
                <Icon name="check" size={10} className={it.done ? 'text-green' : ''} />
              </button>
              <button className="btn btn-ghost !px-1.5 !py-0.5" onClick={() => setEditor(it)} title="Editar">
                <Icon name="pencil" size={10} />
              </button>
              <button
                className="btn btn-ghost !px-1.5 !py-0.5 hover:!text-red"
                onClick={() => setItems((xs) => xs.filter((x) => x.id !== it.id))}
                title="Apagar"
              >
                <Icon name="trash" size={10} />
              </button>
            </div>
          </li>
        ))}

        {!list.length && (
          <div className="grid h-full place-items-center">
            <div className="flex flex-col items-center gap-2 text-overlay0">
              <Icon name="heart" size={30} />
              <p className="text-sm">Nada por aqui ainda.</p>
            </div>
          </div>
        )}
      </ul>

      {/* editor */}
      <Modal
        open={!!editor}
        onClose={() => setEditor(null)}
        title={items.some((x) => x.id === editor?.id) ? 'Editar item' : 'Novo item'}
        icon="cart"
        width={540}
        footer={
          <>
            <button className="btn" onClick={() => setEditor(null)}>
              Cancelar
            </button>
            <button className="btn btn-accent" disabled={!(editor?.name ?? '').trim()} onClick={() => editor && save(editor)}>
              <Icon name="check" size={12} /> Salvar
            </button>
          </>
        }
      >
        {editor && (
          <div className="flex flex-col gap-3">
            {/* url + scrape */}
            <label className="flex flex-col gap-1 text-xs text-subtext0">
              Link (o scraper busca preço e imagem — opcional)
              <div className="flex gap-2">
                <input
                  data-autofocus
                  className="field font-mono text-xs"
                  placeholder="https://loja.com/produto"
                  value={editor.url ?? ''}
                  onChange={(e) => setEditor({ ...editor, url: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && scrape(editor.url ?? '')}
                />
                <button
                  className="btn btn-accent shrink-0 !py-1 text-xs"
                  disabled={!editor.url || scraping}
                  onClick={() => scrape(editor.url ?? '')}
                >
                  <Icon name={scraping ? 'reset' : 'search'} size={11} className={scraping ? 'animate-spin' : ''} />
                  {scraping ? 'Raspando…' : 'Buscar'}
                </button>
              </div>
              {scrapeMsg && (
                <span
                  className="flex items-start gap-1.5 text-[0.66rem] leading-relaxed"
                  style={{ color: scrapeOk ? 'var(--color-green)' : 'var(--color-yellow)' }}
                >
                  <Icon name={scrapeOk ? 'check' : 'warning'} size={9} className="mt-0.5 shrink-0" />
                  <span className="min-w-0">{scrapeMsg}</span>
                </span>
              )}
            </label>

            <div className="flex gap-3">
              {/* preview imagem */}
              <div className="flex flex-col items-center gap-1.5">
                <div className="grid h-[86px] w-[86px] place-items-center overflow-hidden rounded-xl border border-surface1 bg-crust">
                  {editor.image ? (
                    <img src={safeImageSrc(editor.image)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  ) : (
                    <Icon name="image" size={22} className="text-surface2" />
                  )}
                </div>
                <button className="btn btn-ghost !px-2 !py-0.5 text-[0.66rem]" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={10} /> upload
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => onFile(e.target.files?.[0])}
                />
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                <label className="flex flex-col gap-1 text-xs text-subtext0">
                  Nome
                  <input
                    className="field text-sm"
                    placeholder="Teclado mecânico 65%"
                    value={editor.name}
                    onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                  />
                </label>
                <div className="flex gap-2">
                  <label className="flex w-20 flex-col gap-1 text-xs text-subtext0">
                    Moeda
                    <input
                      className="field text-sm"
                      value={editor.currency ?? ''}
                      onChange={(e) => setEditor({ ...editor, currency: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-1 flex-col gap-1 text-xs text-subtext0">
                    Preço
                    <input
                      className="field font-mono text-sm"
                      placeholder="480,00"
                      value={editor.price ?? ''}
                      onChange={(e) => setEditor({ ...editor, price: e.target.value })}
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-xs text-subtext0">
                  URL da imagem (alternativa ao upload)
                  <input
                    className="field font-mono text-[0.7rem]"
                    placeholder="https://…/foto.jpg"
                    value={editor.image?.startsWith('data:') ? '' : (editor.image ?? '')}
                    onChange={(e) => setEditor({ ...editor, image: e.target.value })}
                  />
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1 text-xs text-subtext0">
                Categoria
                <div className="flex flex-wrap gap-1.5">
                  {WISH_CATEGORIES.map((c) => (
                    <button
                      key={c}
                      className="chip !py-0.5 !text-[0.68rem]"
                      data-active={editor.category === c}
                      onClick={() => setEditor({ ...editor, category: c })}
                    >
                      <Icon name={CAT_ICON[c] ?? 'tag'} size={9} />
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <label className="ml-auto flex flex-col gap-1 text-xs text-subtext0">
                Prioridade
                <select
                  className="field !py-1 text-sm"
                  value={editor.priority}
                  onChange={(e) => setEditor({ ...editor, priority: e.target.value as WishItem['priority'] })}
                  style={{ color: PRIO[editor.priority] }}
                >
                  <option>Alta</option>
                  <option>Média</option>
                  <option>Baixa</option>
                </select>
              </label>
            </div>

            <p className="flex items-start gap-2 rounded-lg bg-crust px-3 py-2 text-[0.68rem] leading-relaxed text-subtext0">
              <Icon name="info" size={11} className="mt-0.5 text-lavender" />
              O scraping roda no backend local (<code className="text-peach">npm run server</code> →{' '}
              <code className="text-peach">localhost:8787</code>): lê JSON-LD schema.org/Product, og:image e
              meta tags de preço. Se a loja bloquear, preencha manualmente.
            </p>
          </div>
        )}
      </Modal>
    </div>
  )
}

function safeHost(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return u
  }
}
