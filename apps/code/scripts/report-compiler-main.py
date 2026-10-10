"""Export main-versus-optimized benchmark charts with matplotlib."""

import json
import shutil
from pathlib import Path
from statistics import median

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / ".build/compiler-edits"
DESTINATION = ROOT / "apps/code/docs/browser-performance/2026-10-10/main-comparison"
TEMPLATES = ["vexcode", "pros", "ez-template", "jar-template"]
NAMES = ["VEXcode", "PROS", "EZ", "JAR"]
SCENARIOS = ["fresh", "source-edit", "header-edit"]
LABELS = ["Fresh workspace", "One-line source edit", "Header-only edit"]
COLORS = ["#78859b", "#008b7e"]


def summarize(records, template, scenario):
    values = [
        record["ms"]
        for record in records
        if record["template"] == template and record["scenario"] == scenario
    ]
    return {
        "median": median(values),
        "min": min(values),
        "max": max(values),
        "samples": len(values),
    }


def draw_bars(axis, rows, labels):
    positions = np.arange(len(rows))
    for offset, key, label, color in [
        (-0.18, "baseline", "main", COLORS[0]),
        (0.18, "optimized", "This PR", COLORS[1]),
    ]:
        values = [row[key]["median"] for row in rows]
        low = [value - row[key]["min"] for value, row in zip(values, rows)]
        high = [row[key]["max"] - value for value, row in zip(values, rows)]
        bars = axis.barh(
            positions + offset,
            values,
            height=0.3,
            color=color,
            label=label,
            xerr=[low, high],
            error_kw={"ecolor": "#374151", "elinewidth": 1, "capsize": 3},
        )
        for bar, value in zip(bars, values):
            axis.text(
                value + axis.get_xlim()[1] * 0.015,
                bar.get_y() + bar.get_height() / 2,
                f"{value:,.0f} ms",
                va="center",
                fontsize=10,
                bbox={"facecolor": "white", "alpha": 0.85, "edgecolor": "none"},
            )
    axis.set_yticks(positions, labels)
    axis.invert_yaxis()
    axis.set_xlabel("Compile, link and package time, ms")
    axis.grid(axis="x", alpha=0.18)
    axis.set_axisbelow(True)
    axis.spines[["top", "right", "left"]].set_visible(False)
    limit = max(row[key]["max"] for row in rows for key in ["baseline", "optimized"])
    axis.set_xlim(0, limit * 1.18)


def save_chart(figure, name):
    for extension in ["png", "svg"]:
        output = DESTINATION / f"{name}.{extension}"
        figure.savefig(output, dpi=180, facecolor="white")
        if extension == "svg":
            output.write_text(
                "\n".join(line.rstrip() for line in output.read_text().splitlines())
                + "\n"
            )
    plt.close(figure)


DESTINATION.mkdir(parents=True, exist_ok=True)
before = json.loads((SOURCE / "pr-main.json").read_text())
after = json.loads((SOURCE / "pr-optimized.json").read_text())
rows = []
for template, name in zip(TEMPLATES, NAMES):
    for scenario, label in zip(SCENARIOS, LABELS):
        baseline = summarize(before["records"], template, scenario)
        optimized = summarize(after["records"], template, scenario)
        rows.append(
            {
                "template": template,
                "name": name,
                "scenario": scenario,
                "label": label,
                "baseline": baseline,
                "optimized": optimized,
                "speedup": baseline["median"] / optimized["median"],
            }
        )

summary = {"baselineRevision": before["baselineRevision"], "rows": rows}
(DESTINATION / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
for name in ["pr-main.json", "pr-optimized.json"]:
    shutil.copyfile(SOURCE / name, DESTINATION / name)

plt.rcParams.update(
    {"font.family": "DejaVu Sans", "font.size": 11, "svg.fonttype": "none"}
)
figure, axis = plt.subplots(figsize=(10, 5.5))
selected = [row for row in rows if row["template"] == "ez-template"]
draw_bars(axis, selected, LABELS)
axis.legend(loc="lower right", frameon=False)
figure.suptitle("EZ Template: main vs this PR", x=0.025, ha="left", fontsize=19)
figure.text(0.025, 0.89, "Seven-sample medians; whiskers show the full sample range.")
figure.text(
    0.025,
    0.025,
    "Intel i7-8700K · Bun 1.4.2 · WASM compilation · starter reuse disabled\n"
    "Real source/header edits change firmware and objects. Excludes startup, SDK mounting, network and UI.",
    fontsize=9,
    color="#4b5563",
)
figure.subplots_adjust(left=0.24, right=0.97, top=0.83, bottom=0.19)
save_chart(figure, "ez-template-vs-main")

figure, axes = plt.subplots(1, 2, figsize=(12, 6))
for axis, scenario, title in zip(
    axes, ["source-edit", "header-edit"], ["One-line source edits", "Header-only edits"]
):
    selected = [row for row in rows if row["scenario"] == scenario]
    draw_bars(axis, selected, NAMES)
    axis.set_title(title, loc="left", pad=16)
axes[1].legend(loc="lower right", frameon=False)
figure.suptitle("WASM builds: main vs this PR", x=0.025, ha="left", fontsize=19)
figure.text(
    0.025,
    0.89,
    "Seven samples per case; medians and full sample ranges. Lower is better.",
)
figure.text(
    0.025,
    0.025,
    "Intel i7-8700K · Bun 1.4.2 · changed firmware and main objects required · starter reuse disabled\n"
    "Compiler-only timings exclude initialization, SDK mounting, network and editor/UI. Panels use different scales.",
    fontsize=9,
    color="#4b5563",
)
figure.subplots_adjust(left=0.085, right=0.97, top=0.81, bottom=0.18, wspace=0.35)
save_chart(figure, "all-templates-vs-main")

table = "\n".join(
    f"| {row['name']} | {row['label']} | {row['baseline']['median']:.0f} | "
    f"{row['optimized']['median']:.0f} | {row['speedup']:.2f}× |"
    for row in rows
)
report = f"""# Comparison against main

The baseline is `origin/main` at `{before['baselineRevision']}`. Both sides were rerun sequentially on October 10, 2026, on an Intel Core i7-8700K with 32 GB RAM, Linux x64 and Bun 1.4.2. Seven samples per template and scenario. The baseline loads its own compiler adapter, package patch and SDK manifest from that exact revision. The optimized side uses this PR's implementation and prepared assets. Both use the same template sources and edit fixtures.

Each sample starts with a new filesystem and empty object cache. Starter-object reuse is disabled. The source edit changes one delay instruction; the header-only edit changes a consumed macro without changing the source. Every edited build must change both firmware and the compiled main object. Unchanged controls are excluded. Fresh workspace measurements can use validated cold SDK assets. They are not cold compiler startup measurements.

These are compiler-only WASM compile/link/package timings, excluding initialization, SDK mounting, network and editor/UI. Browser performance is measured separately on the real application routes in the [one-line edit report](../one-line-edits/report.md). Its final EZ worker medians were 713 ms for source edits and 919 ms for header edits, so sub-500-ms browser builds are not established. Sequential sampling and JIT variation limit small-difference claims.

| Template | Workload | main ms | PR ms | Speedup |
| --- | --- | ---: | ---: | ---: |
{table}

![EZ Template comparison](ez-template-vs-main.png)

![All template edit comparisons](all-templates-vs-main.png)

Raw records, phase spans and object hashes are preserved in [main samples](pr-main.json), [optimized samples](pr-optimized.json) and [summary with ranges](summary.json). Whiskers show minimum and maximum, not confidence intervals. SVG versions are available beside the PNG attachments.

Reproduce from the repository root:

```sh
BUILD_BASELINE_REV={before['baselineRevision']} BUILD_BENCH_SAMPLES=7 bun apps/code/scripts/benchmark-compiler-edits.ts pr-main
BUILD_BENCH_SAMPLES=7 bun apps/code/scripts/benchmark-compiler-edits.ts pr-optimized
python3 apps/code/scripts/report-compiler-main.py
```

Chart export requires Python with matplotlib. Compiler measurements use Bun. Run benchmarks sequentially with other builds and packaging stopped. See the [first-pass report](../report.md) and [second-pass report](../one-line-edits/report.md) for implementation, correctness checks, payload costs and remaining limitations.
"""
(DESTINATION / "report.md").write_text(report)
print(DESTINATION)
