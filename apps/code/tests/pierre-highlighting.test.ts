import { expect, test } from 'bun:test'

const pierreRoot = new URL('./', import.meta.resolve('@pierre/diffs'))
const { EditorTokenizer } = await import(
  new URL('editor/tokenizer.js', pierreRoot).href
)
const { TextDocument } = await import(
  new URL('editor/textDocument.js', pierreRoot).href
)
const { getSharedHighlighter } = await import(
  new URL('highlighter/shared_highlighter.js', pierreRoot).href
)

test('an edit resumes highlighting rows left unfinished by a large replacement', async () => {
  const highlighter = await getSharedHighlighter({
    langs: ['cpp'],
    themes: ['github-dark'],
    preferredHighlighter: 'shiki-js',
  })
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalPostMessage = Object.getOwnPropertyDescriptor(
    globalThis,
    'postMessage',
  )
  const messages: Array<unknown> = []

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { matchMedia: () => ({ matches: true }) },
  })
  Object.defineProperty(globalThis, 'postMessage', {
    configurable: true,
    value: (data: unknown) => messages.push(data),
  })

  const document = new TextDocument('main.cpp', 'int oldValue = 0;', 'cpp')
  const highlighted = new Map<number, Array<[number, string, string]>>()
  const tokenizer = new EditorTokenizer({
    highlighter,
    textDocument: document,
    codeOptions: { theme: 'github-dark', themeType: 'dark' },
    setStyle() {},
    onDeferTokenize(lines: Map<number, Array<[number, string, string]>>) {
      for (const [line, tokens] of lines) highlighted.set(line, tokens)
    },
  })

  try {
    const replacement = Array.from(
      { length: 200 },
      (_, line) => `int value${line} = ${line};`,
    ).join('\n')
    const largeChange = document.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: document.getLineLength(0) },
        },
        newText: replacement,
      },
    ])
    const viewport = { startingLine: 0, totalLines: 10 }
    tokenizer.tokenize(largeChange, viewport, true)
    tokenizer.stopBackgroundTokenize()

    const smallChange = document.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: ' ',
      },
    ])
    tokenizer.tokenize(smallChange, viewport, true)

    // Deliver both stale and current jobs, as the browser's message queue does.
    for (let count = 0; messages.length > 0 && count < 1000; count++) {
      globalThis.dispatchEvent(
        new MessageEvent('message', { data: messages.shift() }),
      )
    }

    expect(messages).toHaveLength(0)
    for (let line = 10; line < 200; line++) {
      const tokens = highlighted.get(line)
      expect(tokens?.map((token) => token[2]).join('')).toBe(
        document.getLineText(line),
      )
      expect(tokens?.some((token) => token[1] !== '')).toBe(true)
    }
  } finally {
    tokenizer.cleanUp()
    for (const [name, descriptor] of [
      ['window', originalWindow],
      ['postMessage', originalPostMessage],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
})
