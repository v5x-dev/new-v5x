/** Named storage and relocations make metadata patching independent of compiler offsets. */
export const timestampSource =
  'const int _PROS_COMPILE_TIMESTAMP_INT = 0;\n' +
  'static const char v5x_timestamp_text[21] = "Jan  1 1970 00:00:00";\n' +
  'static const char v5x_directory_text[11] = "/workspace";\n' +
  'const char * const _PROS_COMPILE_TIMESTAMP = v5x_timestamp_text;\n' +
  'const char * const _PROS_COMPILE_DIRECTORY = v5x_directory_text;\n'

export function timestampArguments(source: string, object: string) {
  return [
    'clang',
    '--target=arm-none-eabi',
    '-mcpu=cortex-a9',
    '-marm',
    '-mfpu=neon-fp16',
    '-mfloat-abi=softfp',
    '-c',
    source,
    '-o',
    object,
  ]
}

export function formatBuildTimestamp(date: Date) {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  const two = (value: number) => String(value).padStart(2, '0')
  return `${months[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, ' ')} ${date.getUTCFullYear()} ${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())}`
}

export function patchBuildMetadata(
  template: Uint8Array,
  date = new Date(),
): Uint8Array | undefined {
  try {
    const bytes = template.slice()
    const view = new DataView(bytes.buffer)
    const epoch = Math.floor(date.getTime() / 1000)
    if (
      !Number.isSafeInteger(epoch) ||
      epoch < 0 ||
      epoch > 0x7fffffff ||
      bytes.length < 52 ||
      view.getUint32(0, false) !== 0x7f454c46 ||
      bytes[4] !== 1 ||
      bytes[5] !== 1 ||
      view.getUint16(16, true) !== 1 ||
      view.getUint16(18, true) !== 40
    )
      return undefined
    const table = view.getUint32(32, true)
    const stride = view.getUint16(46, true)
    const count = view.getUint16(48, true)
    if (
      stride !== 40 ||
      !count ||
      count > 256 ||
      table + count * stride > bytes.length
    )
      return undefined
    const sections = Array.from({ length: count }, (_, index) => {
      const header = table + index * stride
      const offset = view.getUint32(header + 16, true),
        size = view.getUint32(header + 20, true)
      const type = view.getUint32(header + 4, true)
      if (type !== 8 && offset + size > bytes.length)
        throw new Error('Section exceeds object')
      return {
        offset,
        size,
        type,
        link: view.getUint32(header + 24, true),
        info: view.getUint32(header + 28, true),
        entry: view.getUint32(header + 36, true),
      }
    })
    const symtabIndex = sections.findIndex((section) => section.type === 2)
    if (symtabIndex < 0) return undefined
    const symtab = sections.at(symtabIndex)
    const strings = symtab ? sections.at(symtab.link) : undefined
    if (
      !symtab ||
      symtab.entry !== 16 ||
      symtab.size % 16 ||
      !strings ||
      strings.type !== 3
    )
      return undefined
    const symbols = Array.from({ length: symtab.size / 16 }, (_, index) => {
      const offset = symtab.offset + index * 16
      const nameOffset = view.getUint32(offset, true)
      if (nameOffset >= strings.size) throw new Error('Invalid symbol name')
      const start = strings.offset + nameOffset
      const end = bytes.indexOf(0, start)
      if (end < start || end >= strings.offset + strings.size)
        throw new Error('Invalid symbol string')
      return {
        name: new TextDecoder().decode(bytes.subarray(start, end)),
        value: view.getUint32(offset + 4, true),
        size: view.getUint32(offset + 8, true),
        section: view.getUint16(offset + 14, true),
      }
    })
    const locate = (name: string, size: number) => {
      const matching = symbols.filter((symbol) => symbol.name === name)
      if (matching.length !== 1 || matching[0].size !== size)
        throw new Error('Metadata symbol mismatch')
      const symbol = matching[0],
        section = sections.at(symbol.section)
      if (
        !symbol.section ||
        !section ||
        section.type === 8 ||
        symbol.value + size > section.size
      )
        throw new Error('Invalid metadata storage')
      return { ...symbol, offset: section.offset + symbol.value }
    }
    const integer = locate('_PROS_COMPILE_TIMESTAMP_INT', 4)
    const text = locate('v5x_timestamp_text', 21)
    const directory = locate('v5x_directory_text', 11)
    const checkPointer = (name: string, target: typeof text) => {
      const pointer = locate(name, 4)
      const relocations = sections.filter(
        (section) =>
          section.type === 9 &&
          section.info === pointer.section &&
          section.link === symtabIndex,
      )
      const matches: Array<number> = []
      for (const section of relocations) {
        if (section.entry !== 8 || section.size % 8)
          throw new Error('Invalid relocation table')
        for (
          let offset = section.offset;
          offset < section.offset + section.size;
          offset += 8
        ) {
          if (view.getUint32(offset, true) === pointer.value)
            matches.push(view.getUint32(offset + 4, true))
        }
      }
      if (matches.length !== 1 || (matches[0] & 255) !== 2)
        throw new Error('Metadata pointer relocation mismatch')
      const symbol = symbols.at(matches[0] >>> 8)
      if (
        !symbol ||
        symbol.section !== target.section ||
        symbol.value + view.getUint32(pointer.offset, true) !== target.value
      )
        throw new Error('Metadata pointer target mismatch')
    }
    checkPointer('_PROS_COMPILE_TIMESTAMP', text)
    checkPointer('_PROS_COMPILE_DIRECTORY', directory)
    if (
      new TextDecoder().decode(
        bytes.subarray(directory.offset, directory.offset + 11),
      ) !== '/workspace\0'
    )
      return undefined
    const timestamp = new TextEncoder().encode(
      formatBuildTimestamp(date) + '\0',
    )
    if (timestamp.length !== 21) return undefined
    view.setInt32(integer.offset, epoch, true)
    bytes.set(timestamp, text.offset)
    return bytes
  } catch {
    return undefined
  }
}
