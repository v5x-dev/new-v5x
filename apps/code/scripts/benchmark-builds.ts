import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { Machine } from 'smolmachines'
import { prepareBuildSdk } from '../convex/lib/buildSdk'
import { initializeTemplate } from '../convex/template'
import type { ProgramTemplate } from '../convex/template'

const execFileAsync = promisify(execFile)
const root = join(import.meta.dir, '../../../.build/code-build-benchmark')
const projectsRoot = join(root, 'cloud-build-projects')
const archivesRoot = join(root, 'cloud-build-archives')
const resultsPath = join(root, 'cloud-build-benchmark.json')
const templates: Array<ProgramTemplate> = [
  'vexcode',
  'pros',
  'ez-template',
  'jar-template',
]
const samples = Number(process.env.BUILD_BENCH_SAMPLES ?? 3)

type Timing = Record<string, number>
type Result = {
  template: ProgramTemplate
  sample: number
  exitCode: number
  timings: Timing
  binFiles: Array<string>
  output?: string
}

async function prepareProject(template: ProgramTemplate) {
  const output = join(projectsRoot, template)
  const writes: Array<Promise<void>> = []
  const repoStub = {
    defaultBranch: 'main',
    createCommit: () => ({
      addFileFromString(path: string, contents: string) {
        const destination = join(output, path)
        writes.push(
          mkdir(join(destination, '..'), { recursive: true }).then(() =>
            writeFile(destination, contents),
          ),
        )
      },
      send: () => Promise.resolve(null),
    }),
  }

  await rm(output, { recursive: true, force: true })
  await initializeTemplate(repoStub as never, template, {
    name: 'Cloud build benchmark',
    email: 'benchmark@example.invalid',
  })
  await Promise.all(writes)
  const archive = join(archivesRoot, `${template}.tar.gz`)
  await execFileAsync('tar', ['-czf', archive, '-C', output, '.'])
  return archive
}

async function timed<T>(timings: Timing, name: string, work: () => Promise<T>) {
  const started = performance.now()
  try {
    return await work()
  } finally {
    timings[name] = Math.round(performance.now() - started)
  }
}

async function run(
  template: ProgramTemplate,
  sample: number,
  archivePath: string,
): Promise<Result> {
  const token = process.env.SMOL_CLOUD_TOKEN
  if (!token) throw new Error('SMOL_CLOUD_TOKEN is missing')
  const cloudUrl = (
    process.env.SMOL_CLOUD_URL ?? 'https://api.smolmachines.com'
  ).replace(/\/+$/, '')
  const accountResponse = await fetch(`${cloudUrl}/v1/me`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!accountResponse.ok)
    throw new Error(
      `Smol Cloud account lookup failed: ${accountResponse.status}`,
    )
  const account: unknown = await accountResponse.json()
  const namespace =
    typeof account === 'object' &&
    account !== null &&
    'registryNamespace' in account &&
    typeof account.registryNamespace === 'string'
      ? account.registryNamespace
      : null
  if (!namespace?.startsWith('tenants/'))
    throw new Error('Smol account has no registry namespace')

  const imageTag = process.env.VEXCODE_IMAGE_TAG || 'build-fast-v1'
  const machineImage = `registry.smolmachines.com/${namespace}/vexcode:${imageTag}`
  const connection = {
    target: 'cloud' as const,
    apiKey: token,
    baseUrl: cloudUrl,
  }
  const timings: Timing = {}
  const totalStarted = performance.now()
  let machine: Machine | null = null
  let exitCode = 1
  let binFiles: Array<string> = []
  let output = ''

  try {
    machine = await timed(timings, 'start_machine', () =>
      Machine.create(
        {
          image: machineImage,
          resources: { cpus: 8, memoryMb: 4096, network: true },
          ttlSeconds: 900,
          branchable: true,
        },
        connection,
      ),
    )

    const archive = await readFile(archivePath)
    await timed(timings, 'stage_project', async () => {
      const mkdirResult = await machine!.exec(['mkdir', '-p', '/workspace'])
      if (mkdirResult.exitCode !== 0)
        throw new Error(
          mkdirResult.stderr || 'Could not create build workspace',
        )
      await machine!.writeFile('/tmp/project.tar.gz', archive)
      const unpack = await machine!.exec(
        ['tar', '-xzf', '/tmp/project.tar.gz', '-C', '/workspace'],
        { timeout: 60 },
      )
      if (unpack.exitCode !== 0)
        throw new Error(unpack.stderr || 'Could not unpack template')
    })

    if (template === 'pros' || template === 'ez-template') {
      const script = prepareBuildSdk
      const setup = await timed(timings, 'prepare_sdk', () =>
        machine!.exec(['sh', '-lc', script], {
          workdir: '/workspace',
          timeout: 240,
        }),
      )
      output += setup.stdout + setup.stderr
      if (setup.exitCode !== 0) {
        exitCode = setup.exitCode
        throw new Error(
          `SDK setup failed for ${template}: ${setup.stderr || setup.stdout}`,
        )
      }
    }

    const compile = await timed(timings, 'compile', () =>
      machine!.exec(['make', '-j8', 'P=workspace'], {
        workdir: '/workspace',
        env: { VEX_SDK_PATH: '/sdk' },
        timeout: 300,
      }),
    )
    output += compile.stdout + compile.stderr
    exitCode = compile.exitCode
    if (compile.exitCode !== 0)
      throw new Error(
        `Compile failed for ${template}: ${compile.stderr || compile.stdout}`,
      )

    const binaries = await timed(timings, 'find_outputs', () =>
      machine!.exec(
        [
          'find',
          '.',
          '-type',
          'f',
          '-name',
          '*.bin',
          '-not',
          '-path',
          './.git/*',
        ],
        { workdir: '/workspace', timeout: 30 },
      ),
    )
    if (binaries.exitCode === 0) {
      binFiles = binaries.stdout
        .split(/\r?\n/)
        .filter(
          (path) =>
            (path.startsWith('./build/') || path.startsWith('./bin/')) &&
            path.endsWith('.bin') &&
            !path.split('/').some((part) => part === '..'),
        )
        .map((path) => path.slice(2))
        .slice(0, 100)
    }
    await timed(timings, 'read_artifacts', async () => {
      for (const path of binFiles) await machine!.readFile(`/workspace/${path}`)
    })
  } catch (error) {
    output += String(error)
    if (exitCode === 0) exitCode = 1
    console.error(`${template} sample ${sample} failed: ${String(error)}`)
  } finally {
    timings.total_to_artifacts = Math.round(performance.now() - totalStarted)
    if (machine) {
      try {
        await machine.delete()
      } catch (error) {
        console.error(
          `${template} sample ${sample}: VM cleanup failed: ${String(error)}`,
        )
      }
    }
  }

  return {
    template,
    sample,
    exitCode,
    timings,
    binFiles,
    ...(exitCode === 0 ? {} : { output }),
  }
}

await rm(projectsRoot, { recursive: true, force: true })
await rm(archivesRoot, { recursive: true, force: true })
await mkdir(archivesRoot, { recursive: true })
const archives = new Map<ProgramTemplate, string>()
for (const template of templates)
  archives.set(template, await prepareProject(template))

const results: Array<Result> = []
for (let sample = 1; sample <= samples; sample++) {
  const offset = sample - 1
  const order = templates.map(
    (_, index) => templates[(index + offset) % templates.length],
  )
  for (const template of order) {
    console.log(`Starting ${template} sample ${sample}/${samples}`)
    const result = await run(template, sample, archives.get(template)!)
    results.push(result)
    console.log(JSON.stringify(result))
    await writeFile(
      resultsPath,
      JSON.stringify(
        {
          imageTag: process.env.VEXCODE_IMAGE_TAG || 'build-fast-v1',
          samples,
          results,
        },
        null,
        2,
      ) + '\n',
    )
    if (result.exitCode !== 0) process.exitCode = 1
  }
}

console.log('\nSUMMARY (median [min, max], milliseconds)')
for (const template of templates) {
  const group = results.filter((result) => result.template === template)
  const fields = [
    'start_machine',
    'stage_project',
    'prepare_sdk',
    'compile',
    'find_outputs',
    'read_artifacts',
    'total_to_artifacts',
  ]
  const row: Array<string> = []
  for (const field of fields) {
    const values = group
      .map((result) => result.timings[field])
      .filter((value): value is number => typeof value === 'number')
      .sort((a, b) => a - b)
    if (!values.length) continue
    const median = values[Math.floor(values.length / 2)]
    row.push(`${field}=${median} [${values[0]}, ${values.at(-1)}]`)
  }
  console.log(
    `${template}: ${row.join('  ')}  bins=${group.map((result) => result.binFiles.length).join(',')}`,
  )
}
