import { expect, test } from 'bun:test'
import { formatWorkspace } from './format-workspace'
import { isDirty, recoverDocuments, workspaceDocuments } from './workspace'

function formatter(failOn?: string) {
  const synced: Array<string> = []
  const files: Array<string> = []
  const requested: Array<string> = []

  return {
    synced,
    files,
    requested,
    ready: true,
    capabilities: { documentFormattingProvider: true },
    sync(path: string) {
      synced.push(path)
    },
    setFile(path: string) {
      files.push(path)
    },
    async request<T>(_method: string, params: unknown): Promise<T> {
      const { textDocument } = params as { textDocument: { uri: string } }
      requested.push(textDocument.uri)
      if (textDocument.uri.endsWith(failOn ?? '\0'))
        throw new Error('Formatting failed')

      return [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: '// formatted\n',
        },
      ] as T
    },
  }
}

test('formats unchanged sources and unopened headers, preserving other files and deletions', async () => {
  const { documents } = recoverDocuments({
    'main.cpp': 'int main(){}',
    'include/helper.hpp': 'void helper();',
    'README.md': 'hello',
    '.clang-format': 'BasedOnStyle: LLVM',
    'removed.cpp': 'void old();',
  })
  documents['removed.cpp']!.deleted = true
  const client = formatter()
  const formatted = await formatWorkspace(documents, client)

  expect(client.synced).toEqual(['main.cpp', 'include/helper.hpp'])
  expect(client.files).toContain('.clang-format')
  expect(client.requested).toHaveLength(2)
  expect(formatted['main.cpp']!.contents).toBe('// formatted\nint main(){}')
  expect(formatted['include/helper.hpp']!.version).toBe(2)
  expect(formatted['README.md']).toBe(documents['README.md'])
  expect(formatted['removed.cpp']).toBe(documents['removed.cpp'])
  expect(
    workspaceDocuments(formatted)
      .filter(isDirty)
      .map((doc) => doc.path),
  ).toEqual(['main.cpp', 'include/helper.hpp', 'removed.cpp'])
  expect(documents['main.cpp']!.contents).toBe('int main(){}')
})

test('formatting failures leave the entire original program unchanged', async () => {
  const { documents } = recoverDocuments({
    'main.cpp': 'main',
    'other.h': 'other',
  })
  expect(await formatWorkspace(documents, formatter('other.h'))).toBe(documents)
  expect(documents['main.cpp']!.contents).toBe('main')
  expect(workspaceDocuments(documents).some(isDirty)).toBe(false)
})

test('commits original text when the formatter is absent, starting, or unsupported', async () => {
  const { documents } = recoverDocuments({ 'main.cpp': 'main' })
  expect(await formatWorkspace(documents, null)).toBe(documents)
  const client = formatter()
  client.ready = false
  expect(await formatWorkspace(documents, client)).toBe(documents)
  expect(client.requested).toHaveLength(0)
  client.ready = true
  client.capabilities.documentFormattingProvider = false
  expect(await formatWorkspace(documents, client)).toBe(documents)
  expect(client.requested).toHaveLength(0)
})

test('bounds the whole formatting pass and cancels a stalled request', async () => {
  const { documents } = recoverDocuments({ 'main.cpp': 'main' })
  const client = formatter()
  let signal: AbortSignal | undefined
  client.request = async <T>(
    _method: string,
    _params: unknown,
    requestSignal?: AbortSignal,
  ): Promise<T> => {
    signal = requestSignal
    return new Promise((_resolve, reject) => {
      requestSignal?.addEventListener(
        'abort',
        () => reject(new Error('cancelled')),
        {
          once: true,
        },
      )
    })
  }

  expect(await formatWorkspace(documents, client)).toBe(documents)
  expect(signal?.aborted).toBe(true)
}, 5_000)
