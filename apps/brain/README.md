# brain

Svelte 5 app for `brain.v5x.dev`. QEMU and the protocol host run in the browser from files in `public/wasm`.

The kernel, protocol, and display renderer come from [vex-v5-qemu](https://github.com/vexide/vex-v5-qemu). That project is [MIT licensed](https://github.com/vexide/vex-v5-qemu/blob/main/LICENSE). Maintainers and contributors: [Tropical](https://github.com/tropicaaal), [Lewis McClelland](https://github.com/lewisfm), [Gavin Niederman](https://github.com/Gavin-Niederman), [ion098](https://github.com/ion098), [Max Niederman](https://github.com/max-niederman), [Jamie M](https://github.com/jmakif), [Andrew Curtis](https://github.com/meisZWFLZ), and doinkythederp, who is named as an author of the protocol crate. The same list is in the app sidebar and at `/credits.html`. QEMU itself is GPL-2.0-or-later, and its license is copied to `public/wasm/QEMU-COPYING`.

```sh
bun install
bun run dev:brain
```

Open http://localhost:5173. Rebuilding those files needs the pinned Rust toolchain and Docker:

```sh
bun --cwd=apps/brain run wasm:build
```

See [the Wasm build guide](../../tools/wasm/README.md). The page needs `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.
