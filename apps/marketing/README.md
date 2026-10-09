# Marketing site

The Astro site deploys to the Cloudflare Worker `v5x-website` at https://v5x.dev.

From the repository root, run `bun install`, then `bun run --cwd apps/marketing deploy`.
Wrangler builds the site and uploads `dist` as static assets. Run `bunx wrangler login`
first if this machine is not authenticated with Cloudflare.
