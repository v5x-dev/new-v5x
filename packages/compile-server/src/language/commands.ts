import { isAbsolute, join } from "node:path"
import type { CompileCommand } from "@v5x/compiler"
import {
  isRecord,
  physicalPath,
  roots,
  validateVirtualAbsolute,
  validateWorkspaceAbsolute,
} from "./paths"

export const maximumCommandBytes = 2 * 1024 * 1024
export const maximumCommands = 2000
const maximumArgumentsPerCommand = 256

export function validateCommands(value: unknown): Array<CompileCommand> {
  if (!Array.isArray(value) || value.length > maximumCommands)
    throw new Error("Invalid compilation database")
  let totalBytes = 0
  const commands = value.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.directory !== "string" ||
      typeof entry.file !== "string" ||
      !Array.isArray(entry.arguments) ||
      !entry.arguments.length ||
      entry.arguments.length > maximumArgumentsPerCommand ||
      entry.arguments.some(
        (argument: unknown) =>
          typeof argument !== "string" ||
          argument.length > 8192 ||
          argument.includes("\0")
      )
    )
      throw new Error("Invalid compilation database entry")

    totalBytes +=
      Buffer.byteLength(entry.directory) +
      Buffer.byteLength(entry.file) +
      entry.arguments.reduce(
        (size: number, argument: string) => size + Buffer.byteLength(argument),
        0
      )
    if (totalBytes > maximumCommandBytes)
      throw new Error("Compilation database exceeds the 2 MB language limit")

    return {
      directory: validateWorkspaceAbsolute(entry.directory),
      file: validateWorkspaceAbsolute(entry.file),
      arguments: validateArguments(entry.arguments),
    }
  })
  return commands
}

export function rewriteCompileCommand(
  command: CompileCommand,
  root: string
): CompileCommand {
  const directory = physicalPath(root, command.directory)
  const file = physicalPath(root, command.file)
  const arguments_ = command.arguments.map((argument) =>
    rewriteArgumentPaths(argument, root)
  )
  arguments_[0] = "clang"
  return { directory, file, arguments: arguments_ }
}

export function validateArguments(arguments_: Array<string>) {
  const blocked = [
    /^@/,
    /^-fplugin(?:=|$)/,
    /^-fplugin-arg-/,
    /^-plugin(?:=|$)/,
    /^--?load(?:=|$)/,
    /^-specs(?:=|$)/,
    /^-wrapper(?:=|$)/,
    /^-ivfsoverlay(?:=|$)/,
    /^-include-pch(?:=|$)/,
    /^-fmodule-file(?:=|$)/,
    /^--config(?:-|=|$)/,
    /^--gcc-toolchain(?:=|$)/,
    /^-gcc-toolchain(?:=|$)/,
  ]
  if (
    arguments_.some((argument) =>
      blocked.some((pattern) => pattern.test(argument))
    )
  )
    throw new Error(
      "Compilation database contains an unsupported compiler option"
    )

  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index]
    if (
      argument === "-Xclang" &&
      ["-load", "-plugin", "-ivfsoverlay", "-fplugin"].includes(
        arguments_[index + 1] ?? ""
      )
    )
      throw new Error(
        "Compilation database contains an unsupported compiler option"
      )
    if (argument === "-B")
      throw new Error(
        "Compiler search paths are not allowed in the language service"
      )

    const pathValue = pathOptionValue(argument, arguments_[index + 1])
    if (pathValue) validateCompilePath(pathValue.value)
    if (pathValue?.consumesNext) index++
  }
  return arguments_
}

const separatedPathOptions = new Set([
  "-I",
  "-F",
  "-isystem",
  "-iquote",
  "-idirafter",
  "-isystem-after",
  "-iframework",
  "-iframeworkwithsysroot",
  "-stdlib++-isystem",
  "-include",
  "-imacros",
  "-resource-dir",
  "--sysroot",
  "-isysroot",
  "-fmodule-map-file",
  "-fprofile-instr-use",
  "-fprofile-sample-use",
  "-fprofile-remapping-file",
  "-fcoverage-compilation-dir",
  "-fprebuilt-module-path",
  "-fmodules-user-build-path",
  "-fmodules-cache-path",
  "-working-directory",
  "-o",
])

export function pathOptionValue(argument: string, next: string | undefined) {
  if (separatedPathOptions.has(argument)) {
    if (!next) throw new Error("Compiler path option has no value")
    return { value: next, consumesNext: true }
  }
  for (const option of separatedPathOptions) {
    if (argument.startsWith(option + "=") && option !== "-o")
      return { value: argument.slice(option.length + 1), consumesNext: false }
    if (
      [
        "-I",
        "-F",
        "-isystem",
        "-iquote",
        "-idirafter",
        "-isystem-after",
        "-iframeworkwithsysroot",
        "-iframework",
        "-stdlib++-isystem",
        "-include",
        "-imacros",
      ].some(
        (prefix) =>
          argument.startsWith(prefix) && argument.length > prefix.length
      )
    ) {
      const prefix = [
        "-isystem-after",
        "-iframeworkwithsysroot",
        "-stdlib++-isystem",
        "-isystem",
        "-idirafter",
        "-iquote",
        "-include",
        "-imacros",
        "-iframework",
        "-I",
        "-F",
      ].find((item) => argument.startsWith(item))!
      return { value: argument.slice(prefix.length), consumesNext: false }
    }
  }
  return undefined
}

export function validateCompilePath(value: string) {
  if (!value || value.includes("\0") || value.includes("\\"))
    throw new Error("Invalid compiler path")
  if (isAbsolute(value)) {
    validateVirtualAbsolute(value)
    return
  }
  if (value.split("/").some((part) => part === ".." || part === "."))
    throw new Error("Compiler paths must stay inside the project workspace")
}

export function rewriteArgumentPaths(argument: string, root: string) {
  if (argument.includes("\0") || argument.includes("\\"))
    throw new Error("Invalid compiler argument")
  for (const virtualRoot of roots) {
    const path = `/${virtualRoot}`
    if (argument === path || argument.startsWith(path + "/"))
      return join(root, argument.slice(1))
    for (const option of [
      "-isystem",
      "-idirafter",
      "-iquote",
      "-include",
      "-imacros",
      "-I",
    ])
      if (argument.startsWith(option + path))
        return option + join(root, argument.slice(option.length + 1))
  }
  for (const virtualRoot of roots) {
    const pattern = new RegExp(`(^|[=,:])/${virtualRoot}(?=/|$)`, "g")
    argument = argument.replace(pattern, (_match, prefix: string) => {
      const virtual = `/${virtualRoot}`
      return prefix + join(root, virtual.slice(1))
    })
  }
  return argument
}
