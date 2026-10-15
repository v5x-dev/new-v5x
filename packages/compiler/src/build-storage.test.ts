import { expect, it } from 'bun:test'
import { writeBrowserBuild } from './build-storage'

it('rejects cached artifacts whose combined size exceeds the per-build cap', async () => {
  const halfLimit = 8 * 1024 * 1024
  await expect(
    writeBrowserBuild('large-build', {
      commitSha: 'test',
      exitCode: 0,
      output: '',
      artifacts: [
        { path: 'bin/first.bin', bytes: new Uint8Array(halfLimit) },
        { path: 'bin/second.bin', bytes: new Uint8Array(halfLimit + 1) },
      ],
    }),
  ).rejects.toThrow('Invalid browser build result')
})
