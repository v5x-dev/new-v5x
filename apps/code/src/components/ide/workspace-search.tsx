import { XIcon } from '@phosphor-icons/react'
import type { RefObject } from 'react'
import type { searchWorkspace } from '~/lib/ide/workspace'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Toggle } from '~/components/ui/toggle'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from '~/components/ui/sheet'

interface Props {
  searchOpen: boolean
  setSearchOpen: (open: boolean) => void
  searchInputRef: RefObject<HTMLInputElement | null>
  searchQuery: string
  setSearchQuery: (query: string) => void
  matchCase: boolean
  setMatchCase: (match: boolean) => void
  searchResults: ReturnType<typeof searchWorkspace>
  searchGroups: Map<string, ReturnType<typeof searchWorkspace>>
  onSelect: (result: ReturnType<typeof searchWorkspace>[number]) => void
}

export function WorkspaceSearch({
  searchOpen,
  setSearchOpen,
  searchInputRef,
  searchQuery,
  setSearchQuery,
  matchCase,
  setMatchCase,
  searchResults,
  searchGroups,
  onSelect,
}: Props) {
  return (
    <Sheet open={searchOpen} onOpenChange={setSearchOpen}>
      <SheetContent
        side="right"
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
        initialFocus={searchInputRef}
        showCloseButton={false}
      >
        <SheetTitle className="sr-only">Search project</SheetTitle>
        <div className="flex shrink-0 items-center gap-2 border-b p-3">
          <Input
            ref={searchInputRef}
            aria-label="Search workspace"
            placeholder="Search project…"

            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <Toggle
            size="icon"
            aria-label="Match case"
            pressed={matchCase}
            title="Match case"
            onPressedChange={setMatchCase}
          >
            Aa
          </Toggle>
          <SheetClose
            render={<Button variant="ghost" size="icon" />}
            aria-label="Close search"
          >
            <XIcon />
          </SheetClose>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {searchQuery && (
            <p
              role="status"
              className="px-4 py-3 text-xs text-muted-foreground"
            >
              {searchResults.length
                ? `${searchResults.length === 2000 ? 'First ' : ''}${searchResults.length} matches in ${searchGroups.size} files`
                : 'No matches.'}
            </p>
          )}
          {Array.from(searchGroups, ([path, results]) => (
            <div key={path} className="mb-4">
              <div className="sticky top-0 flex items-center gap-3 border-y bg-muted px-4 py-2 font-mono text-xs">
                <span className="truncate">{path}</span>
                <span className="ml-auto text-muted-foreground">
                  {results.length}
                </span>
              </div>
              {results.map((result) => (
                <Button
                  variant="ghost"
                  size="sm"
                  key={`${result.line}:${result.character}`}

                  onClick={() => {
                    onSelect(result)
                  }}
                >
                  <span className="w-10 shrink-0 text-right text-muted-foreground">
                    {result.line + 1}
                  </span>
                  <span className="whitespace-pre-wrap break-all">
                    {result.text.slice(0, result.character)}
                    <mark className="rounded bg-primary/20 text-foreground">
                      {result.text.slice(
                        result.character,
                        result.character + searchQuery.length,
                      )}
                    </mark>
                    {result.text.slice(result.character + searchQuery.length)}
                  </span>
                </Button>
              ))}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
