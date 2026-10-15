import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"

const packageDir = resolve(
  process.argv[2] ??
    "/home/pingu/.cache/v5x/microbit-clang-wasm-21.11.0-alpha.1-reduced/microbit-clang-wasm/npmjs"
)
const assetsUrl = pathToFileURL(resolve(packageDir, "gen") + sep)
const { createSession, setAssetLoader } = await import(
  pathToFileURL(resolve(packageDir, "gen/bundle.js")).href
)

setAssetLoader((name) => readFile(new URL(name, assetsUrl)))

const session = createSession()
const source = `
class V5Motor {
 public:
  long position() const;
};

long V5Motor::position() const { return 42; }
volatile long result;

extern "C" void _start() {
  V5Motor motor;
  result = motor.position();
}
`

await session.writeFile("v5.cpp", source)
const compileFlags = [
  "--target=thumbv7-none-eabi",
  "-march=armv7-a",
  "-mfpu=neon",
  "-mfloat-abi=softfp",
  "-fshort-enums",
  "-fno-rtti",
  "-fno-exceptions",
  "-fno-threadsafe-statics",
  "-DVexV5",
  "-D__INT32_TYPE__=long",
  "-D__UINT32_TYPE__=unsigned long",
  "-std=gnu++11",
  "-c",
  "v5.cpp",
  "-o",
  "v5.o",
]

const compileStatus = await session.clang(["clang++", ...compileFlags])
assert.equal(compileStatus, 0, "V5 ABI C++ compilation succeeds")

const object = await session.readFile("v5.o")
assert.ok(object, "Clang produced an ARM object")
const objectView = new DataView(
  object.buffer,
  object.byteOffset,
  object.byteLength
)
assert.equal(objectView.getUint16(18, true), 40, "the object uses EM_ARM")
assert.equal(
  objectView.getUint32(36, true) >>> 24,
  5,
  "the object uses ARM EABI version 5"
)
assert.ok(
  new TextDecoder("latin1").decode(object).includes("_ZNK7V5Motor8positionEv"),
  "the object contains the expected Itanium C++ ABI symbol"
)

const linkStatus = await session.exec([
  "ld.lld",
  "-z",
  "norelro",
  "--gc-sections",
  "-e",
  "_start",
  "v5.o",
  "-o",
  "v5.elf",
])
assert.equal(linkStatus, 0, "LLD links the V5 ARM object")

const elf = await session.readFile("v5.elf")
assert.ok(elf, "LLD produced an executable")
assert.equal(elf[0], 0x7f, "the linked output is ELF")
assert.equal(
  new DataView(elf.buffer, elf.byteOffset, elf.byteLength).getUint16(18, true),
  40
)

console.log(
  `reduced compiler passed V5 C++ ABI smoke check (${object.byteLength} byte object, ${elf.byteLength} byte ELF)`
)
