<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Editor

- Keep `@pierre/diffs` as the editor foundation for `apps/code`. Do not replace it with Monaco, CodeMirror, or another editor engine.
- Build editor features on top of Pierre's editor APIs and supported extension points. Before implementing a feature, check whether Pierre already provides a suitable API or customization hook.
- If Pierre lacks a needed capability, add an adapter or complementary UI around Pierre while retaining it as the editing engine. Do not migrate editor state, rendering, or input handling to a competing editor.
