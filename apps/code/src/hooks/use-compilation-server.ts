import * as React from 'react'
import { releaseBrowserCompiler } from '@v5x/compiler'
import { compilationServerStorageKey } from '~/components/ide/compilation-server-dialog'
import { readStorage, writeStorage } from '~/lib/browser-storage'

// An empty endpoint means builds and language features run in the browser.
// `loaded` stays false until the saved choice has been read on the client.
export function useCompilationServer() {
  const [endpoint, setEndpoint] = React.useState('')
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    setEndpoint(readStorage(compilationServerStorageKey) ?? '')
    setLoaded(true)
  }, [])

  const connect = React.useCallback((next: string) => {
    setEndpoint(next)
    releaseBrowserCompiler()
    writeStorage(compilationServerStorageKey, next || null)
  }, [])

  return { endpoint, loaded, connect }
}
