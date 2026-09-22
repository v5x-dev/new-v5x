import { createRouter } from '@tanstack/react-router'
import { notifyManager, QueryClient } from '@tanstack/react-query'
import { ConvexQueryClient } from '@convex-dev/react-query'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  if (typeof document !== 'undefined') {
    notifyManager.setScheduler(window.requestAnimationFrame)
  }

  const convexUrl = (import.meta as any).env.VITE_CONVEX_URL!
  if (!convexUrl) {
    throw new Error('VITE_CONVEX_URL is not set')
  }
  const convexQueryClient = new ConvexQueryClient(convexUrl, {
    expectAuth: true,
  })

  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
      },
    },
  })
  convexQueryClient.connect(queryClient)

  const router = createRouter({
    routeTree,
    defaultPreload: 'intent',
    context: { queryClient, convexQueryClient },
    scrollRestoration: true,
    defaultErrorComponent: ({ error }) => (
      <p>{error instanceof Error ? error.message : String(error)}</p>
    ),
    defaultNotFoundComponent: () => <p>not found</p>,
  })

  setupRouterSsrQueryIntegration({
    router,
    queryClient,
  })

  return router
}
