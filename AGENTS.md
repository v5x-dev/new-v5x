# Instructions

- Use bun and bunx instead of npm and npx.
- Keep Pierre as the editor in `apps/code`. Do not suggest or implement replacing it with Monaco or another editor. Integrate LSP and other editor features with Pierre.
- Use the browser only to verify behavior afterward, or when the cause depends on DOM state, cookies, network responses, or runtime-only behavior.

## apps/code editor

- Never replace `@pierre/diffs` with another editor engine. All editor work in `apps/code` must build on top of Pierre.
- Before adding editor behavior, check Pierre's APIs and supported extension points. Extend Pierre or add complementary UI and adapters around it; do not migrate editor rendering, input handling, or state to a competing engine.
