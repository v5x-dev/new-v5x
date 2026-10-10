import {
  MagnifyingGlassIcon,
  SortAscendingIcon,
  StarIcon,
  XIcon,
} from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Button } from '~/components/ui/button'
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from '~/components/ui/input-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Kbd } from '~/components/ui/kbd'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '~/components/ui/tooltip'
import { cn } from '~/lib/utils'
import { Link } from '@tanstack/react-router'
import { useAction } from 'convex/react'
import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '../../../convex/_generated/api'
import type { Doc } from '../../../convex/_generated/dataModel'
import { authClient } from '~/lib/auth-client'
import { AccountMenu } from '~/components/account-menu'
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '~/components/ui/empty'
import { Skeleton } from '~/components/ui/skeleton'
import { templateInfo, templates, type Template } from './templates'
import { TemplateIcon } from './template-icon'

type Sort = 'created' | 'name'

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
  const [starred, setStarred] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const { data: session } = authClient.useSession()
  const user = session?.user
  const createProgram = useAction(api.program.createProgram)
  const {
    data: programs,
    isPending,
    error: loadError,
  } = useQuery(convexQuery(api.program.list))
  const [creating, setCreating] = useState<Template | null>(null)
  const creatingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const starKey = user ? `v5x:starred-programs:${user.id}` : null

  useEffect(() => {
    if (!starKey) return
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(starKey) || '[]')
      setStarred(
        new Set(
          Array.isArray(saved)
            ? saved.filter((id): id is string => typeof id === 'string')
            : [],
        ),
      )
    } catch {
      setStarred(new Set())
    }
  }, [starKey])

  async function create(template: Template) {
    if (creatingRef.current) return
    creatingRef.current = true
    setCreating(template)
    setError(null)
    try {
      await createProgram({ template })
    } catch {
      setError('Unable to create program. Try again.')
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

  function toggleStar(id: string) {
    const next = new Set(starred)
    if (!next.delete(id)) next.add(id)
    setStarred(next)
    if (starKey) {
      try {
        localStorage.setItem(starKey, JSON.stringify([...next]))
      } catch {
        // Stars remain available for this session if storage is unavailable.
      }
    }
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()

    return [...(programs ?? [])]
      .filter((p) => p.name.toLowerCase().includes(needle))
      .filter((p) => !starredOnly || starred.has(p._id))
      .sort((a, b) =>
        sort === 'name'
          ? a.name.localeCompare(b.name)
          : b._creationTime - a._creationTime,
      )
  }, [programs, query, starredOnly, starred, sort])

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

        <main className="mx-auto max-w-4xl px-6 py-6">
          <Toolbar
            sort={sort}
            onSortChange={setSort}
            starredOnly={starredOnly}
            onStarredOnlyChange={setStarredOnly}
          />

          {(error || loadError) && (
            <p role="alert" className="mb-4 text-sm text-destructive">
              {error || 'Unable to load programs. Try reloading the page.'}
            </p>
          )}
          {isPending ? (
            <div
              role="status"
              aria-label="Loading programs"
              className="flex flex-col gap-3"
            >
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : loadError ? null : visible.length === 0 ? (
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
                        starred={starred.has(program._id)}
                        onToggleStar={() => toggleStar(program._id)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))
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
        <ul className="grid grid-cols-2 gap-5 md:grid-cols-4">
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
}: {
  sort: Sort
  onSortChange: (sort: Sort) => void
  starredOnly: boolean
  onStarredOnlyChange: (value: boolean) => void
}) {
  return (
    <div className="mb-5 flex items-center gap-2">
      <h2 className="mr-auto text-base font-medium">Your programs</h2>

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
}: {
  program: Doc<'program'>
  starred: boolean
  onToggleStar: () => void
}) {
  return (
    <div className="group/row relative flex items-center gap-4 rounded-lg px-3 py-1.5 hover:bg-muted/60 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring">
      <TemplateIcon template={program.template} />
      <Link
        to="/p/$programId"
        params={{ programId: program._id }}
        className="min-w-0 flex-1 truncate text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-lg"
      >
        {program.name}
      </Link>
      <span className="w-28 shrink-0 text-right text-sm text-muted-foreground max-sm:w-auto">
        <time
          dateTime={new Date(program._creationTime).toISOString()}
          title="Created"
        >
          {new Date(program._creationTime).toLocaleDateString()}
        </time>
      </span>
      <div className="relative z-10 flex items-center">
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
