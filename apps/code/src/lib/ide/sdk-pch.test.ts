import { expect, it } from 'bun:test'
import { templateFiles } from '../../../convex/template'
import { matchesSdkPchPrefix, sdkPchPrefix } from './sdk-pch'

it('keeps SDK prefixes eligible after project-header edits but rejects preprocessing changes', () => {
  for (const [template, files] of Object.entries(templateFiles)) {
    const prefix = sdkPchPrefix(files, template as keyof typeof templateFiles)
    const path = prefix.path.slice('/workspace/'.length)
    expect(matchesSdkPchPrefix(files, prefix)).toBe(true)
    expect(
      matchesSdkPchPrefix(
        { ...files, [path]: files[path] + '\n#define USER_VALUE 42\n' },
        prefix,
      ),
    ).toBe(true)
    expect(
      matchesSdkPchPrefix(
        { ...files, [path]: '#define USER_VALUE 42\n' + files[path] },
        prefix,
      ),
    ).toBe(false)
    expect(prefix.header).not.toContain('#define _PROS_MAIN_H_')
    expect(prefix.header).not.toContain('#ifndef _PROS_MAIN_H_')
    expect(prefix.header).not.toContain('#include "autons')
    expect(prefix.header).not.toContain('#include "robot-config.h"')
  }
  expect(matchesSdkPchPrefix({}, {})).toBe(false)
})
