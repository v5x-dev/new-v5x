import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { parseSourcePack } from '../convex/lib/buildWorkspace'
import {
  collectBuildOutputs,
  parseBuildOutputs,
} from '../convex/lib/buildArtifacts'

function packet(line: string) {
  return (Buffer.byteLength(line) + 4).toString(16).padStart(4, '0') + line
}

describe('Git pack transport', () => {
  test('retains shallow boundaries and exact binary pack bytes', () => {
    const sha = 'a'.repeat(40)
    const pack = Buffer.concat([Buffer.from('PACK'), Buffer.alloc(40, 255)])
    const response = Buffer.concat([
      Buffer.from(packet(`shallow ${sha}\n`) + '0000' + packet('NAK\n')),
      pack,
    ])
    const parsed = parseSourcePack(response)
    expect(parsed.shallow).toEqual([sha])
    expect(Buffer.from(parsed.pack)).toEqual(pack)
  })

  test('rejects errors and truncated packet or pack bodies', () => {
    for (const body of [
      '0008NA',
      'garbage',
      packet('ERR unknown commit\n'),
      '0008NAK\nPACK',
    ]) {
      expect(() => parseSourcePack(Buffer.from(body))).toThrow()
    }
  })
})

test('artifact collection preserves small binary bytes and bounds inline transfer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'build-artifacts-'))
  try {
    await mkdir(join(root, 'build'))
    await mkdir(join(root, 'bin'))
    const small = Buffer.from([0, 255, 13, 10, 128])
    const large = Buffer.alloc(300_000, 128)
    await writeFile(join(root, 'build/workspace.bin'), small)
    await writeFile(join(root, 'bin/cold.package.bin'), large)
    const child = Bun.spawn(['sh', '-c', collectBuildOutputs], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdout = await new Response(child.stdout).text()
    expect(await child.exited).toBe(0)
    const { outputs } = parseBuildOutputs(stdout)
    expect(outputs).toHaveLength(2)
    const inline = outputs.find((file) => file.path === 'build/workspace.bin')!
    expect(Buffer.from(inline.base64, 'base64')).toEqual(small)
    expect(inline.sha256).toBe(createHash('sha256').update(small).digest('hex'))
    expect(
      outputs.find((file) => file.path === 'bin/cold.package.bin')?.base64,
    ).toBe('')
    expect(() => parseBuildOutputs(stdout.slice(0, -30))).toThrow()
    expect(() =>
      parseBuildOutputs(
        stdout.replace('./build/workspace.bin', './build/../secret.bin'),
      ),
    ).toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pack installation checks out exact commits, deletions, modes, and later edits', async () => {
  const { syncBuildWorkspace } = await import('../convex/lib/buildWorkspace')
  const { chmod } = await import('node:fs/promises')
  const root = await mkdtemp(join(tmpdir(), 'build-git-'))
  const source = join(root, 'source')
  const workspace = join(root, 'workspace')
  const git = (args: Array<string>, stdin?: string) => {
    const result = Bun.spawnSync(['git', '-C', source, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      ...(stdin ? { stdin: Buffer.from(stdin) } : {}),
    })
    if (result.exitCode) throw new Error(result.stderr.toString())
    return result.stdout
  }
  try {
    await mkdir(source)
    git(['init', '-q'])
    await writeFile(join(source, 'main.cpp'), 'int main() { return 1; }\n')
    await writeFile(join(source, 'deleted.h'), '#define TEST 1\n')
    await writeFile(join(source, 'script'), '#!/bin/sh\nexit 0\n')
    await chmod(join(source, 'script'), 0o755)
    let previous = '-'
    for (let sample = 0; sample < 2; sample++) {
      if (sample) {
        await rm(join(source, 'deleted.h'))
        await writeFile(join(source, 'main.cpp'), 'int main() { return 2; }\n')
      }
      git(['add', '.'])
      git([
        '-c',
        'user.name=test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-qm',
        `edit ${sample}`,
      ])
      const sha = git(['rev-parse', 'HEAD']).toString().trim()
      const pack = git(
        ['pack-objects', '--stdout', '--revs'],
        sha + '\n' + (sample ? `^${previous}\n` : ''),
      )
      const chunks = pack.toString('base64').match(/.{1,32}/g)!
      const script = syncBuildWorkspace.replaceAll('/workspace', workspace)
      const synced = Bun.spawnSync(
        [
          'sh',
          '-c',
          script,
          'sync',
          '-',
          sha,
          previous,
          'pack',
          '-',
          ...chunks,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      )
      expect(synced.exitCode).toBe(0)
      expect(
        Bun.spawnSync(['git', '-C', workspace, 'rev-parse', 'HEAD'])
          .stdout.toString()
          .trim(),
      ).toBe(sha)
      expect(
        Bun.spawnSync(['git', '-C', workspace, 'diff', '--exit-code', sha])
          .exitCode,
      ).toBe(0)
      previous = sha
    }
    expect(await Bun.file(join(workspace, 'deleted.h')).exists()).toBe(false)
    expect(
      Bun.spawnSync(['test', '-x', join(workspace, 'script')]).exitCode,
    ).toBe(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
