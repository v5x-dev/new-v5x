import type { WorkspaceProblem } from '~/components/ide/workspace-panels'

/** Parse clang diagnostics, preserving colons in paths and messages. */
export function parseBuildProblems(output: string): Array<WorkspaceProblem> {
  const problems: Array<WorkspaceProblem> = []
  // ANSI colors are control sequences emitted by clang.
  // eslint-disable-next-line no-control-regex
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '')

  for (const line of clean.split(/\r?\n/)) {
    const match =
      /^(.*?):(\d+):(\d+):\s*(fatal error|error|warning):\s*(.*)$/.exec(line)
    if (!match || Number(match[2]) < 1 || Number(match[3]) < 1) continue
    const position = {
      line: Number(match[2]) - 1,
      character: Number(match[3]) - 1,
    }
    const path = match[1].replace(/^\/workspace\//, '').replace(/^\.\//, '')
    problems.push({
      path,
      diagnostic: {
        range: {
          start: position,
          end: { ...position, character: position.character + 1 },
        },
        severity: match[4] === 'warning' ? 2 : 1,
        source: 'build',
        message: match[5],
      },
    })
  }

  return problems
}
