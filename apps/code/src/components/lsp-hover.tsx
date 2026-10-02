import * as React from 'react'
import Markdown, { type Components } from 'react-markdown'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

const highlighter = () =>
  Promise.all([
    import('shiki/langs/cpp.mjs'),
    import('shiki/themes/dark-plus.mjs'),
    import('shiki/themes/light-plus.mjs'),
  ]).then(([cpp, dark, light]) =>
    createHighlighterCore({
      langs: [cpp.default],
      themes: [dark.default, light.default],
      engine: createJavaScriptRegexEngine(),
    }),
  )
let highlighting: ReturnType<typeof highlighter> | undefined

type CodeTokens = { content: string; color?: string; lightColor?: string }[][]
const tokenCache = new Map<string, CodeTokens>()

export const HighlightedCode = React.memo(function HighlightedCode({
  children,
}: {
  children: string
}) {
  const [highlighted, setHighlighted] = React.useState(() => ({
    text: children,
    tokens: tokenCache.get(children),
  }))
  const tokens =
    highlighted.text === children
      ? highlighted.tokens
      : tokenCache.get(children)
  React.useEffect(() => {
    let active = true
    highlighting ??= highlighter()
    void highlighting
      .then((instance) => {
        const dark = instance.codeToTokens(children, {
          lang: 'cpp',
          theme: 'dark-plus',
        }).tokens
        const light = instance.codeToTokens(children, {
          lang: 'cpp',
          theme: 'light-plus',
        }).tokens
        const tokens = dark.map((line, i) =>
          line.map((token, j) => ({
            ...token,
            lightColor: light[i]?.[j]?.color,
          })),
        )
        if (tokenCache.size >= 128)
          tokenCache.delete(tokenCache.keys().next().value!)
        tokenCache.set(children, tokens)
        if (active) setHighlighted({ text: children, tokens })
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [children])
  return (
    <code className="font-mono text-xs">
      {tokens?.length
        ? tokens.map((line, i) => (
            <React.Fragment key={i}>
              {i > 0 ? '\n' : null}
              {line.map((token, j) => (
                <span
                  key={j}
                  className="text-[var(--code-light)] dark:text-[var(--code-dark)]"
                  style={
                    {
                      '--code-light': token.lightColor,
                      '--code-dark': token.color,
                    } as React.CSSProperties
                  }
                >
                  {token.content}
                </span>
              ))}
            </React.Fragment>
          ))
        : children}
    </code>
  )
})

const markdownComponents: Components = {
  pre: ({ children }) => (
    <pre className="my-2 max-w-full overflow-x-auto whitespace-pre rounded bg-muted/50 px-3 py-2 first:mt-0">
      {children}
    </pre>
  ),
  code: ({ className, children }) =>
    className?.startsWith('language-') ? (
      <HighlightedCode>{String(children).replace(/\n$/, '')}</HighlightedCode>
    ) : (
      <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-xs text-primary">
        {children}
      </code>
    ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
}

export const LspHover = React.memo(function LspHover({
  text,
}: {
  text: string
}) {
  // clangd can include unprocessed Doxygen commands in Markdown documentation.
  const documentation = text
    .replace(/^\s*\\+param(?:\[[^\]]+\])?\s+(\w+)\s*(.*)$/gm, '- **`$1`** — $2')
    .replace(/^\s*\\+(?:returns?|retval)\s+(.*)$/gm, '**Returns:** $1')
    .replace(/^\s*\\+(?:brief|details)\s*/gm, '')
  return (
    <div className="text-sm leading-relaxed text-popover-foreground [&>p]:my-2 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:space-y-1 [&_ul]:pl-4 [&_li]:list-disc [&_hr]:my-3 [&_hr]:border-border [&_strong]:font-semibold [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold">
      <Markdown components={markdownComponents}>{documentation}</Markdown>
    </div>
  )
})
