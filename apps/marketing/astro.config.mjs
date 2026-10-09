import { defineConfig } from "astro/config"
import icon from "astro-icon"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  site: "https://v5x.dev",
  integrations: [icon()],
  devToolbar: { enabled: false },
  server: {
    host: true,
    port: 4321,
    allowedHosts: true,
  },
  vite: {
    plugins: [tailwindcss()],
    preview: { allowedHosts: true },
    server: { allowedHosts: true },
  },
})
