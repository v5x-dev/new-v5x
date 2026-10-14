#!/usr/bin/env bun
import { parseArgs } from "node:util"
import { homedir } from "node:os"
import { join } from "node:path"
import { readFile } from "node:fs/promises"
import { createCompileServer } from "./server"

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "8787" },
    token: { type: "string" },
    origin: { type: "string", multiple: true },
    "assets-url": { type: "string", default: "https://code.v5x.dev" },
    "cache-dir": {
      type: "string",
      default: join(homedir(), ".cache", "v5x-compile-server"),
    },
    cert: { type: "string" },
    key: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
})

if (values.help) {
  console.log(`Usage: bunx @v5x/compile-server [options]

  --host <address>      Bind address, default 127.0.0.1. Use 0.0.0.0 for LAN access.
  --port <port>         Port, default 8787
  --origin <url>        Allow another app origin. Repeat for multiple origins.
  --assets-url <url>    Compiler/SDK host, default https://code.v5x.dev
  --cache-dir <path>    Verified compiler and SDK download cache
  --token <token>       Reuse a token of at least 16 characters
  --cert <path>         TLS certificate for wss:// connections
  --key <path>          TLS private key, required with --cert

Paste the printed WebSocket URL into code's Compilation server settings.`)
  process.exit(0)
}

const port = Number(values.port)
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid port")
if (Boolean(values.cert) !== Boolean(values.key))
  throw new Error("Provide both --cert and --key")
const assetsUrl = new URL(values["assets-url"]!)
if (!["http:", "https:"].includes(assetsUrl.protocol))
  throw new Error("Invalid asset server URL")
const origins = ["https://code.v5x.dev", ...(values.origin ?? [])].map(
  (value) => new URL(value).origin
)
const token =
  values.token ??
  process.env.V5X_COMPILE_TOKEN ??
  crypto.randomUUID().replaceAll("-", "")
const tls =
  values.cert && values.key
    ? {
        cert: await readFile(values.cert, "utf8"),
        key: await readFile(values.key, "utf8"),
      }
    : undefined
const running = createCompileServer({
  hostname: values.host!,
  port,
  token,
  origins,
  assetsUrl: assetsUrl.href,
  cacheDirectory: values["cache-dir"]!,
  tls,
})
const host =
  values.host === "0.0.0.0" || values.host === "::"
    ? "<server-host>"
    : values.host
console.log(
  `v5x compilation server listening on ${values.host}:${running.server.port}`
)
console.log(
  `${tls ? "wss" : "ws"}://${host}:${running.server.port}/compile?token=${token}`
)
console.log(
  "The first build downloads and caches the compiler and SDK. Ctrl+C to stop."
)
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    running.stop()
    process.exit(0)
  })
