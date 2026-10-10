import { expect, it } from 'bun:test'
import { compilerPlan, plannedCompilerCommand } from './compiler-plan'

it('replays compiler-generated arguments for edited and newly added sources with their own dependency targets', () => {
  const source = '/workspace/src/main.cpp'
  const object = '/workspace/.browser-build/src/main.cpp.o'
  const argv = [
    'clang',
    '-c',
    source,
    '-o',
    object,
    '-MD',
    '-MF',
    object + '.d',
  ]
  const output = `clang version 21\n (in-process)\n "" "clang" "-cc1" "-main-file-name" "main.cpp" "-D" "TEXT=\\"hello\\"" "-o" "${object}" "-dependency-file" "${object}.d" "-MT" "${object}" "${source}"\n`
  const plan = compilerPlan(argv, output, source, object)!
  expect(plan).toBeDefined()
  const editedSource = '/workspace/src/nested/other.cpp'
  const editedObject = '/workspace/.browser-build/src/nested/other.cpp.o'
  const command = plannedCompilerCommand(
    [plan],
    argv.map((arg) =>
      arg.replaceAll(source, editedSource).replaceAll(object, editedObject),
    ),
    editedSource,
    editedObject,
  )!
  expect(command).toContain('other.cpp')
  expect(command).toContain(editedSource)
  expect(command).toContain(editedObject + '.d')
  expect(command).toContain('TEXT="hello"')
  expect(command).not.toContain(source)
  expect(
    plannedCompilerCommand([plan], [...argv, '-DCHANGED=1'], source, object),
  ).toBeUndefined()
  expect(
    compilerPlan(argv, output + 'warning: changed\n', source, object),
  ).toBeUndefined()
  expect(
    compilerPlan(argv, output + ' "" "ld.lld"\n', source, object),
  ).toBeUndefined()
})
