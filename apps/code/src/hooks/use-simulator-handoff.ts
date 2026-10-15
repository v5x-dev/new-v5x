import * as React from 'react'
import { useAction } from 'convex/react'
import type { SimulatorTemplate } from '@v5x/simulator'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  brainSimulatorUrl,
  createSimulatorHandoffManifest,
  simulatorBinary,
  uploadSimulatorBinary,
} from '~/lib/ide/simulator-handoff'
import type { ProjectSnapshot } from '~/lib/ide/workspace'

interface HandoffRequest {
  template: SimulatorTemplate
  currentCommitSha: string
  snapshot: ProjectSnapshot | undefined
  artifacts: ReadonlyMap<string, Uint8Array>
}

// Sends a verified build of the current commit to the Brain simulator app in
// a new tab.
export function useSimulatorHandoff(programId: Id<'program'>) {
  const createHandoff = useAction(api.simulatorHandoff.create)
  const registerHandoff = useAction(api.simulatorHandoff.register)
  const [isHandingOff, setIsHandingOff] = React.useState(false)
  const [message, setMessage] = React.useState('')

  const run = async (request: HandoffRequest) => {
    let binary: Uint8Array
    try {
      binary = simulatorBinary(request.template, request.artifacts)
    } catch (reason) {
      setMessage(String(reason))
      return
    }

    const { snapshot } = request
    if (!snapshot || snapshot.commitSha !== request.currentCommitSha) {
      setMessage('Build the current committed source first.')
      return
    }

    // Open the tab during the click so pop-up blockers allow it.
    const popup = window.open('about:blank', '_blank')
    if (!popup) {
      setMessage('Allow pop-ups to open the Brain simulator.')
      return
    }

    setIsHandingOff(true)
    setMessage('Preparing a verified simulator handoff')

    try {
      const manifest = await createSimulatorHandoffManifest(
        snapshot,
        binary,
        request.template,
      )

      const transfer = await createHandoff({
        programId,
        expectedCommitSha: manifest.commitSha,
        sourceSha256: manifest.sourceSha256,
        artifactSha256: manifest.artifact.sha256,
        artifactSize: manifest.artifact.size,
      })

      const storageId = await uploadSimulatorBinary(transfer.uploadUrl, binary)

      await registerHandoff({
        programId,
        expectedCommitSha: manifest.commitSha,
        token: transfer.token,
        storageId: storageId as Id<'_storage'>,
      })

      popup.location.replace(
        brainSimulatorUrl(transfer.token, transfer.endpoint),
      )
      setMessage('Verified build sent to the Brain simulator.')
    } catch (reason) {
      popup.close()
      setMessage(
        reason instanceof Error
          ? `Simulator handoff failed: ${reason.message}`
          : 'Simulator handoff failed.',
      )
    } finally {
      setIsHandingOff(false)
    }
  }

  return { isHandingOff, message, run }
}
