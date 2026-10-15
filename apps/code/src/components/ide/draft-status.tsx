import { DownloadSimpleIcon } from '@phosphor-icons/react'
import { Button } from '~/components/ui/button'
import { downloadDraftRecovery } from '~/lib/draft-recovery'
import type { DraftStatus as Status } from '~/lib/ide/draft-writer'

const describeStatus = (status: Status, dirty: boolean) =>
  status === 'error'
    ? 'Draft not saved locally'
    : status === 'saving'
      ? 'Saving draft…'
      : dirty
        ? 'Draft saved locally · Not committed'
        : 'Committed'

// Announces local draft and commit state. When drafts cannot be stored, it
// offers a recovery copy of the current files instead.
export function DraftStatus({
  status,
  error,
  dirty,
  files,
}: {
  status: Status
  error: string | undefined
  dirty: boolean
  files: () => Record<string, string>
}) {
  return (
    <>
      <span className="sr-only" role="status" title={error}>
        {describeStatus(status, dirty)}
      </span>
      {status === 'error' && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Download recovery copy"
          title="Download recovery copy"
          onClick={() => downloadDraftRecovery(files())}
        >
          <DownloadSimpleIcon />
        </Button>
      )}
    </>
  )
}
