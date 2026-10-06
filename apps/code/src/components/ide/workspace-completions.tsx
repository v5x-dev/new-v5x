import type { CompletionItem } from 'vscode-languageserver-protocol'
import { Button } from '~/components/ui/button'

interface Props {
  completions: Array<CompletionItem>
  completionIndex: number
  anchor: { left: number; top: number }
  onAccept: (item: CompletionItem) => void
}

export function WorkspaceCompletions({
  completions,
  completionIndex,
  anchor,
  onAccept,
}: Props) {
  return (
    <>
      {completions.length > 0 && (
        <div
          role="listbox"
          aria-label="Completions"
          className="fixed z-50 max-h-72 w-96 overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
          style={anchor}
        >
          {completions.map((item, index) => (
            <Button
              variant="ghost"
              size="sm"
              key={`${item.label}:${index}`}
              role="option"
              aria-selected={index === completionIndex}

              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onAccept(item)}
            >
              {item.label}
              <span className="ml-2 text-muted-foreground">{item.detail}</span>
            </Button>
          ))}
        </div>
      )}
    </>
  )
}
