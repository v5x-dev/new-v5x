import { mkdir, readFile, writeFile, cp } from 'node:fs/promises'
import { resolve } from 'node:path'

const source = resolve(import.meta.dir, '../../../.build/compiler-edits')
const destination = resolve(
  import.meta.dir,
  '../docs/browser-performance/2026-10-10',
)
await mkdir(destination, { recursive: true })
const read = async (name: string) =>
  JSON.parse(await readFile(resolve(source, name), 'utf8'))
const before = await read('historical-baseline.json')
const after = await read('final-optimized.json')
const templates = ['vexcode', 'pros', 'ez-template', 'jar-template']
const names = ['VEXcode', 'PROS', 'EZ', 'JAR']
const scenarios = ['fresh', 'source-edit', 'header-edit']
const labels = ['Fresh workspace', 'One-line source edit', 'Header-only edit']
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return (
    (sorted[Math.floor((sorted.length - 1) / 2)] +
      sorted[Math.ceil((sorted.length - 1) / 2)]) /
    2
  )
}
const summary = (
  records: any[],
  key: string,
  template: string,
  scenario: string,
) => {
  const values = records
    .filter((row) => row.template === template && row.scenario === scenario)
    .map((row) => row[key]) as number[]
  if (!values.length) throw new Error(`Missing ${template}/${scenario}`)
  return {
    median: median(values),
    min: Math.min(...values),
    max: Math.max(...values),
    samples: values.length,
  }
}
const rows = templates.flatMap((template, index) =>
  scenarios.map((scenario, position) => {
    const baseline = summary(before.records, 'ms', template, scenario)
    const optimized = summary(after.records, 'ms', template, scenario)
    return {
      template,
      name: names[index],
      scenario,
      label: labels[position],
      baseline,
      optimized,
      speedup: baseline.median / optimized.median,
    }
  }),
)
const browser = await Promise.all(
  templates.map(async (template, index) => {
    const old = await read(`browser-before-transport/${template}.json`)
    const current = await read(`browser/${template}.json`)
    return {
      template,
      name: names[index],
      coldBefore: old.records.find(
        (row: any) => row.sample === 0 && row.scenario === 'fresh',
      ).wallMs,
      coldAfter: current.records.find(
        (row: any) => row.sample === 0 && row.scenario === 'fresh',
      ).wallMs,
      warmFresh: summary(
        current.records.filter((row: any) => row.sample > 0),
        'wallMs',
        template,
        'fresh',
      ),
      source: summary(current.records, 'wallMs', template, 'source-edit'),
      header: summary(current.records, 'wallMs', template, 'header-edit'),
    }
  }),
)
const round = (value: number) => Math.round(value)
const engines = await Promise.all(
  templates.map(async (template, index) => {
    const pinned = await read(`browser-pinned/${template}.json`)
    const binaryen = await read(`browser-binaryen/${template}.json`)
    return {
      name: names[index],
      chosen: template === 'ez-template' ? 'Binaryen' : 'Original',
      originalSource: summary(pinned.records, 'wallMs', template, 'source-edit')
        .median,
      binaryenSource: summary(
        binaryen.records,
        'wallMs',
        template,
        'source-edit',
      ).median,
      originalHeader: summary(pinned.records, 'wallMs', template, 'header-edit')
        .median,
      binaryenHeader: summary(
        binaryen.records,
        'wallMs',
        template,
        'header-edit',
      ).median,
    }
  }),
)
const engineTable = engines
  .map(
    (row) =>
      `| ${row.name} | ${round(row.originalSource)} | ${round(row.binaryenSource)} | ${round(row.originalHeader)} | ${round(row.binaryenHeader)} | ${row.chosen} |`,
  )
  .join('\n')
await writeFile(
  resolve(destination, 'summary.json'),
  JSON.stringify({ rows, browser, engines }, null, 2) + '\n',
)
for (const name of [
  'historical-baseline.json',
  'final-optimized.json',
  'binaryen-paired.json',
  'phase-profile.json',
])
  await cp(resolve(source, name), resolve(destination, name))
for (const name of [
  'browser',
  'browser-before-transport',
  'browser-pinned',
  'browser-binaryen',
  'browser-before-dev-assets',
])
  await cp(resolve(source, name), resolve(destination, name), {
    recursive: true,
  })
const table = rows
  .map(
    (row) =>
      `| ${row.name} | ${row.label} | ${round(row.baseline.median)} | ${round(row.optimized.median)} | ${row.speedup.toFixed(2)}× |`,
  )
  .join('\n')
const browserTable = browser
  .map(
    (row) =>
      `| ${row.name} | ${(row.coldBefore / 1000).toFixed(2)} | ${(row.coldAfter / 1000).toFixed(2)} | ${round(row.warmFresh.median)} | ${round(row.source.median)} | ${round(row.header.median)} |`,
  )
  .join('\n')
const ranges = rows
  .map(
    (row) =>
      `| ${row.name} | ${row.label} | ${round(row.baseline.min)} to ${round(row.baseline.max)} | ${round(row.optimized.min)} to ${round(row.optimized.max)} |`,
  )
  .join('\n')
await writeFile(
  resolve(destination, 'report.md'),
  `# WASM Clang compilation measurements

October 10, 2026. Intel Core i7-8700K, 32 GB RAM, Linux x64, Bun 1.4.2. Browser tests use Chromium 153 and a local Vite server. These results describe this host and these projects; they do not establish a physical performance limit.

[Interactive graphs](graphs.html) · [Exportable SVG](compilation.svg) · [Raw summary](summary.json)

## Fresh compilation and live edits

Median milliseconds, lower is better. Five samples per baseline case and ${after.samples} per optimized case. The historical baseline is commit \`${before.baselineRevision}\`, run with its own compiler adapter, package patch and SDK manifest. Both sides use the same edit fixture. Each sample starts a new filesystem with an empty object cache. Starter object reuse is disabled. SDK PCH and validated prebuilt cold firmware are enabled where supported. Source edits change a delay instruction. Header setup changes the source to consume a macro, then the measured header-only edit changes that macro from 46 to 47 without touching the source. Each edit must produce a different binary and compiled main object, excluding timestamp-only changes. Unchanged builds are measured separately in the raw data and excluded from these speedup claims.

These are local WASM compile/link/package timings. They exclude network, SDK mounting, compiler module initialization, editor and UI. They are not cold browser startup measurements.

| Template | Workload | Before ms | After ms | Speedup |
| --- | --- | ---: | ---: | ---: |
${table}

![Compilation before and after](compilation.svg)

## Real application measurements

All templates use the real \`/build-demo\` editor, Build button, worker and downloaded artifacts. The first sample clears application asset and object caches. Later fresh samples restart the worker and clear objects while retaining downloaded assets. Browser wall time includes initialization and UI completion. Source/header edit medians use three samples. Warm fresh medians use two samples. A single empty-asset-cache observation per template is descriptive, not a distribution. Browser/V8 and HTTP cache state are not fully cold.

The startup comparison begins after the filesystem, SDK PCH, frontend plans and streaming improvements. It measures the later compiler selection, compressed resource transfer, concurrent optional assets and development serving changes. It is not a historical-original browser baseline. Earlier browser header measurements changed both header and source, so they are excluded from live-edit comparisons.

| Template | Before transfer changes, empty assets s | Final, empty assets s | Warm assets / fresh objects ms | Source edit ms | Header-only edit ms |
| --- | ---: | ---: | ---: | ---: | ---: |
${browserTable}

## Compiler core choice

Median browser wall milliseconds, three samples per case with the improved development asset serving. Original and Binaryen comparisons were sequential, not randomized, so small differences deserve caution. Raw compile spans are included. The stronger VEX/PROS source differences also appear in compiler-only spans. The original core is preferred for VEX, PROS and JAR; EZ favors Binaryen for repeated edits even though its warm-asset fresh build was somewhat slower. Bun tooling favors Binaryen. These are workload and engine tradeoffs, not a universal compiler ranking.

| Template | Original source ms | Binaryen source ms | Original header ms | Binaryen header ms | Browser default |
| --- | ---: | ---: | ---: | ---: | --- |
${engineTable}

## What changed

- Writable compiler files grow geometrically, removing repeated whole-file allocation and copying. Seek holes, truncation, overwrite and host byte ownership are verified against the actual patched runtime.
- All four SDKs have checked prefix PCH assets. Project declarations remain live after the SDK prefix. Dependency, inventory, argument and exact-prefix checks select the safe path.
- The pinned Clang driver generates standard frontend plans. Exact matching commands run through public \`Session.exec\`; custom commands use the ordinary driver.
- Browser builds use the original core for VEX, PROS and JAR, and Binaryen for EZ. Bun tooling uses Binaryen for all templates. Chromium comparisons favored the original core for VEX/PROS/JAR source edits and fresh builds; EZ repeated edits favored Binaryen. No one core won every workload. Two immutable compiler identities cache their compiled WASM modules, with bounded retention and retry after failure.
- Independent WASM modules compile concurrently. Integrity-gated streaming overlaps download and WASM compilation. Metadata and cold SDK assets load alongside startup.
- Development serves prepared WASM compression and gzip SDK bundles directly. Nitro otherwise recompresses every public response. A 13.69 MB already-compressed EZ PCH response took 18.82 seconds with dynamic Brotli versus 19 milliseconds served directly, on this local server. Production retains normal static compression negotiation.
- The 15.10 MB decoded compiler resource archive transfers as a roughly 1.03 MB gzip companion even in development. Decoded checksums still gate use.
- Binaryen 133 optimizes the main compiler module from 63,386,658 to 52,706,432 bytes, a 16.8% reduction. Alternating original/optimized comparisons show mostly small execution gains. A verified compressed build input, deterministic reproduction script, content-addressed public URL and original reference module accompany the change.

## Correctness and limits

66 unit tests and 266 assertions pass. Typecheck, changed-code lint, formatting and production build pass. Real WASM checks cover all templates, custom flags, additions/deletions, compiler errors and recovery, SDK overrides, native objcopy equivalence and packaged cold firmware equivalence. Six configurations per template compare generated code, data, symbols and relocations against the original WASM compiler with full driver and no PCH. ELF comparison resolves symbols and section identities because equivalent PCH output can reorder sections. It is stronger than checking build success, but it is not a mathematical proof of compiler equivalence for arbitrary C++.

The real browser suite records 60 builds across four templates, including header-only changes, and separately verifies three builds while switching compiler variants in one worker. The authenticated \`/p/:programId\` route also builds and restores saved artifacts. Physical Brain execution was not available in this pass; previous hardware limits still apply.

EZ remains the largest compilation workload. An instrumented Clang phase report attributed roughly 52% to frontend work, 24% to optimization, 15% to machine-code generation and 9% to IR generation. Profiling adds overhead, so these percentages are approximate. Project PCH and multiple compiler workers remain experimental because additional memory, initialization and invalidation costs need target-device measurements. Reducing optimization levels changes generated code and was not used for the reported gains. The pinned toolchain already omits unrelated target backends. Neither main module contains removable WASM custom/debug sections. Further compiler source changes or browser/device-specific tuning may yield gains; I cannot honestly certify that nothing else is physically possible.

## Sample ranges

Minimum and maximum milliseconds, including first-use JIT effects. All raw samples and spans are preserved beside this report.

| Template | Workload | Before range | After range |
| --- | --- | ---: | ---: |
${ranges}

## Reproduce

From the repository root:

\`\`\`sh
BUILD_BASELINE_REV=${before.baselineRevision} BUILD_BENCH_SAMPLES=5 bun apps/code/scripts/benchmark-compiler-edits.ts historical-baseline
BUILD_BENCH_SAMPLES=${after.samples} bun apps/code/scripts/benchmark-compiler-edits.ts final-optimized
BUILD_VERIFY_COMPILER_PLANS=1 BUILD_VERIFY_EDITS=1 BUILD_VERIFY_SDK=1 bun apps/code/scripts/verify-browser-builds.ts
\`\`\`

Run browser measurements from \`apps/code\` against the running real app:

\`\`\`sh
BUILD_COMPILER_EDITS=1 BUILD_BENCH_SAMPLES=3 PLAYWRIGHT_BASE_URL=http://localhost:3001 bunx playwright test e2e/compiler-edits.spec.ts --workers=1 --reporter=list
\`\`\`

Preserve the before-transfer browser records under \`.build/compiler-edits/browser-before-transport\`, then run \`bun apps/code/scripts/report-compiler-edits.ts\`. See [compiler reproduction](../../../compiler/README.md) for the Binaryen build input.
`,
)
const svgRows = rows
  .map((row, index) => {
    const y = 80 + index * 47
    const max = Math.max(...rows.map((item) => item.baseline.median))
    const width = (value: number) => (value / max) * 500
    return `<text x="18" y="${y + 15}" font-size="13">${row.name} · ${row.label}</text><rect x="260" y="${y}" width="${width(row.baseline.median)}" height="12" fill="#94a3b8"/><rect x="260" y="${y + 16}" width="${width(row.optimized.median)}" height="12" fill="#0d9488"/><text x="${265 + width(row.baseline.median)}" y="${y + 11}" font-size="11">${round(row.baseline.median)}</text><text x="${265 + width(row.optimized.median)}" y="${y + 27}" font-size="11">${round(row.optimized.median)} ms · ${row.speedup.toFixed(2)}×</text>`
  })
  .join('')
await writeFile(
  resolve(destination, 'compilation.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="700" viewBox="0 0 960 700"><rect width="960" height="700" fill="white"/><g font-family="Arial,sans-serif" fill="#17202a"><text x="18" y="28" font-size="22">WASM Clang: fresh compilation and actual edits</text><text x="18" y="53" font-size="13">Median local WASM milliseconds · Gray before · Teal after · Lower is better</text>${svgRows}<text x="18" y="674" font-size="12">Empty object caches, starter reuse disabled. Excludes network/startup. See report for samples and limits.</text></g></svg>`,
)
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:var(--font-sans,system-ui);color:var(--foreground,#17202a);margin:0}h2{font-size:21px;margin:0 0 8px}p{font-size:13px;color:var(--muted-foreground,#667085);line-height:1.6}select{background:var(--secondary,#eef2f6);color:inherit;border:1px solid var(--border,#ddd);border-radius:6px;padding:8px;font:inherit}svg{width:100%;height:310px}text{fill:var(--foreground,#17202a);font-family:inherit}table{width:100%;border-collapse:collapse;font-size:12px}td,th{text-align:right;padding:8px 4px;border-bottom:1px solid var(--border,#ddd)}td:first-child,th:first-child{text-align:left}.legend{display:flex;gap:18px;margin:14px 0;font-size:12px}.dot{display:inline-block;width:10px;height:10px;margin-right:5px}.before{background:#94a3b8}.after{background:#0d9488}section{margin-top:26px}.note{font-size:12px}</style></head><body><h2>WASM Clang compilation</h2><p>Fresh workspaces and real one-line changes. Empty object caches; starter reuse disabled.</p><select id="scenario" aria-label="Compilation workload">${labels.map((label, index) => `<option value="${scenarios[index]}">${label}</option>`).join('')}</select><div class="legend"><span><i class="dot before"></i>Historical runner</span><span><i class="dot after"></i>Optimized runner</span></div><svg id="chart" viewBox="0 0 700 310" role="img" aria-label="Before and after compilation times"></svg><table><thead><tr><th>Template</th><th>Before</th><th>After</th><th>Speedup</th></tr></thead><tbody id="values"></tbody></table><p class="note">Median local WASM milliseconds, lower is better. ${before.samples} baseline and ${after.samples} final samples. Excludes downloads, compiler initialization, editor and UI. Intel i7-8700K, Linux, Bun 1.4.2.</p><section><h2>First browser build with empty application assets</h2><p>This comparison starts after the compilation changes and measures the later transfer/startup changes. One observation per template on local Vite, including worker initialization and UI.</p><div class="legend"><span><i class="dot before"></i>Before transfer changes</span><span><i class="dot after"></i>Final runner</span></div><svg id="startup" viewBox="0 0 700 310" role="img" aria-label="Browser startup before and after transfer changes"></svg></section><section><h2>What made it faster</h2><p>Geometric filesystem writes. Checked SDK-prefix PCH for all templates. Frontend plans generated by the pinned driver. Concurrent WASM initialization and assets. Streaming compilation gated by checksums. Prepared compression and direct gzip bundle transfer. A verified Binaryen core is 16.8% smaller; browser builds select it for EZ and the original for other templates after measuring Chromium. Bun tooling uses Binaryen.</p><p class="note">Source changes alter instructions. Header-only changes alter a consumed constant while leaving the source untouched. Changed binaries and original-compiler object equivalence are checked. Further compiler and device-specific work may yield gains; these measurements cannot prove a physical speed limit.</p></section><script>const rows=${JSON.stringify(rows)},browser=${JSON.stringify(browser)};function draw(id,data,max,unit){const svg=document.getElementById(id),width=svg.getBoundingClientRect().width;svg.setAttribute('viewBox','0 0 '+width+' 310');const barWidth=Math.max(80,width-210);svg.innerHTML=data.map((r,i)=>{const y=i*70+18,a=r.a/max*barWidth,b=r.b/max*barWidth;return '<text x="0" y="'+(y+20)+'" font-size="14">'+r.name+'</text><rect x="92" y="'+y+'" width="'+a+'" height="19" rx="3" fill="#94a3b8"/><text x="'+(99+a)+'" y="'+(y+14)+'" font-size="12">'+r.a.toFixed(unit==='s'?2:0)+' '+unit+'</text><rect x="92" y="'+(y+25)+'" width="'+b+'" height="19" rx="3" fill="#0d9488"/><text x="'+(99+b)+'" y="'+(y+39)+'" font-size="12">'+r.b.toFixed(unit==='s'?2:0)+' '+unit+'</text>'}).join('')}function update(){const selected=rows.filter(r=>r.scenario===document.getElementById('scenario').value);draw('chart',selected.map(r=>({name:r.name,a:r.baseline.median,b:r.optimized.median})),Math.max(...selected.map(r=>r.baseline.median)),'ms');document.getElementById('values').innerHTML=selected.map(r=>'<tr><td>'+r.name+'</td><td>'+Math.round(r.baseline.median)+' ms</td><td>'+Math.round(r.optimized.median)+' ms</td><td>'+r.speedup.toFixed(2)+'×</td></tr>').join('')}document.getElementById('scenario').addEventListener('change',update);update();function startup(){draw('startup',browser.map(r=>({name:r.name,a:r.coldBefore/1000,b:r.coldAfter/1000})),Math.max(...browser.map(r=>r.coldBefore/1000)),'s')}startup();window.addEventListener('resize',()=>{update();startup()});</script></body></html>`
await writeFile(resolve(destination, 'graphs.html'), html)
console.log(destination)
