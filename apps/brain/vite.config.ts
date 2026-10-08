import { defineConfig } from "vite"
import { svelte } from "@sveltejs/vite-plugin-svelte"

import tailwindcss from "@tailwindcss/vite"

import path from "node:path"

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 5173,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  worker: { format: "es" },
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: {
      "~/": `${path.resolve("src")}/`,
    },
  },
})
