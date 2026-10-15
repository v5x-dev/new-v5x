import { PlugsIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import { Alert, AlertDescription } from '@v5x/ui/components/alert'
import { Button } from '@v5x/ui/components/button'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@v5x/ui/components/popover'
import { Separator } from '@v5x/ui/components/separator'
import { Spinner } from '@v5x/ui/components/spinner'
import { BRAIN_SLOTS } from '~/lib/ide/brain-upload'

export function BrainUploadPopover({
  isConnected,
  isUploading,
  serialSupported,
  unavailableReason,
  slot,
  onSlotChange,
  message,
  onUpload,
  onDisconnect,
}: {
  isConnected: boolean
  isUploading: boolean
  serialSupported: boolean
  // Empty when the current build can be uploaded.
  unavailableReason: string
  slot: number
  onSlotChange: (slot: number) => void
  message: string
  onUpload: () => void
  onDisconnect: () => void
}) {
  const hint = message || unavailableReason

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Upload to Brain"
            title="Upload to Brain"
          />
        }
      >
        <UploadSimpleIcon />
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-64">
        <PopoverHeader>
          <PopoverTitle className="text-base font-semibold">
            Upload to Brain
          </PopoverTitle>
        </PopoverHeader>
        <p role="status" className="text-xs text-muted-foreground">
          {isConnected ? 'Brain connected' : 'Brain disconnected'}
        </p>
        {!serialSupported && (
          <Alert>
            <AlertDescription>
              Web Serial is unavailable. Use a desktop browser that supports Web
              Serial, such as Chrome or Edge.
            </AlertDescription>
          </Alert>
        )}
        <Separator />
        <div className="grid gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Brain slot
          </p>
          <div
            role="group"
            aria-label="Brain slot"
            className="grid grid-cols-4 gap-1.5"
          >
            {BRAIN_SLOTS.map((entry) => (
              <Button
                key={entry}
                type="button"
                size="xs"
                variant={slot === entry ? 'default' : 'outline'}
                className="w-full"
                aria-pressed={slot === entry}
                disabled={isUploading}
                onClick={() => onSlotChange(entry)}
              >
                {entry}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              aria-label="Upload to Brain"
              title={isUploading ? 'Uploading to Brain' : 'Upload to Brain'}
              onClick={onUpload}
              disabled={!serialSupported || isUploading || !!unavailableReason}
            >
              {isUploading ? <Spinner /> : <UploadSimpleIcon />}
            </Button>
            {isConnected ? (
              <Button
                size="icon"
                variant="ghost"
                aria-label="Disconnect Brain"
                title="Disconnect Brain"
                disabled={isUploading}
                onClick={onDisconnect}
              >
                <PlugsIcon />
              </Button>
            ) : null}
          </div>
          {hint ? (
            <p className="text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
