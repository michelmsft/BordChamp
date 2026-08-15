import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: env.BORDCHAMP_API_URL || 'http://localhost:3000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyRequest, request) => {
              const appAuthorization = request.headers['x-bordchamp-authorization']
              if (!appAuthorization) return
              proxyRequest.removeHeader('x-bordchamp-authorization')
              proxyRequest.setHeader('authorization', appAuthorization)
            })
          },
        },
      },
    },
  }
})
