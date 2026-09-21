import { Button } from "@/components/ui/button"
import { createFileRoute, Link } from "@tanstack/react-router"

export const Route = createFileRoute("/")({ component: App })

function App() {
  return (
    <main className="relative isolate grid min-h-svh overflow-hidden bg-background p-6 text-foreground sm:p-8 lg:p-16">
      <div className="absolute top-6 left-6 z-10 flex items-baseline gap-3 sm:top-8 sm:left-8 lg:top-16 lg:left-16">
        <span className="font-serif text-2xl leading-none font-medium tracking-tighter sm:text-3xl lg:text-4xl">
          code
        </span>
        <span className="font-mono text-sm leading-none font-medium tracking-wide text-muted-foreground lowercase">
          by v5x
        </span>
      </div>

      <div className="relative z-10 w-full max-w-3xl self-center justify-self-center pt-16 pb-12 text-center sm:pt-20">
        <h1 className="shimmer font-serif text-6xl leading-20 font-normal tracking-tighter text-foreground shimmer-color-primary sm:text-7xl lg:text-8xl">
          Build what
          <br />
          moves.
        </h1>
        <Button
          variant="default"
          size="lg"
          nativeButton={false}
          className="mt-10 h-14 rounded-full px-8 text-base"
          render={<Link to="/programs" />}
        >
          Start Building
        </Button>
      </div>

      <div
        className="absolute right-6 bottom-6 grid grid-cols-3 gap-1 sm:right-8 sm:bottom-8 lg:right-16 lg:bottom-16"
        aria-hidden="true"
      >
        <span className="block size-2 rounded-full bg-muted-foreground/50" />
        <span className="block size-2 rounded-full bg-primary" />
        <span className="block size-2 rounded-full bg-muted-foreground/50" />
      </div>
    </main>
  )
}
