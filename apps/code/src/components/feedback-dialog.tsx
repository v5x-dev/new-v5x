import * as React from 'react'
import { useMutation } from 'convex/react'
import { ConvexError } from 'convex/values'
import { BugIcon, ChatCircleIcon, LightbulbIcon } from '@phosphor-icons/react'
import { api } from '../../convex/_generated/api'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Textarea } from '~/components/ui/textarea'

export function FeedbackDialog() {
  const submit = useMutation(api.feedback.submit)
  const titleId = React.useId()
  const descriptionId = React.useId()
  const [open, setOpen] = React.useState(false)
  const [kind, setKind] = React.useState<'bug' | 'feature'>('bug')
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [sent, setSent] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const submittingRef = React.useRef(false)

  const send = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingRef.current || !title.trim() || !description.trim()) return
    submittingRef.current = true
    setPending(true)
    setError(null)
    try {
      await submit({
        kind,
        title: title.trim(),
        description: description.trim(),
      })
      setTitle('')
      setDescription('')
      setSent(true)
    } catch (cause) {
      setError(
        cause instanceof ConvexError && typeof cause.data === 'string'
          ? cause.data
          : 'Could not send feedback. Please try again.',
      )
    } finally {
      submittingRef.current = false
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (submittingRef.current) return
        setOpen(nextOpen)
        if (nextOpen) {
          setSent(false)
          setError(null)
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Send feedback"
            title="Send feedback"
          />
        }
      >
        <ChatCircleIcon />
      </DialogTrigger>
      <DialogContent
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg"
        showCloseButton={!pending}
      >
        <DialogHeader>
          <DialogTitle>{sent ? 'Feedback sent' : 'Send feedback'}</DialogTitle>
          <DialogDescription>
            {sent
              ? 'Thanks for helping improve code. Your feedback has been saved for review.'
              : 'Found a bug or have an idea? Tell us about it.'}
          </DialogDescription>
        </DialogHeader>
        {sent ? (
          <DialogFooter>
            <DialogClose render={<Button />}>Done</DialogClose>
          </DialogFooter>
        ) : (
          <form onSubmit={(event) => void send(event)} className="grid gap-4">
            <Tabs
              value={kind}
              onValueChange={(value) => setKind(value as 'bug' | 'feature')}
            >
              <TabsList className="w-full" aria-label="Feedback type">
                <TabsTrigger value="bug" disabled={pending}>
                  <BugIcon /> Bug report
                </TabsTrigger>
                <TabsTrigger value="feature" disabled={pending}>
                  <LightbulbIcon /> Feature request
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="grid gap-2">
              <label htmlFor={titleId} className="text-sm font-medium">
                Title
              </label>
              <Input
                id={titleId}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={
                  kind === 'bug'
                    ? 'What went wrong?'
                    : 'What would you like to add?'
                }
                maxLength={120}
                required
                disabled={pending}
              />
            </div>
            <div className="grid gap-2">
              <label htmlFor={descriptionId} className="text-sm font-medium">
                Description
              </label>
              <Textarea
                id={descriptionId}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={
                  kind === 'bug'
                    ? 'How can we reproduce it? What did you expect, and what happened?'
                    : 'Describe your idea and how it would help you.'
                }
                className="min-h-36 max-h-64"
                maxLength={5000}
                required
                disabled={pending}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              If you signed in with Google, your email is included so we can
              follow up.
            </p>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <DialogClose
                render={<Button variant="outline" disabled={pending} />}
              >
                Cancel
              </DialogClose>
              <Button
                type="submit"
                disabled={pending || !title.trim() || !description.trim()}
              >
                {pending && <Spinner />}
                {pending ? 'Sending...' : 'Send feedback'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
