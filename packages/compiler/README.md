# Browser compiler

`@v5x/compiler` builds VEX V5 projects in browser workers using the pinned LLVM WASM toolchain. It owns compilation and linking, worker lifecycle, SDK loading, intermediate caches, stored build results, compiler timing, and ARM ELF conversion.

```ts
import { buildInBrowser, releaseBrowserCompiler } from '@v5x/compiler'

const result = await buildInBrowser(
  { files, template: 'pros', commitSha },
  (text) => console.log(text),
)

releaseBrowserCompiler()
```

The package exports TypeScript sources. Consumers must support module workers created with `new Worker(new URL(..., import.meta.url))`, as Vite does. Call `releaseBrowserCompiler` when disposing the owning workspace. `observeBrowserBuild` lets language services coordinate with active compilation.

The host serves compiler assets at `/compiler/` and language SDK headers at `/language/`, including their manifests. `apps/code` owns these public directories and their preparation scripts. From the repository root, run `bun scripts/prepare-browser-compiler.ts` to publish LLVM assets from this package's pinned dependency and reviewed inputs in `assets/`. See [assets/README.md](assets/README.md) for optimizer provenance and reproduction.

Lower-level modules have explicit subpath exports for SDK preparation and verification tooling. The package has no dependency on `apps/code`, React, or the editor.

Run `bun run --cwd packages/compiler typecheck` and `bun run --cwd packages/compiler test` to check the package. Tests using app SDK assets and project templates remain in `apps/code`.
