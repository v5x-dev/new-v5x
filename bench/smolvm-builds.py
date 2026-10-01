"""Benchmark clean VEXcode, PROS, and EZ Template builds in a local SmolVM image."""

import argparse
from pathlib import Path
import re
import shutil
import statistics
import subprocess
import time

REPO = Path(__file__).resolve().parent.parent
ARTIFACT = REPO / '.build' / 'vexcode-v2.smolmachine'
PROJECTS = REPO / '.build' / 'smolvm-bench-projects'
RUNS = REPO / '.build' / 'smolvm-bench-runs'
TEMPLATES = ('vexcode', 'pros', 'ez-template')

GUEST_RUNNER = r'''set -eu
stage_start=$(awk '{print $1}' /proc/uptime)
case "$1" in
  pros) cp -a -n /opt/vex-build/pros-kernel-3.8.3/. /workspace/ ;;
  ez-template) cp -a -n /opt/vex-build/ez-template-3.2.2/. /workspace/ ;;
esac
stage_end=$(awk '{print $1}' /proc/uptime)
awk -v a="$stage_start" -v b="$stage_end" 'BEGIN {printf "TIMING setup %.2f\\n", b-a}'
stage_start=$(awk '{print $1}' /proc/uptime)
case "$1" in
  vexcode) make ;;
  pros|ez-template) make -j2 ;;
esac
stage_end=$(awk '{print $1}' /proc/uptime)
awk -v a="$stage_start" -v b="$stage_end" 'BEGIN {printf "TIMING compile %.2f\\n", b-a}'
'''


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--samples', type=int, default=3, help='clean runs per template (default: 3)')
    parser.add_argument('--template', choices=TEMPLATES, action='append', help='limit runs to this template; may be repeated')
    args = parser.parse_args()
    if args.samples < 1:
        parser.error('--samples must be at least 1')

    if not ARTIFACT.is_file():
        parser.error('local v2 artifact not found at .build/vexcode-v2.smolmachine')

    subprocess.run(
        ['bun', 'bench/prepare-smolvm-projects.ts'],
        cwd=REPO,
        check=True,
    )

    selected = args.template or TEMPLATES
    all_results = {}
    for template in selected:
        base = PROJECTS / template
        results = []
        for sample in range(1, args.samples + 1):
            project = RUNS / f'{template}-{sample}'
            if project.exists():
                shutil.rmtree(project)
            shutil.copytree(base, project)
            command = [
                'smolvm', 'machine', 'run', '--from', str(ARTIFACT),
                '--volume', f'{project}:/workspace', '--workdir', '/workspace',
                '--env', 'VEX_SDK_PATH=/sdk', '--', 'sh', '-c', GUEST_RUNNER,
                'bench', template,
            ]
            started = time.perf_counter()
            proc = subprocess.run(
                command,
                text=True,
                capture_output=True,
                timeout=180,
            )
            wall = time.perf_counter() - started
            output = proc.stdout + proc.stderr
            timings = {
                name: float(seconds)
                for name, seconds in re.findall(r'TIMING (setup|compile) ([0-9.]+)', output)
            }
            result = {'sample': sample, 'exit': proc.returncode, 'wall': wall, **timings}
            results.append(result)
            print(
                f'{template} sample {sample}: exit={proc.returncode} '
                f'wall={wall:.2f}s '
                f'setup={timings.get("setup", float("nan")):.2f}s '
                f'compile={timings.get("compile", float("nan")):.2f}s',
                flush=True,
            )
            if proc.returncode:
                print(output, flush=True)
                return proc.returncode
        all_results[template] = results

    print('\nSUMMARY (median [min, max])', flush=True)
    for template, results in all_results.items():
        print(template, end=': ', flush=True)
        for field in ('setup', 'compile', 'wall'):
            values = [result[field] for result in results]
            print(
                f'{field} {statistics.median(values):.2f}s '
                f'[{min(values):.2f}, {max(values):.2f}]',
                end='  ',
                flush=True,
            )
        print(flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
