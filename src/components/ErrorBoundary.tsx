import { Component, type ErrorInfo, type ReactNode } from 'react'
import Icon from './Icon'

type Props = {
  /** Nome exibido no aviso, ex.: "Bloco de Notas". */
  name: string
  children: ReactNode
  /** Altura mínima do fallback, para não colapsar o layout. */
  compact?: boolean
}

type State = { error: Error | null }

/**
 * Isola falhas por bloco.
 *
 * Sem isto, uma exceção em qualquer componente derruba a árvore inteira: o
 * React desmonta tudo e sobra tela branca — relógio e Pomodoro inclusive.
 * Num painel que fica aberto o dia todo, perder tudo por causa de uma nota
 * malformada é inaceitável.
 *
 * Precisa ser classe: `componentDidCatch` não tem equivalente em hooks.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name}] falhou:`, error, info.componentStack)
  }

  private reset = () => this.setState({ error: null })

  /** Último recurso: limpa os dados do bloco e recarrega. */
  private hardReset = () => {
    const map: Record<string, string[]> = {
      'Bloco de Notas': ['notes:list', 'notes:active'],
      'Wishlist & Metas': ['wishlist:items', 'wishlist:filter'],
      Tarefas: ['tasks:local', 'tasks:groups', 'tasks:view', 'tasks:collapsed'],
      'Links Rápidos': ['links:categories', 'links:active'],
      Pomodoro: ['pomodoro:cfg', 'pomodoro:phase', 'pomodoro:cycles'],
    }
    const keys = map[this.props.name] ?? []
    if (!keys.length) return
    if (!confirm(`Isto apaga os dados de "${this.props.name}" neste navegador. Continuar?`)) return
    keys.forEach((k) => localStorage.removeItem(`startpage:${k}`))
    location.reload()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        role="alert"
        className="flex h-full min-h-0 flex-col items-center justify-center gap-3 p-4 text-center"
        style={{ minHeight: this.props.compact ? 80 : undefined }}
      >
        <Icon name="warning" size={this.props.compact ? 18 : 26} className="text-yellow" />

        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-text">{this.props.name} falhou</p>
          <p className="max-w-[42ch] text-[0.7rem] leading-relaxed text-subtext0">
            O resto da página continua funcionando. Você pode tentar de novo sem perder nada.
          </p>
        </div>

        <details className="max-w-full">
          <summary className="cursor-pointer text-[0.66rem] text-subtext0 hover:text-text">
            detalhes técnicos
          </summary>
          <pre className="mt-1 max-h-24 max-w-[46ch] overflow-auto rounded-md bg-crust px-2 py-1 text-left font-mono text-[0.62rem] text-peach">
            {error.message}
          </pre>
        </details>

        <div className="flex gap-2">
          <button className="btn btn-accent !py-1 text-xs" onClick={this.reset}>
            <Icon name="reset" size={11} /> Tentar de novo
          </button>
          <button className="btn !py-1 text-xs hover:!text-red" onClick={this.hardReset}>
            <Icon name="trash" size={11} /> Limpar dados do bloco
          </button>
        </div>
      </div>
    )
  }
}
