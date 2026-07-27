import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { registerSW } from './lib/pwa'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// PWA: funciona offline depois da primeira visita (só em produção)
registerSW(() => window.dispatchEvent(new CustomEvent('startpage:update-available')))
