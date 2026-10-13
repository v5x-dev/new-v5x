import type { ProjectTemplate } from './compile-commands'

export const sdkPchHeader = '/sdk/pch/prefix.hpp'

/** Preserve the exact preprocessing before the SDK, excluding the project guard. */
export function sdkPchPrefix(
  files: Record<string, string>,
  template: ProjectTemplate,
) {
  const vex = template === 'vexcode' || template === 'jar-template'
  const path = `/workspace/include/${vex ? 'vex.h' : 'main.h'}`
  const text = files[path.slice('/workspace/'.length)]
  const lastInclude = vex
    ? 'v5_vcs.h'
    : template === 'ez-template'
      ? 'EZ-Template/api.hpp'
      : 'api.h'
  const directive = `#include "${lastInclude}"`
  const end = text?.indexOf(directive) ?? -1
  if (end < 0) throw new Error(`Missing SDK prefix in ${path}`)
  const prefix = text.slice(0, end + directive.length) + '\n'
  const header = prefix.replace(
    /^\s*#(?:ifndef|define) _PROS_MAIN_H_\s*$/gm,
    '',
  )
  return { path, prefix, header }
}

export function matchesSdkPchPrefix(
  files: Record<string, string>,
  value: unknown,
): value is { path: string; prefix: string; header: string } {
  if (!value || typeof value !== 'object') return false
  const { path, prefix, header } = value as Record<string, unknown>
  return (
    (path === '/workspace/include/main.h' ||
      path === '/workspace/include/vex.h') &&
    typeof prefix === 'string' &&
    prefix.length > 0 &&
    typeof header === 'string' &&
    header.length > 0 &&
    Boolean(files[path.slice('/workspace/'.length)]?.startsWith(prefix))
  )
}
