import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { BuildTimingEvent } from '../src/lib/ide/build-performance'

const source = resolve(import.meta.dir, '../../../.build/compiler-edits')
const destination = resolve(
  import.meta.dir,
  '../docs/browser-performance/2026-10-10/one-line-edits',
)
const templates = ['vexcode', 'pros', 'ez-template', 'jar-template']
const names = ['VEXcode', 'PROS', 'EZ', 'JAR']
const scenarios = ['source-edit', 'header-edit']
const phases = [
  'compiler-total',
  'dependency-validation',
  'compile',
  'user-link',
]
type Record = {
  scenario: string
  wallMs: number
  spans: Array<BuildTimingEvent>
}
const read = async (path: string) =>
  JSON.parse(await readFile(resolve(source, path), 'utf8'))
const summarize = (values: Array<number>) => {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    median:
      (sorted[Math.floor((sorted.length - 1) / 2)] +
        sorted[Math.ceil((sorted.length - 1) / 2)]) /
      2,
    min: sorted[0],
    max: sorted.at(-1),
    samples: sorted.length,
  }
}
await mkdir(destination, { recursive: true })
const rows = []
for (const [index, template] of templates.entries()) {
  const before = await read(`edit-pass/browser-before/${template}.json`)
  const after = await read(`edit-pass/browser-after/${template}.json`)
  for (const scenario of scenarios)
    for (const phase of [...phases, 'wall']) {
      const values = (data: { records: Array<Record> }) =>
        data.records
          .filter((record) => record.scenario === scenario)
          .map((record) =>
            phase === 'wall'
              ? record.wallMs
              : record.spans
                  .filter((span) => span.phase === phase)
                  .reduce((total, span) => total + span.end - span.start, 0),
          )
      const baseline = summarize(values(before))
      const optimized = summarize(values(after))
      rows.push({
        template,
        name: names[index],
        scenario,
        phase,
        baseline,
        optimized,
        reduction: 100 * (1 - optimized.median / baseline.median),
      })
    }
}
for (const name of [
  'browser-before',
  'browser-after',
  'browser-hashes',
  'browser-debug',
  'browser-eager-pch',
  'browser-eager-O2',
  'browser-eager-Os',
  'browser-eager-Oz',
  'browser-sync',
  'browser-O2',
  'browser-Os',
  'browser-Oz',
])
  await cp(resolve(source, `edit-pass/${name}`), resolve(destination, name), {
    recursive: true,
  })
for (const name of [
  'sync-instance-paired',
  'retain-ast-paired',
  'checked-pch-paired',
  'snapshot-debug-paired',
  'eager-pch',
  'compiler-size-variants',
  'edit-pass-before',
  'edit-pass-after',
  'compiler-variant-provenance',
])
  await cp(
    resolve(source, `${name}.json`),
    resolve(destination, `${name}.json`),
  )
await writeFile(
  resolve(destination, 'summary.json'),
  JSON.stringify(rows, null, 2) + '\n',
)
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{font:14px var(--font-sans,system-ui);color:var(--foreground,#e5e7eb);margin:0}h2{font-size:22px;margin:0 0 10px}p{line-height:1.5;color:var(--muted-foreground,#9ca3af)}.controls{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}label{display:grid;gap:6px}select{font:inherit;padding:8px;border:1px solid var(--border,#444);border-radius:6px;background:var(--card,#222);color:inherit}.legend{display:flex;gap:20px;font-size:12px;margin:18px 0}.dot{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}.before{background:#78859b}.after{background:#22b8a5}.row{margin-bottom:19px}.label{display:flex;justify-content:space-between;margin-bottom:7px}.delta{font-variant-numeric:tabular-nums;color:var(--muted-foreground,#9ca3af)}.series{display:grid;grid-template-columns:minmax(0,1fr) 75px;align-items:center;gap:12px;height:20px}.bar{height:12px;border-radius:2px;min-width:1px}.value{text-align:right;font-variant-numeric:tabular-nums}.note{font-size:12px}table{border-collapse:collapse;width:100%;font-size:12px;margin:20px 0}td,th{text-align:left;border-bottom:1px solid var(--border,#444);padding:8px 6px}th{font-weight:500}button{font:inherit;background:transparent;color:inherit;border:1px solid var(--border,#444);border-radius:5px;padding:5px 10px;cursor:pointer}.details{display:none}.details.visible{display:block}code{font-family:var(--font-mono,monospace)}
</style></head><body><h2>Real one-line edits, measured again</h2><p>Compilation after changed source or a changed header. Each build produces changed firmware. Starter-object reuse is disabled.</p><div class="controls"><label>Change<select id="scenario"><option value="source-edit">One-line source edit</option><option value="header-edit">Header-only edit</option></select></label><label>Measurement<select id="phase"><option value="compiler-total">Total build time in worker</option><option value="dependency-validation">Dependency validation</option><option value="compile">Clang compilation</option><option value="user-link">Linking</option><option value="wall">Browser test wall time</option></select></label></div><div class="legend"><span><i class="dot before"></i>Before this pass</span><span><i class="dot after"></i>After this pass</span></div><div id="chart"></div><p class="note">Medians of five edits per template and workload, in Chromium 153 on an Intel i7-8700K. Hover a value for its sample range. Worker totals include compilation, linking, synchronization, and cache checks. Browser wall time also includes Playwright interaction and polling.</p><button id="toggle">Show measured values</button><div class="details" id="details"></div><p class="note">Kept: eager SDK template instantiation for PROS, EZ, and JAR; bounded string-hash reuse; and dependency digests invalidated by changed input identities. Clang still compiles every edited source. Header edits rebuild every affected source. No firmware optimization level was lowered.</p><script>
const rows=${JSON.stringify(rows)};
const format=n=>n<1?n.toFixed(2):n<10?n.toFixed(1):Math.round(n).toLocaleString();
function render(){const selected=rows.filter(r=>r.scenario===scenario.value&&r.phase===phase.value);const max=Math.max(...selected.flatMap(r=>[r.baseline.max,r.optimized.max]));chart.innerHTML=selected.map(r=>'<div class="row"><div class="label"><span>'+r.name+'</span><span class="delta">'+(r.reduction>=0?r.reduction.toFixed(1)+'% less':(-r.reduction).toFixed(1)+'% more')+'</span></div>'+[['baseline','before'],['optimized','after']].map(([key,color])=>'<div class="series"><div><div class="bar '+color+'" style="width:'+(r[key].median/max*100)+'%"></div></div><span class="value" title="Range: '+format(r[key].min)+' to '+format(r[key].max)+' ms">'+format(r[key].median)+' ms</span></div>').join('')+'</div>').join('');details.innerHTML='<table><tr><th>Template</th><th>Before, ms</th><th>After, ms</th><th>Samples each</th></tr>'+selected.map(r=>'<tr><td>'+r.name+'</td><td>'+format(r.baseline.median)+'</td><td>'+format(r.optimized.median)+'</td><td>'+r.optimized.samples+'</td></tr>').join('')+'</table>';}
scenario.onchange=phase.onchange=render;toggle.onclick=()=>{details.classList.toggle('visible');toggle.textContent=details.classList.contains('visible')?'Hide measured values':'Show measured values';};render();
</script></body></html>`
await writeFile(resolve(destination, 'graphs.html'), html)
for (const scenario of scenarios) {
  const selected = rows.filter(
    (row) => row.scenario === scenario && row.phase === 'compiler-total',
  )
  const max = Math.max(
    ...selected.flatMap((row) => [row.baseline.median, row.optimized.median]),
  )
  const chart = selected
    .map((row, index) => {
      const y = 95 + index * 90
      return `<text x="24" y="${y}" font-size="16">${row.name}</text><rect x="130" y="${y - 15}" width="${(row.baseline.median / max) * 450}" height="19" fill="#78859b"/><text x="${140 + (row.baseline.median / max) * 450}" y="${y}" font-size="13">${Math.round(row.baseline.median)} ms</text><rect x="130" y="${y + 12}" width="${(row.optimized.median / max) * 450}" height="19" fill="#22b8a5"/><text x="${140 + (row.optimized.median / max) * 450}" y="${y + 27}" font-size="13">${Math.round(row.optimized.median)} ms</text>`
    })
    .join('')
  await writeFile(
    resolve(destination, `${scenario}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="470" viewBox="0 0 720 470"><rect width="720" height="470" fill="#111827"/><g fill="#e5e7eb" font-family="system-ui,sans-serif"><text x="24" y="32" font-size="21">${scenario === 'source-edit' ? 'One-line source edits' : 'Header-only edits'}</text><text x="24" y="54" font-size="13">Worker build time · five-sample medians · gray before / teal after</text>${chart}<text x="24" y="452" font-size="12">Chromium 153 · Intel i7-8700K · edited source is compiled; starter reuse disabled</text></g></svg>`,
  )
}
console.log(destination)
