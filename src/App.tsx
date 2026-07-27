import { useEffect, useState } from 'react'
import Clock from './components/Clock'
import Pomodoro from './components/Pomodoro'
import QuickLinks from './components/QuickLinks'
import RightCarousel from './components/RightCarousel'
import Icon from './components/Icon'
import Modal from './components/Modal'
import ErrorBoundary from './components/ErrorBoundary'
import { exportAll, importAll } from './lib/storage'
import * as sync from './lib/sync'
import type { SyncState } from './lib/sync'
import { applyUpdate, onConnectivity } from './lib/pwa'

export default function App() {
  const [help, setHelp] = useState(false)
  const [syncState, setSyncState] = useState<SyncState>('off')
  const [online, setOnline] = useState(true)
  const [hasUpdate, setHasUpdate] = useState(false)

  // conectividade + aviso de nova versão do app
  useEffect(() => {
    const offConn = onConnectivity(setOnline)
    const onUpd = () => setHasUpdate(true)
    window.addEventListener('startpage:update-available', onUpd)
    return () => {
      offConn()
      window.removeEventListener('startpage:update-available', onUpd)
    }
  }, [])

  // Boot: detecta o backend e reconcilia com o SQLite.
  useEffect(() => {
    const off = sync.onSyncState(setSyncState)
    ;(async () => {
      if (await sync.probe()) {
        const updated = await sync.pull()
        if (updated.length) {
          window.dispatchEvent(new CustomEvent('startpage:pulled', { detail: updated }))
        }
      }
    })()
    return () => {
      off()
    }
  }, [])

  const backup = () => {
    const blob = new Blob([JSON.stringify(exportAll(), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `startpage-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const restore = () => {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = 'application/json'
    inp.onchange = async () => {
      const f = inp.files?.[0]
      if (!f) return
      try {
        const text = await f.text()
        if (text.length > 10_000_000) {
          alert('Backup grande demais (limite de 10 MB).')
          return
        }
        const { imported, skipped } = importAll(JSON.parse(text))
        if (!imported.length) {
          alert('Nenhuma chave válida encontrada no arquivo.')
          return
        }
        const aviso = skipped.length
          ? `\n\nIgnoradas (${skipped.length}): ${skipped.slice(0, 5).join(', ')}`
          : ''
        alert(`Importadas ${imported.length} chaves.${aviso}`)
        location.reload()
      } catch (e) {
        alert(`Arquivo inválido: ${String((e as Error).message).slice(0, 100)}`)
      }
    }
    inp.click()
  }

  return (
    <main className="grid h-screen w-screen grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(360px,40fr)_minmax(420px,60fr)]">
      {/* ── COLUNA ESQUERDA ───────────────────────────────── */}
      <div className="grid min-h-0 grid-rows-[auto_1fr] gap-3">
        {/* bloco superior: relógio + pomodoro */}
        <section className="card flex flex-col gap-3 px-4 py-3.5">
          <ErrorBoundary name="Relógio" compact>
            <Clock />
          </ErrorBoundary>
          <ErrorBoundary name="Pomodoro" compact>
            <Pomodoro />
          </ErrorBoundary>
        </section>

        {/* bloco inferior: links rápidos */}
        <ErrorBoundary name="Links Rápidos">
          <QuickLinks />
        </ErrorBoundary>
      </div>

      {/* ── COLUNA DIREITA ────────────────────────────────── */}
      <ErrorBoundary name="Carrossel">
        <RightCarousel />
      </ErrorBoundary>

      {/* rodapé: atalhos + estado do sync */}
      <div className="fixed bottom-2 left-3 flex items-center gap-1">
        <button
          className="btn btn-ghost !px-1.5 !py-0.5 text-[0.62rem] opacity-60 transition-opacity hover:opacity-100"
          onClick={() => setHelp(true)}
          title="Atalhos e backup"
        >
          <Icon name="info" size={10} /> atalhos
        </button>
        <SyncBadge state={syncState} />

        {!online && (
          <span
            className="flex items-center gap-1 rounded-full border border-yellow/40 px-2 py-0.5 text-[0.62rem] text-yellow"
            title="Sem conexão — tudo continua salvo neste navegador"
            role="status"
          >
            <Icon name="cloud" size={9} /> offline
          </span>
        )}

        {hasUpdate && (
          <button
            className="btn btn-accent !px-2 !py-0.5 text-[0.62rem]"
            onClick={applyUpdate}
            title="Uma versão nova foi baixada"
          >
            <Icon name="reset" size={9} /> atualizar
          </button>
        )}
      </div>

      <Modal
        open={help}
        onClose={() => setHelp(false)}
        title="Atalhos & dados"
        icon="bolt"
        width={480}
        footer={
          <>
            <button className="btn" onClick={restore}>
              <Icon name="upload" size={11} /> Restaurar
            </button>
            <button className="btn btn-accent" onClick={backup}>
              <Icon name="save" size={11} /> Backup .json
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <ul className="space-y-1.5">
            {[
              ['Espaço', 'Play / pause do Pomodoro'],
              ['R / S', 'Reiniciar / pular fase'],
              ['← →', 'Navegar entre os slides da direita'],
              ['1 2 3', 'Ir direto para Tarefas / Wishlist / Notas'],
              ['Ctrl+E', 'Alternar preview markdown nas notas'],
              ['Tab', 'Indentar dentro do bloco de notas'],
              ['Esc', 'Fechar qualquer modal'],
            ].map(([k, d]) => (
              <li key={k} className="flex items-center gap-3">
                <kbd className="min-w-[74px] rounded-md border border-surface1 bg-crust px-2 py-0.5 text-center font-mono text-[0.7rem] text-mauve">
                  {k}
                </kbd>
                <span className="text-subtext0">{d}</span>
              </li>
            ))}
          </ul>
          <p className="flex items-start gap-2 rounded-lg bg-crust px-3 py-2 text-[0.7rem] leading-relaxed text-overlay1">
            <Icon name="info" size={11} className="mt-0.5 text-lavender" />
            Tudo é salvo no <b>localStorage</b> deste navegador. Faça backup periódico com o botão abaixo — o JSON
            restaura links, notas, wishlist e configurações em qualquer máquina.
          </p>
        </div>
      </Modal>
    </main>
  )
}

/** Indicador discreto do estado de sincronização com o SQLite. */
function SyncBadge({ state }: { state: SyncState }) {
  const meta: Record<SyncState, { icon: string; color: string; label: string }> = {
    off: { icon: 'save', color: 'var(--color-subtext0)', label: 'Só neste navegador (backend offline)' },
    idle: { icon: 'cloud', color: 'var(--color-green)', label: 'Sincronizado com o servidor' },
    syncing: { icon: 'reset', color: 'var(--color-mauve)', label: 'Sincronizando…' },
    error: { icon: 'warning', color: 'var(--color-yellow)', label: 'Falha ao sincronizar — dados salvos localmente' },
  }
  const m = meta[state]
  return (
    <span
      className="flex items-center gap-1 px-1 text-[0.62rem] opacity-60 transition-opacity hover:opacity-100"
      style={{ color: m.color }}
      title={m.label}
    >
      <Icon name={m.icon} size={9} className={state === 'syncing' ? 'animate-spin' : ''} />
    </span>
  )
}
