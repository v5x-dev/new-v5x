import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'

export default defineConfig({
  server: {
    allowedHosts: ['.use.devtunnels.ms'],
    host: '0.0.0.0',
    port: 3000,
  },
  ssr: {
    noExternal: ['@convex-dev/better-auth'],
  },
  optimizeDeps: {
    exclude: ['smolmachines'],
  },
  plugins: [
    tailwindcss(),
    tsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tanstackStart(),
    viteReact(),
  ],
})
