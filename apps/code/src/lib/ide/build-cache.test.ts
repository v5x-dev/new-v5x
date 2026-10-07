import { describe, expect, it } from 'bun:test'
import { buildCacheKey, dependencyPaths } from './build-cache'

describe('build cache dependencies', () => {
  it('separates ordered inputs and invalidates changed bytes', async () => {
    expect(await buildCacheKey(['ab', 'c'])).not.toBe(
      await buildCacheKey(['a', 'bc']),
    )
    expect(await buildCacheKey(['sdk-v1', new Uint8Array([1])])).not.toBe(
      await buildCacheKey(['sdk-v2', new Uint8Array([1])]),
    )
    expect(await buildCacheKey(['header', new Uint8Array([1])])).not.toBe(
      await buildCacheKey(['header', new Uint8Array([2])]),
    )
    expect(await buildCacheKey(['header', new Uint8Array([1])])).toBe(
      await buildCacheKey(['header', new Uint8Array([1])]),
    )
  })

  it('reads compiler dependency files with escaped spaces and continued lines', () => {
    expect(
      dependencyPaths(
        'main.o: /workspace/src/main.cpp \\\r\n /workspace/include/my\\ header.h /workspace/include/my\\ header.h\n',
      ),
    ).toEqual(['/workspace/src/main.cpp', '/workspace/include/my header.h'])
    expect(
      dependencyPaths('main.o: /workspace/include/path:with:colons.h\n'),
    ).toEqual(['/workspace/include/path:with:colons.h'])
  })
})
