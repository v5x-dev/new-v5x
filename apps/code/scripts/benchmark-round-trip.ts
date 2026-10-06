import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runCloudFunction as run } from './lib/cloudBenchmarkClient'
import { GitStorage } from '@pierre/storage'
import { templateFiles } from '../convex/template'
import type { ProgramTemplate } from '../convex/template'

// Measure the deployed action, repository sync, and stored artifacts together.
// With CONVEX_DEPLOY_KEY, use a direct HTTP client and exclude CLI startup.
// Without it, the fallback includes Convex CLI startup in every sample.
const output = resolve(
  '../../.build/cloud-round-trip',
  process.argv[2] ?? 'baseline',
)
const samples = Number(process.env.BUILD_BENCH_SAMPLES ?? 3)
const store = new GitStorage({
  name: 'v5x',
  key: process.env.PIERRE_PRIVATE_KEY!,
})
const templates = (Object.keys(templateFiles) as Array<ProgramTemplate>).filter(
  (template) =>
    !process.env.BUILD_BENCH_TEMPLATES ||
    process.env.BUILD_BENCH_TEMPLATES.split(',').includes(template),
)

await mkdir(output, { recursive: true })
const results: Array<Record<string, unknown>> = []
for (const template of templates) {
  const repo = await store.createRepo({ id: `speed-${template}-${Date.now()}` })
  const files = { ...templateFiles[template] }
  let programId: string | undefined
  for (let sample = 0; sample <= samples; sample++) {
    // Change a live instruction so each edit must produce a different binary.
    if (sample) {
      const source = templateFiles[template]['src/main.cpp']
      files['src/main.cpp'] = source.replace(
        /(pros::delay\(|wait\()(\d+)/,
        (_, prefix, value) => `${prefix}${Number(value) + sample}`,
      )
      if (files['src/main.cpp'] === source)
        throw new Error(`No live edit for ${template}`)
    }
    const commit = repo.createCommit({
      targetBranch: repo.defaultBranch,
      commitMessage: `Benchmark ${sample}`,
      author: { name: 'Build benchmark', email: 'benchmark@example.invalid' },
    })
    for (const [path, contents] of Object.entries(files))
      commit.addFileFromString(path, contents)
    const { commitSha } = await commit.send()
    if (!programId)
      programId = await run('program:create', {
        name: `Build benchmark ${template}`,
        repoId: repo.id,
        commitSha,
        template,
      })
    else await run('program:setCurrentCommitSha', { programId, commitSha })
    const started = performance.now()
    const build = await run('programBuild:build', { programId })
    const elapsedMs = Math.round(performance.now() - started)
    results.push({ template, sample, programId, elapsedMs, ...build })
    await writeFile(
      resolve(output, 'results.json'),
      JSON.stringify(results, null, 2) + '\n',
    )
    console.log(
      JSON.stringify({
        template,
        sample,
        elapsedMs,
        exitCode: build.exitCode,
        timings: build.timings,
      }),
    )
    if (build.exitCode !== 0) throw new Error(build.stderr || build.stdout)
    for (const artifact of build.artifacts) {
      const response = await fetch(artifact.url)
      if (!response.ok || (await response.arrayBuffer()).byteLength === 0)
        throw new Error('Missing build artifact')
    }
  }
}
