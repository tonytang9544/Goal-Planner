import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const apiProxyTarget = env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:3000'
  let target: URL
  try {
    target = new URL(apiProxyTarget)
  } catch (error) {
    throw new Error('VITE_API_PROXY_TARGET must be a valid HTTP or HTTPS URL.', { cause: error })
  }
  if (
    (target.protocol !== 'http:' && target.protocol !== 'https:')
    || target.username.length > 0
    || target.password.length > 0
    || target.search.length > 0
    || target.hash.length > 0
  ) {
    throw new Error('VITE_API_PROXY_TARGET must be an HTTP or HTTPS base URL without credentials, query, or fragment.')
  }

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': target.toString().replace(/\/$/, ''),
      },
    },
  }
})
