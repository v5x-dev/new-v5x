import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tsConfigPaths from 'vite-tsconfig-paths'

/** An independent local shell. Authenticated SSR pages and tokens are never cached. */
export default defineConfig({
  publicDir: false,
  plugins: [
    tailwindcss(),
    tsConfigPaths(),
    viteReact(),
    {
      name: 'offline-asset-manifest',
      generateBundle(_options, bundle) {
        this.emitFile({
          type: 'asset',
          fileName: 'offline-assets.json',
          source: JSON.stringify({
            assets: [
              '/offline.html',
              ...Object.keys(bundle).map((file) => `/${file}`),
            ],
          }),
        })
      },
    },
  ],
  build: {
    outDir: 'public',
    emptyOutDir: false,
    rolldownOptions: { input: resolve(import.meta.dirname, 'offline.html') },
  },
})
