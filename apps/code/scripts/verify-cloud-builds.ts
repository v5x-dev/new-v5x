import { createHash, randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { GitStorage } from '@pierre/storage'
import { templateFiles } from '../convex/template'
import { runCloudFunction as run } from './lib/cloudBenchmarkClient'
import type { ProgramTemplate } from '../convex/template'

const store = new GitStorage({
  name: 'v5x',
  key: process.env.PIERRE_PRIVATE_KEY!,
})
const results: Array<Record<string, unknown>> = []
await mkdir('../../.build/cloud-round-trip/verification', { recursive: true })
for (const template of Object.keys(templateFiles) as Array<ProgramTemplate>) {
  const repo = await store.createRepo({
    id: `verify-${template}-${Date.now()}`,
  })
  const original = templateFiles[template]['src/main.cpp']
  const files = { ...templateFiles[template] }
  const deleted = new Set<string>()
  let programId: string | undefined
  const build = async (label: string, succeeds = true) => {
    const commit = repo.createCommit({
      targetBranch: repo.defaultBranch,
      commitMessage: label,
      author: {
        name: 'Build verification',
        email: 'benchmark@example.invalid',
      },
    })
    for (const [path, contents] of Object.entries(files))
      commit.addFileFromString(path, contents)
    for (const path of deleted) commit.deletePath(path)
    const { commitSha } = await commit.send()
    if (!programId)
      programId = await run('program:create', {
        repoId: repo.id,
        name: `Build verification ${template}`,
        commitSha,
        template,
      })
    else await run('program:setCurrentCommitSha', { programId, commitSha })
    const start = performance.now()
    const result = await run('programBuild:build', { programId })
    if ((result.exitCode === 0) !== succeeds)
      throw new Error(
        `${template} ${label}: ${result.stdout}\n${result.stderr}`,
      )
    if (!succeeds && result.artifacts.length)
      throw new Error('Failed build returned artifacts')
    let digest = ''
    for (const artifact of result.artifacts) {
      const response = await fetch(artifact.url)
      if (!response.ok) throw new Error('Artifact unavailable')
      const bytes = await response.arrayBuffer()
      if (!bytes.byteLength) throw new Error('Artifact empty')
      if (!artifact.path.includes('cold.package'))
        digest = createHash('sha256')
          .update(new Uint8Array(bytes))
          .digest('hex')
    }
    results.push({
      template,
      label,
      programId,
      elapsedMs: Math.round(performance.now() - start),
      ...result,
    })
    await writeFile(
      '../../.build/cloud-round-trip/verification/results.json',
      JSON.stringify(results, null, 2) + '\n',
    )
    console.log(`${template}: ${label} passed`)
    return digest
  }
  await build('initial')
  files['include/benchmark.h'] = '#define BUILD_TEST_DELAY 37\n'
  files['src/main.cpp'] = original
    .replace('\n', '\n#include "benchmark.h"\n')
    .replace(/(pros::delay\(|wait\()\d+/, '$1BUILD_TEST_DELAY')
  const beforeHeaderEdit = await build('add header')
  files['include/benchmark.h'] = '#define BUILD_TEST_DELAY 38\n'
  const afterHeaderEdit = await build('header-only edit')
  if (beforeHeaderEdit === afterHeaderEdit)
    throw new Error('Header edit reused stale binary')
  delete files['include/benchmark.h']
  deleted.add('include/benchmark.h')
  await build('delete included header', false)
  files['src/main.cpp'] = original
  await build('recover after header deletion')
  files['src/benchmark.cpp'] = 'int build_test_delay() { return 39; }\n'
  files['src/main.cpp'] = original
    .replace('\n', '\nint build_test_delay();\n')
    .replace(/(pros::delay\(|wait\()\d+/, '$1build_test_delay()')
  await build('add source')
  delete files['src/benchmark.cpp']
  deleted.add('src/benchmark.cpp')
  await build('delete referenced source', false)
  files['src/main.cpp'] = original
  await build('recover after source deletion')
  const makefile = files.Makefile ? 'Makefile' : 'makefile'
  files[makefile] +=
    `\n${files.Makefile ? 'EXTRA_CXXFLAGS' : 'CXX_FLAGS'} += -DBUILD_TEST_FLAG=1\n`
  await build('change build flags')
  files['src/main.cpp'] += '\n#error Build verification error\n'
  await build('compiler error', false)
  files['src/main.cpp'] = original
  await build('recover after compiler error')
  if (template === 'vexcode') {
    // A pack above the fast-sync limit must fall back to ordinary Git correctly.
    files['assets/transport-data.txt'] =
      randomBytes(1_200_000).toString('base64')
    await build('large-pack Git fallback')
  }
}
