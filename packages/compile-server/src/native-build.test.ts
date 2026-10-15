import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { templateFiles } from "../../../apps/code/convex/template"
import { NativeCompiler } from "./native-build"
import type {
  BrowserBuildInput,
  BrowserBuildResult,
} from "@v5x/compiler/browser-build"

const input: BrowserBuildInput = {
  template: "vexcode",
  commitSha: "native-build-test",
  files: { "src/main.cpp": "int main() { return 0; }\n" },
}

function artifactDigests(result: BrowserBuildResult) {
  return result.artifacts.map(({ path, bytes }) => [
    path,
    Bun.CryptoHasher.hash("sha256", bytes, "hex"),
  ])
}

test("an aborted build exits before loading the native toolchain", async () => {
  const compiler = new NativeCompiler({
    assetsUrl: "http://127.0.0.1:1",
    cacheDirectory: "/tmp/v5x-native-build-test-cache",
  })
  try {
    await expect(
      compiler.build(input, () => {}, AbortSignal.abort())
    ).rejects.toMatchObject({ name: "AbortError", message: "Build cancelled" })
  } finally {
    await compiler.dispose()
  }
})

test("a disposed native compiler rejects new builds", async () => {
  const compiler = new NativeCompiler({
    assetsUrl: "http://127.0.0.1:1",
    cacheDirectory: "/tmp/v5x-native-build-test-cache",
  })
  await compiler.dispose()
  await expect(compiler.build(input, () => {})).rejects.toThrow(
    "Native compiler has been disposed"
  )
})

test("a missing native toolchain reports how to configure it", async () => {
  const compiler = new NativeCompiler({
    assetsUrl: "http://127.0.0.1:1",
    cacheDirectory: "/tmp/v5x-native-build-test-cache",
    toolchainDirectory: "/missing-v5x-native-toolchain",
  })
  try {
    await expect(compiler.build(input, () => {})).rejects.toThrow(
      "Pass a valid toolchainDirectory or set V5X_NATIVE_TOOLCHAIN"
    )
  } finally {
    await compiler.dispose()
  }
})

test("native toolchain checks use a clean sandbox environment", async () => {
  const fixtureDirectory = await mkdtemp(
    join(tmpdir(), "v5x-native-clean-env-")
  )
  const toolchainDirectory = join(fixtureDirectory, "toolchain")
  const shimDirectory = join(fixtureDirectory, "bin")
  const capturePath = join(fixtureDirectory, "token-checks")
  const previousPath = process.env.PATH
  const previousToken = process.env.V5X_COMPILE_TOKEN

  await mkdir(join(toolchainDirectory, "bin"), { recursive: true })
  await mkdir(join(toolchainDirectory, "lib", "clang", "21"), {
    recursive: true,
  })
  await mkdir(shimDirectory)
  await writeFile(join(toolchainDirectory, "bin", "clang"), "", {
    mode: 0o755,
  })
  await writeFile(join(toolchainDirectory, "bin", "ld.lld"), "", {
    mode: 0o755,
  })
  await writeFile(
    join(shimDirectory, "bwrap"),
    `#!/bin/sh
printf '%s\\n' "\${V5X_COMPILE_TOKEN-unset}" >> '${capturePath}'
clearenv=0
home=0
tmpdir=0
path=0
lang=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --clearenv) clearenv=1 ;;
    --setenv)
      case "$2:$3" in
        HOME:/tmp) home=1 ;;
        TMPDIR:/tmp) tmpdir=1 ;;
        PATH:/opt/v5x-toolchain/bin:/usr/bin) path=1 ;;
        LANG:C.UTF-8) lang=1 ;;
        *) exit 91 ;;
      esac
      shift 2
      ;;
    /opt/v5x-toolchain/bin/clang)
      [ "$clearenv:$home:$tmpdir:$path:$lang" = "1:1:1:1:1" ] || exit 92
      printf '%s\\n' 'clang version 21.1.1' 'Arm Toolchain ID: E0058 (1bbd3573)'
      exit 0
      ;;
    /opt/v5x-toolchain/bin/ld.lld)
      [ "$clearenv:$home:$tmpdir:$path:$lang" = "1:1:1:1:1" ] || exit 92
      printf '%s\\n' 'LLD 21.1.1'
      exit 0
      ;;
  esac
  shift
done
exit 93
`,
    { mode: 0o755 }
  )

  try {
    process.env.PATH = `${shimDirectory}:${previousPath ?? "/usr/bin:/bin"}`
    process.env.V5X_COMPILE_TOKEN = "native-build-test-token"
    const compiler = new NativeCompiler({
      assetsUrl: "http://127.0.0.1:1",
      cacheDirectory: fixtureDirectory,
      toolchainDirectory,
    })
    try {
      await expect(compiler.build(input, () => {})).rejects.toThrow()
      expect(await Bun.file(capturePath).text()).toBe("unset\nunset\n")
    } finally {
      await compiler.dispose()
    }
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousToken === undefined) delete process.env.V5X_COMPILE_TOKEN
    else process.env.V5X_COMPILE_TOKEN = previousToken
    await rm(fixtureDirectory, { recursive: true, force: true })
  }
})

if (Bun.env.V5X_NATIVE_INTEGRATION === "1") {
  test("builds all four templates with the pinned native toolchain", async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), "v5x-native-cache-"))
    const compiler = new NativeCompiler({
      assetsUrl: Bun.env.V5X_NATIVE_ASSETS_URL ?? "http://localhost:3002",
      cacheDirectory,
      toolchainDirectory: Bun.env.V5X_NATIVE_TOOLCHAIN,
    })
    try {
      for (const template of [
        "vexcode",
        "pros",
        "ez-template",
        "jar-template",
      ] as const) {
        const templateInput = {
          ...input,
          template,
          files: templateFiles[template],
        }
        const result = await compiler.build(templateInput, () => {})
        expect(result.exitCode, result.output).toBe(0)
        expect(result.artifacts.length).toBeGreaterThan(0)
        expect(
          result.artifacts.every(({ bytes }) => bytes.byteLength > 0)
        ).toBe(true)
        if (template === "vexcode") {
          const repeated = await compiler.build(templateInput, () => {})
          expect(artifactDigests(repeated)).toEqual(artifactDigests(result))
        }
      }

      const symlinkDirectory = await mkdtemp(
        join(tmpdir(), "v5x-native-toolchain-link-")
      )
      const toolchainLink = join(symlinkDirectory, "toolchain")
      const replacementDirectory = join(symlinkDirectory, "replacement")
      await mkdir(replacementDirectory)
      await symlink(Bun.env.V5X_NATIVE_TOOLCHAIN!, toolchainLink)
      const symlinkCompiler = new NativeCompiler({
        assetsUrl: Bun.env.V5X_NATIVE_ASSETS_URL ?? "http://localhost:3002",
        cacheDirectory,
        toolchainDirectory: toolchainLink,
      })
      try {
        const symlinkInput = {
          ...input,
          template: "vexcode" as const,
          files: templateFiles.vexcode,
          workspaceId: "native-toolchain-symlink-before-replacement",
        }
        const firstResult = await symlinkCompiler.build(symlinkInput, () => {})
        expect(firstResult.exitCode, firstResult.output).toBe(0)

        await rm(toolchainLink)
        await symlink(replacementDirectory, toolchainLink)
        const secondResult = await symlinkCompiler.build(
          {
            ...symlinkInput,
            workspaceId: "native-toolchain-symlink-after-replacement",
          },
          () => {}
        )
        expect(secondResult.exitCode, secondResult.output).toBe(0)
      } finally {
        await symlinkCompiler.dispose()
        await rm(symlinkDirectory, { recursive: true, force: true })
      }
    } finally {
      await compiler.dispose()
      await rm(cacheDirectory, { recursive: true, force: true })
    }
  }, 180_000)
}
