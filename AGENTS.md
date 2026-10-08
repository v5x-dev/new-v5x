# Instructions

- Use bun and bunx instead of npm and npx.
- For frontend work, always try to use shadcn UI components before building custom components.
- Keep Pierre as the editor in `apps/code`. Do not suggest or implement replacing it with Monaco or another editor. Integrate LSP and other editor features with Pierre.
- Use the browser only to verify behavior afterward, or when the cause depends on DOM state, cookies, network responses, or runtime-only behavior.
- Verify `apps/code` behavior in the real application routes. Never use `ide.html`, `ide-validation.tsx`, or an isolated editor harness unless the user explicitly requests it. A harness is not a substitute for testing the actual app. If the real app cannot be accessed, report that limitation instead of switching to a harness.

## apps/design

- `apps/design` is planned as a browser-based CAD tool for designing VEX V5 robots, inspired by Protobot.
- Keep its core workflow centered on assembling VEX V5 parts in an interactive 3D workspace.

## apps/code editor

- Keep `@pierre/diffs` as the editor foundation in `apps/code`. Do not replace it with Monaco, CodeMirror, or another editor engine.
- Before adding editor behavior, check Pierre's APIs and supported extension points. Build on those APIs, or add adapters and complementary UI around Pierre.
- If Pierre lacks a needed capability, keep Pierre as the editing engine. Do not move editor rendering, input handling, or state to a competing engine.

## Readability

- Keep handwritten code readable with consistent indentation and line wrapping.
- Separate top-level declarations and longer logical steps with blank lines. Keep related short statements together.
- Run the relevant formatter after editing code. Preserve behavior during formatting and exclude generated files and build output.

## Convex

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`bunx convex ai-files install`.
