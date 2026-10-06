import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'

export const benchmarkIdentity = {
  subject: 'cloud-build-benchmark',
  issuer: 'https://convex.test',
  tokenIdentifier: 'https://convex.test|cloud-build-benchmark',
}
const deployKey = process.env.CONVEX_DEPLOY_KEY
const client = deployKey
  ? new ConvexHttpClient(process.env.VITE_CONVEX_URL!)
  : null
const adminClient = deployKey
  ? new ConvexHttpClient(process.env.VITE_CONVEX_URL!)
  : null
if (deployKey && client && adminClient) {
  // @ts-expect-error The Convex CLI uses this runtime API, omitted from public types.
  client.setAdminAuth(deployKey, benchmarkIdentity)
  // @ts-expect-error The Convex CLI uses this runtime API, omitted from public types.
  adminClient.setAdminAuth(deployKey)
}

export async function runCloudFunction(
  name: string,
  args: Record<string, unknown> = {},
) {
  if (client && adminClient) {
    if (name === 'program:setCurrentCommitSha')
      return adminClient.mutation(makeFunctionReference<'mutation'>(name), args)
    if (name === 'program:create')
      return client.mutation(makeFunctionReference<'mutation'>(name), args)
    return client.action(makeFunctionReference<'action'>(name), args)
  }
  const child = Bun.spawn(
    [
      'bunx',
      'convex',
      'run',
      name,
      JSON.stringify(args),
      ...(name === 'program:setCurrentCommitSha'
        ? []
        : ['--identity', JSON.stringify(benchmarkIdentity)]),
      '--typecheck',
      'disable',
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0 || stderr.includes('Failed to run function'))
    throw new Error(`${name}: ${stderr}`)
  for (const line of stderr
    .split('\n')
    .filter((line) => line.includes('[WARN]')))
    console.warn(line)
  return stdout.trim() ? JSON.parse(stdout) : null
}
