/** GNU objcopy -O binary semantics for the little-endian ELF32 ARM output. */
export function elfToBinary(
  bytes: Uint8Array,
  omit = new Set<string>(),
  loadAddress = 0x03800000,
): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const range = (offset: number, length: number) => {
    if (offset < 0 || length < 0 || offset + length > bytes.length)
      throw new Error('Truncated ARM ELF')
  }
  range(0, 52)
  if (
    view.getUint32(0, false) !== 0x7f454c46 ||
    bytes[4] !== 1 ||
    bytes[5] !== 1 ||
    view.getUint16(18, true) !== 40
  )
    throw new Error('Expected a little-endian ELF32 ARM executable')
  const programOffset = view.getUint32(28, true)
  const programSize = view.getUint16(42, true)
  const programCount = view.getUint16(44, true)
  const sectionOffset = view.getUint32(32, true)
  const sectionSize = view.getUint16(46, true)
  const sectionCount = view.getUint16(48, true)
  const namesIndex = view.getUint16(50, true)
  if (programSize < 32 || sectionSize < 40 || namesIndex >= sectionCount)
    throw new Error('Invalid ARM ELF tables')
  range(programOffset, programSize * programCount)
  range(sectionOffset, sectionSize * sectionCount)
  const namesHeader = sectionOffset + namesIndex * sectionSize
  const namesOffset = view.getUint32(namesHeader + 16, true)
  const namesLength = view.getUint32(namesHeader + 20, true)
  range(namesOffset, namesLength)
  const names = bytes.subarray(namesOffset, namesOffset + namesLength)
  const sections: Array<{ address: number; offset: number; length: number }> =
    []
  for (let index = 0; index < sectionCount; index++) {
    const header = sectionOffset + index * sectionSize
    const type = view.getUint32(header + 4, true)
    const flags = view.getUint32(header + 8, true)
    const offset = view.getUint32(header + 16, true)
    const length = view.getUint32(header + 20, true)
    if (!(flags & 2) || type === 8 || !length) continue
    const nameOffset = view.getUint32(header, true)
    if (nameOffset >= names.length) throw new Error('Invalid ELF section name')
    const nameEnd = names.indexOf(0, nameOffset)
    if (nameEnd < 0) throw new Error('Invalid ELF section name')
    const name = new TextDecoder().decode(names.subarray(nameOffset, nameEnd))
    if (omit.has(name)) continue
    range(offset, length)
    let address = view.getUint32(header + 12, true)
    for (let program = 0; program < programCount; program++) {
      const entry = programOffset + program * programSize
      if (view.getUint32(entry, true) !== 1) continue
      const start = view.getUint32(entry + 4, true)
      const size = view.getUint32(entry + 16, true)
      if (offset >= start && offset + length <= start + size) {
        address = view.getUint32(entry + 12, true) + offset - start
        break
      }
    }
    sections.push({ address, offset, length })
  }
  if (!sections.length) throw new Error('ARM ELF has no loadable sections')
  const start = Math.min(...sections.map((section) => section.address))
  const end = Math.max(
    ...sections.map((section) => section.address + section.length),
  )
  if (
    start !== loadAddress ||
    end - start > (loadAddress === 0x07800000 ? 8 : 72) * 1024 * 1024
  )
    throw new Error('ARM ELF has an invalid V5 load address or size')
  const output = new Uint8Array(end - start)
  for (const section of sections)
    output.set(
      bytes.subarray(section.offset, section.offset + section.length),
      section.address - start,
    )
  return output
}

/** Hide per-program symbols from the cold ELF without changing loadable bytes. */
export function stripElfSymbols(
  bytes: Uint8Array,
  omit: Set<string>,
): Uint8Array {
  const output = bytes.slice()
  const view = new DataView(output.buffer)
  const range = (offset: number, length: number) => {
    if (offset < 0 || length < 0 || offset + length > output.length)
      throw new Error('Truncated ARM ELF symbol table')
  }
  range(0, 52)
  const table = view.getUint32(32, true)
  const size = view.getUint16(46, true)
  const count = view.getUint16(48, true)
  if (size < 40) throw new Error('Invalid ARM ELF section table')
  range(table, size * count)
  for (let index = 0; index < count; index++) {
    const header = table + size * index
    if (view.getUint32(header + 4, true) !== 2) continue
    const offset = view.getUint32(header + 16, true)
    const length = view.getUint32(header + 20, true)
    const namesIndex = view.getUint32(header + 24, true)
    const entrySize = view.getUint32(header + 36, true)
    if (namesIndex >= count || entrySize < 16 || length % entrySize)
      throw new Error('Invalid ARM ELF symbol table')
    range(offset, length)
    const namesHeader = table + namesIndex * size
    const namesOffset = view.getUint32(namesHeader + 16, true)
    const namesLength = view.getUint32(namesHeader + 20, true)
    range(namesOffset, namesLength)
    const names = output.subarray(namesOffset, namesOffset + namesLength)
    for (let symbol = offset; symbol < offset + length; symbol += entrySize) {
      const nameOffset = view.getUint32(symbol, true)
      if (nameOffset >= names.length) throw new Error('Invalid ELF symbol name')
      const end = names.indexOf(0, nameOffset)
      if (end < 0) throw new Error('Invalid ELF symbol name')
      const name = new TextDecoder().decode(names.subarray(nameOffset, end))
      // GNU ld lets hot objects override absolute symbols imported with -R.
      // LLD needs weak imported definitions to provide the same precedence.
      if (output[symbol + 12] >>> 4 === 1)
        output[symbol + 12] = 0x20 | (output[symbol + 12] & 0x0f)
      // Preserve table ordering while making per-program symbols undefined.
      if (omit.has(name)) {
        view.setUint32(symbol + 4, 0, true)
        view.setUint32(symbol + 8, 0, true)
        view.setUint16(symbol + 14, 0, true)
      }
    }
  }
  return output
}
