export interface CompilerPlan {
  driver: Array<string>
  frontend: Array<string>
}

function paths(argv: Array<string>, source: string, object: string) {
  return argv.map((arg) =>
    arg === source
      ? '$SOURCE'
      : arg === object
        ? '$OBJECT'
        : arg === object + '.d'
          ? '$DEPFILE'
          : arg,
  )
}

/** Plans come from this exact Clang driver's -### output, never handwritten cc1 flags. */
export function compilerPlan(
  driver: Array<string>,
  output: string,
  source: string,
  object: string,
): CompilerPlan | undefined {
  const lines = output.split('\n').filter((line) => line.startsWith(' "'))
  if (lines.length !== 1 || /(?:warning|error):/.test(output)) return undefined
  const tokens = Array.from(
    lines[0].matchAll(/ "((?:[^"\\]|\\["\\$])*)"/g),
    (match) => match[1].replace(/\\(["\\$])/g, '$1'),
  )
  if (tokens[0] === '') tokens.shift()
  if (
    tokens[0] !== 'clang' ||
    tokens[1] !== '-cc1' ||
    !tokens.includes(source) ||
    !tokens.includes(object) ||
    tokens.some((arg) => /^\/?tmp\//.test(arg))
  )
    return undefined
  const frontend = paths(tokens, source, object).map((arg, index) =>
    tokens[index - 1] === '-main-file-name' ? '$BASENAME' : arg,
  )
  return { driver: paths(driver, source, object), frontend }
}

export function plannedCompilerCommand(
  plans: Array<CompilerPlan>,
  argv: Array<string>,
  source: string,
  object: string,
) {
  const identity = JSON.stringify(paths(argv, source, object))
  const plan = plans.find(
    (candidate) => JSON.stringify(candidate.driver) === identity,
  )
  if (!plan || plan.frontend[0] !== 'clang' || plan.frontend[1] !== '-cc1')
    return undefined
  return plan.frontend.map((arg) =>
    arg === '$SOURCE'
      ? source
      : arg === '$OBJECT'
        ? object
        : arg === '$DEPFILE'
          ? object + '.d'
          : arg === '$BASENAME'
            ? source.split('/').at(-1)!
            : arg,
  )
}
