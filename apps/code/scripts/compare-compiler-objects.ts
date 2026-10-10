/** Compare ELF objects by named sections and resolved symbols, not table ordering. */
export function compilerObjectIdentity(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (
    view.getUint32(0, false) !== 0x7f454c46 ||
    bytes[4] !== 1 ||
    bytes[5] !== 1 ||
    view.getUint16(18, true) !== 40
  )
    throw new Error('Expected ELF32 ARM object')
  const table = view.getUint32(32, true)
  const stride = view.getUint16(46, true)
  const count = view.getUint16(48, true)
  const sections = Array.from({ length: count }, (_, index) => {
    const header = table + index * stride
    return {
      nameOffset: view.getUint32(header, true),
      type: view.getUint32(header + 4, true),
      flags: view.getUint32(header + 8, true),
      offset: view.getUint32(header + 16, true),
      size: view.getUint32(header + 20, true),
      link: view.getUint32(header + 24, true),
      info: view.getUint32(header + 28, true),
      align: view.getUint32(header + 32, true),
      entrySize: view.getUint32(header + 36, true),
    }
  })
  const string = (section: (typeof sections)[number], offset: number) => {
    const start = section.offset + offset
    const end = bytes.indexOf(0, start)
    if (end < start || end >= section.offset + section.size)
      throw new Error('Invalid ELF name')
    return new TextDecoder().decode(bytes.subarray(start, end))
  }
  const names = sections[view.getUint16(50, true)]
  const sectionNames = sections.map((section) =>
    string(names, section.nameOffset),
  )
  const symbols = (index: number) => {
    const section = sections[index]
    return Array.from(
      { length: section.size / section.entrySize },
      (_, symbol) => {
        const offset = section.offset + symbol * section.entrySize
        const name = string(
          sections[section.link],
          view.getUint32(offset, true),
        )
        const sectionIndex = view.getUint16(offset + 14, true)
        return {
          name: /^\$[ad](?:\.|$)/.test(name) ? name.slice(0, 2) : name,
          section: sectionNames[sectionIndex] ?? sectionIndex,
          value: view.getUint32(offset + 4, true),
          size: view.getUint32(offset + 8, true),
          info: bytes[offset + 12],
          other: bytes[offset + 13],
        }
      },
    )
  }
  const sorted = (values: Array<unknown>) =>
    values.map((value) => JSON.stringify(value)).sort()
  return sorted(
    sections.flatMap((section, index) => {
      const name = sectionNames[index]
      if (section.type === 0 || section.type === 3) return []
      let contents: unknown
      if (section.type === 2) contents = sorted(symbols(index))
      else if (section.type === 9 || section.type === 4) {
        const targets = symbols(section.link)
        contents = sorted(
          Array.from(
            { length: section.size / section.entrySize },
            (_, entry) => {
              const offset = section.offset + entry * section.entrySize
              const info = view.getUint32(offset + 4, true)
              return {
                offset: view.getUint32(offset, true),
                type: info & 255,
                symbol: targets[info >>> 8],
                addend:
                  section.type === 4
                    ? view.getInt32(offset + 8, true)
                    : undefined,
              }
            },
          ),
        )
      } else if (section.type === 17) {
        contents = {
          symbol: symbols(section.link)[section.info],
          flags: view.getUint32(section.offset, true),
          members: Array.from(
            { length: section.size / 4 - 1 },
            (_, entry) =>
              sectionNames[
                view.getUint32(section.offset + (entry + 1) * 4, true)
              ],
          ).sort(),
        }
      } else if (name === '.llvm_addrsig') {
        const targets = symbols(section.link)
        const used = []
        let value = 0,
          shift = 0
        for (const byte of bytes.subarray(
          section.offset,
          section.offset + section.size,
        )) {
          value += (byte & 127) * 2 ** shift
          if (byte & 128) shift += 7
          else {
            used.push(targets[value])
            value = 0
            shift = 0
          }
        }
        contents = sorted(used)
      } else
        contents =
          section.type === 8
            ? section.size
            : Buffer.from(
                bytes.subarray(section.offset, section.offset + section.size),
              ).toString('hex')
      return [
        {
          name,
          type: section.type,
          flags: section.flags,
          align: section.align,
          linkedSection: section.link ? sectionNames[section.link] : undefined,
          targetSection:
            section.type === 9 || section.type === 4
              ? sectionNames[section.info]
              : undefined,
          contents,
        },
      ]
    }),
  )
}
