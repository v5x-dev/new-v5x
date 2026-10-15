import { definePlugin } from 'nitro'
import { H3Event } from 'nitro/h3'

export default definePlugin((app) => {
  app.hooks.hook('request', (event) => {
    // Explicit compressed URLs are payloads verified and decoded by the
    // compiler. Nitro otherwise infers HTTP Content-Encoding from the suffix.
    // Requests for .wasm and .tar still negotiate their compressed companions.
    if (
      event instanceof H3Event &&
      /^\/(compiler|language)\/.+\.(gz|br)$/.test(event.url.pathname)
    )
      event.res.headers.set('Content-Encoding', 'identity')
  })
})
