/**
 * Registro do service worker.
 *
 * Só em produção: em desenvolvimento o SW mascara alterações de código,
 * servindo assets antigos do cache.
 */
export function registerSW(onUpdate?: () => void) {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })

      // detecta versão nova esperando para assumir
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing
        if (!sw) return
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            onUpdate?.()
          }
        })
      })

      // procura atualização a cada hora (a aba costuma ficar aberta o dia todo)
      setInterval(() => reg.update().catch(() => {}), 60 * 60_000)
    } catch (e) {
      console.warn('[pwa] falha ao registrar o service worker:', e)
    }
  })
}

/** Ativa a versão nova e recarrega. */
export async function applyUpdate() {
  const reg = await navigator.serviceWorker?.getRegistration()
  reg?.waiting?.postMessage('skip-waiting')
  navigator.serviceWorker?.addEventListener('controllerchange', () => location.reload(), {
    once: true,
  })
}

/** Estado da conexão, para a UI avisar quando estiver offline. */
export function onConnectivity(fn: (online: boolean) => void) {
  const emit = () => fn(navigator.onLine)
  window.addEventListener('online', emit)
  window.addEventListener('offline', emit)
  emit()
  return () => {
    window.removeEventListener('online', emit)
    window.removeEventListener('offline', emit)
  }
}
