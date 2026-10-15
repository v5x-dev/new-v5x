import { Alert, AlertDescription } from '@v5x/ui/components/alert'
import { Skeleton } from '@v5x/ui/components/skeleton'
import {
  ArchiveIcon,
  MagnifyingGlassIcon,
  SortAscendingIcon,
  StarIcon,
  XIcon,
} from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Button } from '@v5x/ui/components/button'
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from '@v5x/ui/components/input-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@v5x/ui/components/dropdown-menu'
import { Kbd } from '@v5x/ui/components/kbd'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@v5x/ui/components/tooltip'
import { cn } from '~/lib/utils'
import { Link } from '@tanstack/react-router'
import { useAction, useMutation, usePaginatedQuery } from 'convex/react'
import { ConvexError } from 'convex/values'
import { api } from '../../../convex/_generated/api'
import type { Doc } from '../../../convex/_generated/dataModel'
import { authClient } from '~/lib/auth-client'
import { AccountMenu } from '~/components/account-menu'
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@v5x/ui/components/empty'
import { templateInfo, templates, type Template } from './templates'
import { TemplateIcon } from './template-icon'
import { ImportProject } from './import-project'
import { ProgramActions } from './program-actions'

type Sort = 'created' | 'name'
type ProgramQuery = {
  archived: boolean
  search: string
  sort: Sort
  starredOnly: boolean
}
type ProgramSnapshot = ProgramQuery & { programs: Doc<'program'>[] }
type ProgramArchiveCache = Omit<ProgramQuery, 'archived'> & {
  results: Partial<Record<'active' | 'archived', Doc<'program'>[]>>
}

const DAY = 24 * 60 * 60 * 1000
const groupTitles = ['Today', 'Previous 7 days', 'Earlier'] as const

function groupOf(program: Doc<'program'>) {
  const age = Date.now() - program._creationTime
  if (age < DAY) return 0
  if (age < 7 * DAY) return 1
  return 2
}

function isEditable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

export function Dashboard() {
  const [sort, setSort] = useState<Sort>('created')
  const [starredOnly, setStarredOnly] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const { data: session } = authClient.useSession()
  const migratingStars = useRef(new Set<string>())
  const setStarred = useMutation(api.program.setStarred)
  const createProgram = useAction(api.program.createProgram)
  const [archived, setArchived] = useState(false)
  const queryArgs = { archived, search: query.trim(), sort, starredOnly }
  const lastLoadedQuery = useRef<ProgramSnapshot | null>(null)
  const archiveCache = useRef<ProgramArchiveCache | null>(null)
  const {
    results: programs,
    status,
    loadMore,
  } = usePaginatedQuery(api.program.listPaginated, queryArgs, {
    initialNumItems: 50,
  })
  const isPending = status === 'LoadingFirstPage'
  const previousQuery = lastLoadedQuery.current
  const isArchiveTransition =
    isPending &&
    previousQuery !== null &&
    previousQuery.archived !== archived &&
    previousQuery.search === queryArgs.search &&
    previousQuery.sort === sort &&
    previousQuery.starredOnly === starredOnly
  const cachedArchiveResults = archiveCache.current
  const hasMatchingArchiveCache =
    cachedArchiveResults !== null &&
    cachedArchiveResults.search === queryArgs.search &&
    cachedArchiveResults.sort === sort &&
    cachedArchiveResults.starredOnly === starredOnly
  const visible =
    isArchiveTransition && previousQuery !== null
      ? ((hasMatchingArchiveCache
          ? cachedArchiveResults.results[archived ? 'archived' : 'active']
          : undefined) ?? previousQuery.programs)
      : programs
  const [creating, setCreating] = useState<Template | null>(null)
  const creatingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const starred = useMemo(
    () =>
      new Set(
        visible
          .filter((program) => program.starred)
          .map((program) => program._id),
      ),
    [visible],
  )

  useEffect(() => {
    if (isPending) return

    lastLoadedQuery.current = { ...queryArgs, programs }
    const previousCache = archiveCache.current
    const matchesFilters =
      previousCache !== null &&
      previousCache.search === queryArgs.search &&
      previousCache.sort === sort &&
      previousCache.starredOnly === starredOnly
    archiveCache.current = {
      search: queryArgs.search,
      sort,
      starredOnly,
      results: {
        ...(matchesFilters ? previousCache.results : {}),
        [archived ? 'archived' : 'active']: programs,
      },
    }
  }, [archived, isPending, programs, queryArgs.search, sort, starredOnly])

  useEffect(() => {
    if (!session?.user) return
    const key = `v5x:starred-programs:${session.user.id}`
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) || '[]')
      if (!Array.isArray(saved)) return
      for (const program of programs) {
        if (
          !saved.includes(program._id) ||
          migratingStars.current.has(program._id)
        )
          continue
        migratingStars.current.add(program._id)
        void setStarred({ programId: program._id, starred: true })
          .then(() => {
            // Read again so concurrent migrations preserve each other's removals.
            const current: unknown = JSON.parse(
              localStorage.getItem(key) || '[]',
            )
            if (Array.isArray(current))
              localStorage.setItem(
                key,
                JSON.stringify(current.filter((id) => id !== program._id)),
              )
          })
          .catch(() =>
            setError('Unable to sync saved stars. Reload to try again.'),
          )
      }
    } catch {
      setError('Unable to read previously saved stars.')
    }
  }, [programs, session?.user, setStarred])

  async function create(template: Template) {
    if (creatingRef.current) return
    creatingRef.current = true
    setCreating(template)
    setError(null)
    try {
      await createProgram({ template })
    } catch (reason) {
      setError(
        reason instanceof ConvexError && typeof reason.data === 'string'
          ? reason.data
          : 'Unable to create program. Try again.',
      )
    } finally {
      creatingRef.current = false
      setCreating(null)
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey) return
      if (isEditable(event.target)) return

      event.preventDefault()
      searchRef.current?.focus()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  async function toggleStar(program: Doc<'program'>) {
    try {
      await setStarred({ programId: program._id, starred: !program.starred })
    } catch {
      setError('Unable to save the star. Try again.')
    }
  }

  useEffect(() => {
    if (status === 'CanLoadMore' && programs.length === 0) loadMore(50)
  }, [status, programs.length, loadMore])

  const pinned = visible.filter((p) => starred.has(p._id))
  const rest = visible.filter((p) => !starred.has(p._id))

  // Name sorting is flat; recency sorting is grouped under date headings.
  const groups = [
    { title: 'Starred', items: pinned },
    ...(sort === 'created'
      ? groupTitles.map((title, index) => ({
          title,
          items: rest.filter((p) => groupOf(p) === index),
        }))
      : [{ title: 'All programs', items: rest }]),
  ].filter((group) => group.items.length > 0)

  return (
    <TooltipProvider delay={300}>
      <div className="min-h-dvh">
        <header className="flex h-12 items-center gap-4 border-b px-6">
          <img src="/favicon.svg" alt="code" className="size-6" />
          <InputGroup className="mx-auto max-w-xl">
            <InputGroupAddon>
              <MagnifyingGlassIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              ref={searchRef}
              aria-label="Search programs"
              aria-keyshortcuts="/"
              placeholder="Search programs"
              value={query}
              maxLength={120}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setQuery('')
                  event.currentTarget.blur()
                }
              }}
            />
            <InputGroupAddon align="inline-end">
              {query ? (
                <InputGroupButton
                  size="icon-xs"
                  aria-label="Clear search"
                  onClick={() => setQuery('')}
                >
                  <XIcon aria-hidden="true" />
                </InputGroupButton>
              ) : (
                <Kbd aria-hidden="true">/</Kbd>
              )}
            </InputGroupAddon>
          </InputGroup>
          <AccountMenu onError={setError} />
        </header>

        <TemplateStrip
          creating={creating}
          onCreate={(template) => void create(template)}
        />

        <main className="mx-auto max-w-4xl px-6 py-6" aria-busy={isPending}>
          <Toolbar
            sort={sort}
            onSortChange={setSort}
            starredOnly={starredOnly}
            onStarredOnlyChange={setStarredOnly}
            archived={archived}
            onArchivedChange={setArchived}
          />
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {isPending && !isArchiveTransition ? (
            <div
              role="status"
              aria-label="Loading programs"
              className="flex flex-col gap-3"
            >
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : visible.length === 0 && status !== 'Exhausted' ? (
            <p role="status" className="text-sm text-muted-foreground">
              Searching programs...
            </p>
          ) : visible.length === 0 ? (
            <EmptyState query={query} starredOnly={starredOnly} />
          ) : (
            groups.map((group) => (
              <section key={group.title} className="mb-8">
                <h2 className="mb-3 text-sm font-medium text-muted-foreground">
                  {group.title}
                </h2>
                <ul className="flex flex-col">
                  {group.items.map((program) => (
                    <li key={program._id}>
                      <ProgramRow
                        program={program}
                        onError={setError}
                        starred={starred.has(program._id)}
                        onToggleStar={() => void toggleStar(program)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
          {(status === 'CanLoadMore' || status === 'LoadingMore') && (
            <Button
              variant="outline"
              disabled={status === 'LoadingMore'}
              onClick={() => loadMore(50)}
            >
              {status === 'LoadingMore' ? 'Loading...' : 'Load more programs'}
            </Button>
          )}
        </main>
      </div>
    </TooltipProvider>
  )
}

function TemplateStrip({
  creating,
  onCreate,
}: {
  creating: Template | null
  onCreate: (template: Template) => void
}) {
  return (
    <section className="border-b bg-card/75 py-6">
      <div className="mx-auto max-w-5xl px-6">
        <h1 className="mb-4 text-base font-medium">Create a new program</h1>
        <ul className="grid grid-cols-2 gap-5 md:grid-cols-5">
          {templates.map((template) => (
            <li key={template}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={templateInfo[template].label}
                      disabled={creating !== null}
                      onClick={() => onCreate(template)}
                      className="group flex w-full flex-col gap-2 text-left active:scale-[0.98]"
                    />
                  }
                >
                  <span
                    style={
                      {
                        '--template': templateInfo[template].color,
                      } as CSSProperties
                    }
                    className="grid h-32 place-items-center rounded-lg border transition-colors border-(--template)/25 group-hover:border-(--template)/50 bg-(--template)/10 group-hover:bg-(--template)/20"
                  >
                    <TemplateIcon
                      template={template}
                      className="size-12"
                      decorative
                    />
                  </span>
                  <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                    {creating === template
                      ? 'Creating...'
                      : templateInfo[template].label}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {templateInfo[template].blurb}
                </TooltipContent>
              </Tooltip>
            </li>
          ))}
          <li>
            <ImportProject disabled={creating !== null} />
          </li>
        </ul>
      </div>
    </section>
  )
}

function Toolbar({
  sort,
  onSortChange,
  starredOnly,
  onStarredOnlyChange,
  archived,
  onArchivedChange,
}: {
  sort: Sort
  onSortChange: (sort: Sort) => void
  starredOnly: boolean
  onStarredOnlyChange: (value: boolean) => void
  archived: boolean
  onArchivedChange: (value: boolean) => void
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <h2 className="mr-auto text-base font-medium max-sm:w-full">
        Your programs
      </h2>

      <Button
        variant={archived ? 'secondary' : 'outline'}
        aria-pressed={archived}
        onClick={() => onArchivedChange(!archived)}
      >
        <ArchiveIcon aria-hidden="true" data-icon="inline-start" />
        Archived
      </Button>

      <Button
        variant={starredOnly ? 'secondary' : 'outline'}
        aria-pressed={starredOnly}
        onClick={() => onStarredOnlyChange(!starredOnly)}
      >
        <StarIcon
          aria-hidden="true"
          weight={starredOnly ? 'fill' : 'regular'}
        />
        Starred
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" />}>
          <SortAscendingIcon aria-hidden="true" />
          {sort === 'created' ? 'Newest' : 'Name'}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={sort}
            onValueChange={(value) => onSortChange(value as Sort)}
          >
            <DropdownMenuRadioItem value="created">
              Newest
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// The name link stretches over the whole row; controls sit above it with z-10.
function ProgramRow({
  program,
  starred,
  onToggleStar,
  onError,
}: {
  program: Doc<'program'>
  starred: boolean
  onToggleStar: () => void
  onError: (message: string | null) => void
}) {
  return (
    <div className="group/row relative flex items-center gap-4 rounded-lg px-3 py-1.5 hover:bg-muted/60 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring">
      <TemplateIcon template={program.template} />
      {program.deleting ? (
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {program.name} · deletion pending
        </span>
      ) : (
        <Link
          to="/p/$programId"
          params={{ programId: program._id }}
          className="min-w-0 flex-1 truncate text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-lg"
        >
          {program.name}
        </Link>
      )}
      <span className="w-28 shrink-0 text-right text-sm text-muted-foreground max-sm:w-auto">
        <time
          dateTime={new Date(program._creationTime).toISOString()}
          title="Created"
        >
          {new Date(program._creationTime).toLocaleDateString()}
        </time>
      </span>
      <div className="relative z-10 flex items-center">
        <ProgramActions program={program} onError={onError} />
        {!program.deleting && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={starred ? 'Unstar program' : 'Star program'}
            aria-pressed={starred}
            onClick={onToggleStar}
            className={cn(!starred && 'text-muted-foreground')}
          >
            <StarIcon
              weight={starred ? 'fill' : 'regular'}
              className={cn(starred && 'text-primary')}
            />
          </Button>
        )}
      </div>
    </div>
  )
}

function EmptyState({
  query,
  starredOnly,
}: {
  query: string
  starredOnly: boolean
}) {
  return (
    <Empty className="border py-12">
      <EmptyHeader>
        <EmptyTitle>
          {query
            ? `Nothing matches "${query}"`
            : starredOnly
              ? 'No starred programs yet'
              : 'No programs yet'}
        </EmptyTitle>
        <EmptyDescription>
          {query
            ? 'Try a shorter name, or start a new program above.'
            : starredOnly
              ? 'Star a program to pin it here.'
              : 'Pick a template above to start your first program.'}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
