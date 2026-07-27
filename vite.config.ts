import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    cssMinify: 'lightningcss',
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return
          // React muda pouco: chunk próprio, cache longo entre deploys
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react'
          // markdown só desce junto com o slide de Notas
          if (/[\\/]node_modules[\\/](marked|dompurify)[\\/]/.test(id)) return 'markdown'
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // backend de scraping (server/index.js)
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
})
