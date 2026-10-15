import * as React from 'react'
import { V5SerialConnection, V5SerialDevice } from '@v5x/serial'
import { createBrowserAdapter } from '@v5x/serial/browser'
import type { ProjectTemplate } from '@v5x/compiler'
import { createProgramIni, type UploadArtifacts } from '~/lib/ide/brain-upload'

const VEX_USB_VENDOR_ID = 10376

interface BrainConnection {
  device: V5SerialDevice
  serialConnection: V5SerialConnection | null
  onDisconnect: () => void
}

export interface BrainUploadRequest extends UploadArtifacts {
  name: string
  slot: number
  template: ProjectTemplate
}

// Owns the Web Serial connection to one V5 Brain, its status message and
// program uploads. The connection is disposed when the owner unmounts.
export function useBrain() {
  const [device, setDevice] = React.useState<V5SerialDevice | null>(null)
  const [isConnected, setIsConnected] = React.useState(false)
  const [isUploading, setIsUploading] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const connectionRef = React.useRef<BrainConnection | null>(null)

  const markConnected = (next: V5SerialDevice) => {
    setIsConnected(true)
    setDevice(next)
  }

  const markDisconnected = () => {
    setIsConnected(false)
    setDevice(null)
  }

  const dispose = async (target: V5SerialDevice, forgetPort: boolean) => {
    const connection = connectionRef.current
    if (connection?.device !== target) return

    connectionRef.current = null
    markDisconnected()
    connection.serialConnection?.remove('disconnected', connection.onDisconnect)

    const port = target.connection?.port ?? connection.serialConnection?.port

    try {
      await target.dispose()
    } finally {
      if (forgetPort) await port?.forget?.()
    }
  }

  // Reconnects replace the device's serial connection, so the disconnect
  // listener has to follow it.
  const watch = (target: V5SerialDevice) => {
    const connection = connectionRef.current
    if (connection?.device !== target) return

    const serialConnection = target.connection ?? null
    if (connection.serialConnection === serialConnection) return

    connection.serialConnection?.remove('disconnected', connection.onDisconnect)
    connection.serialConnection = serialConnection
    serialConnection?.on('disconnected', connection.onDisconnect)
  }

  const ensureReady = async (target: V5SerialDevice) => {
    if (connectionRef.current?.device !== target)
      throw new Error('The Brain connection is no longer available.')

    const serialConnection = target.connection
    if (
      target.isConnected &&
      serialConnection &&
      (await serialConnection.getSystemStatus(2000)) !== null
    ) {
      watch(target)
      markConnected(target)
      return
    }

    setIsConnected(false)
    setMessage('Reconnecting to Brain')

    // Closing a stale-but-open port releases the Web Serial handle so the
    // device can reopen the already-granted Brain port without another picker.
    await target.disconnect()

    if (!(await target.reconnect(10_000))) {
      // Drop the stale instance without revoking permission. The next upload
      // can ask the user to select a port again if automatic recovery failed.
      await dispose(target, false)
      throw new Error(
        'The Brain is not responding. Check its System Port connection and try again.',
      )
    }

    watch(target)
    markConnected(target)
    setMessage('Brain reconnected')
  }

  const connect = async () => {
    const current = connectionRef.current

    if (current) {
      await ensureReady(current.device)
      return current.device
    }

    const port = await createBrowserAdapter().requestPort({
      filters: [{ usbVendorId: VEX_USB_VENDOR_ID }],
    })

    const adapter = {
      getPorts: () => Promise.resolve([port]),
      requestPort: () => Promise.resolve(port),
    }

    const next = new V5SerialDevice(adapter, { autoRefresh: false })
    const serialConnection = new V5SerialConnection(adapter)
    next.autoReconnect = false

    try {
      if (!(await serialConnection.open(0, false))) {
        throw new Error(
          'Could not open the selected Brain serial port. Close VEXcode or another app using the Brain, then retry.',
        )
      }

      if (!(await next.connect(serialConnection))) {
        throw new Error(
          'The Brain serial port opened, but the Brain did not respond to the V5 handshake.',
        )
      }

      const onDisconnect = () => {
        if (connectionRef.current?.device !== next) return
        markDisconnected()
        setMessage('Brain disconnected; reconnecting before upload')
      }

      connectionRef.current = {
        device: next,
        serialConnection: null,
        onDisconnect,
      }
      watch(next)
      markConnected(next)
    } catch (error) {
      await next.dispose()
      await serialConnection.close()
      throw error
    }

    return next
  }

  const disconnect = async () => {
    const connection = connectionRef.current
    if (!connection) {
      markDisconnected()
      return
    }

    await dispose(connection.device, true)
  }

  const upload = async (request: BrainUploadRequest) => {
    setIsUploading(true)
    setMessage('Connecting to Brain')

    try {
      const target = await connect()

      try {
        const ini = createProgramIni({
          name: request.name,
          slot: request.slot,
          template: request.template,
          pros: !!request.coldBytes,
        })

        const uploaded = await target.brain.uploadProgram(
          ini,
          request.programBytes,
          request.coldBytes,
          (state, current, total) => {
            const percent = total > 0 ? Math.round((current / total) * 100) : 0
            setMessage(`Uploading ${state} ${percent}%`)
          },
        )

        if (uploaded !== true)
          throw new Error('Upload failed. Check the Brain connection.')

        const successMessage = `Uploaded to slot ${request.slot}`
        setMessage(successMessage)

        // Some Brain firmware sessions stop answering after a file transfer
        // even though the USB port remains open. Restore the granted port now
        // so the next upload does not require a manual disconnect/reconnect.
        try {
          await ensureReady(target)
          setMessage(successMessage)
        } catch (error) {
          console.warn(
            'Could not restore the Brain connection after upload:',
            error,
          )
          setMessage(`${successMessage}; reconnect before the next upload`)
        }
      } catch (error) {
        if (!target.isConnected) markDisconnected()
        throw error
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Upload failed')
      console.error('VEX V5 upload failed:', error)
    } finally {
      setIsUploading(false)
    }
  }

  React.useEffect(
    () => () => {
      const connection = connectionRef.current
      connectionRef.current = null
      if (!connection) return

      connection.serialConnection?.remove(
        'disconnected',
        connection.onDisconnect,
      )
      void connection.device.dispose()
    },
    [],
  )

  return {
    device,
    isConnected,
    isUploading,
    message,
    setMessage,
    connect,
    disconnect,
    upload,
  }
}
