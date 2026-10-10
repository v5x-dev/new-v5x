import { compilerAssets } from './scripts/compiler-assets.ts'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'

export default defineConfig({
  // Other Vite entry points must not overwrite the running app's dependencies.
  cacheDir: 'node_modules/.vite/app',
  server: {
    port: 3000,
    allowedHosts: [
      'k4xs74x6-3000.use.devtunnels.ms',
      'east-url-give-manufacturers.trycloudflare.com',
    ],
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  ssr: {
    noExternal: ['@convex-dev/better-auth'],
  },
  plugins: [
    compilerAssets(),
    tailwindcss(),
    tsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tanstackStart(),
    nitro({
      routeRules: {
        '/compiler/**': {
          headers: {
            vary: 'Accept-Encoding',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        },
        '/compiler/sdk-manifest.json': {
          headers: { 'Cache-Control': 'no-cache' },
        },
        '/compiler/llvm-21.11.0-alpha.1/manifest.json': {
          headers: { 'Cache-Control': 'no-cache' },
        },
        '/language/**': {
          headers: {
            vary: 'Accept-Encoding',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        },
        '/language/clangd-15.0.7/manifest.json': {
          headers: { 'Cache-Control': 'no-cache' },
        },
        '/language/sdk-manifest.json': {
          headers: { 'Cache-Control': 'no-cache' },
        },
        '/language/clangd-host.js': {
          headers: { 'Cache-Control': 'no-cache' },
        },
        '/**': {
          headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'credentialless',
          },
        },
      },
    }),
    viteReact(),
  ],
})
