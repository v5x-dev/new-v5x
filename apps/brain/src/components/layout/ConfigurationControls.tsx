import { Download, Upload } from "lucide-react"
import { useRef, useState } from "react"
import { Button } from "~/components/ui/button"
import {
  parseConfiguration,
  simulationConfiguration,
} from "~/lib/configuration"
import { installConfiguration, useApp } from "~/lib/stores"
import { ScenarioControls } from "./ScenarioControls"

export function ConfigurationControls() {
  const fileInput = useRef<HTMLInputElement>(null)
  const [error, setError] = useState("")
  const [importing, setImporting] = useState(false)

  function exportConfiguration() {
    const { nodes, edges } = useApp.getState()
    const blob = new Blob(
      [JSON.stringify(simulationConfiguration(nodes, edges), null, 2)],
      { type: "application/json" },
    )
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "wiring.v5x.json"
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function importConfiguration() {
    const input = fileInput.current
    const file = input?.files?.[0]
    if (input) input.value = ""
    if (!file || importing) return
    setImporting(true)
    setError("")
    try {
      if (file.size > 8 * 1024 * 1024)
        throw new Error("Configuration exceeds 8 MiB")
      const configuration = parseConfiguration(await file.text())
      await useApp.getState().session?.stop()
      installConfiguration(configuration)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        title="Export wiring"
        aria-label="Export wiring"
        onClick={exportConfiguration}
      >
        <Download size="16" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title="Import wiring"
        aria-label="Import wiring"
        disabled={importing}
        onClick={() => fileInput.current?.click()}
      >
        <Upload size="16" />
      </Button>
      <ScenarioControls />
      <input
        ref={fileInput}
        type="file"
        accept=".json"
        aria-label="Import wiring file"
        className="hidden"
        onChange={() => void importConfiguration()}
      />
      {error && <p role="alert">{error}</p>}
    </>
  )
}
