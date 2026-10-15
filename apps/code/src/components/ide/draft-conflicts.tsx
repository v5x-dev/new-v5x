import { Button } from '~/components/ui/button'

// Files whose recovered local draft conflicts with a newer remote commit.
export function DraftConflicts({
  conflicts,
  onReview,
  onKeepDraft,
  onUseIncoming,
}: {
  conflicts: Array<string>
  onReview: (path: string) => void
  onKeepDraft: (path: string) => void
  onUseIncoming: (path: string) => void
}) {
  return conflicts.map((path) => (
    <div
      key={path}
      role="alert"
      className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs"
    >
      <span>
        {path} changed remotely. Your draft is preserved. Review it before
        committing.
      </span>
      <Button variant="ghost" size="sm" onClick={() => onReview(path)}>
        Review draft
      </Button>
      <Button variant="ghost" size="sm" onClick={() => onKeepDraft(path)}>
        Keep draft
      </Button>
      <Button variant="ghost" size="sm" onClick={() => onUseIncoming(path)}>
        Use incoming
      </Button>
    </div>
  ))
}
