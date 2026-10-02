import type { Position } from '@pierre/diffs/edit'

const keywords = new Set(
  'alignas alignof asm auto bool break case catch char char8_t char16_t char32_t class concept const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept nullptr operator private protected public register reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while'.split(
    ' ',
  ),
)

// Read lexical context from the document, not a highlight span: Pierre spans
// can contain entire comments or several words, and change during editing.
export function cppSymbolAt(text: string, position: Position): Position | null {
  const lines = text.split('\n')
  if (!lines[position.line]) return null
  const target =
    lines.slice(0, position.line).reduce((n, line) => n + line.length + 1, 0) +
    position.character
  for (let i = 0; i < text.length && i <= target;) {
    const start = i
    if (text.startsWith('//', i)) {
      i += 2
      // Backslash-newline continues a C++ line comment.
      while (i < text.length) {
        if (
          text[i] === '\n' &&
          text[i - 1] !== '\\' &&
          !(text[i - 1] === '\r' && text[i - 2] === '\\')
        )
          break
        i++
      }
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 2
    } else if (/^(?:u8|u|U|L)?R"/.test(text.slice(i, i + 5))) {
      const quote = text.indexOf('"', i)
      const opening = text.indexOf('(', quote + 1)
      if (opening < 0 || opening - quote > 17) i = text.length
      else {
        const closing = `)${text.slice(quote + 1, opening)}"`
        const end = text.indexOf(closing, opening + 1)
        i = end < 0 ? text.length : end + closing.length
      }
    } else if (/[0-9]/.test(text[i])) {
      i++
      while (i < text.length && /[\w.']/.test(text[i])) i++
    } else if (/^(?:u8|u|U|L)?["']/.test(text.slice(i, i + 4))) {
      while (text[i] !== '"' && text[i] !== "'") i++
      const quote = text[i++]
      while (i < text.length) {
        if (text[i] === '\\') i += 2
        else if (text[i++] === quote) break
      }
    } else if (/[a-zA-Z_]/.test(text[i])) {
      i++
      while (i < text.length && /[\w]/.test(text[i])) i++
      if (target < i) {
        if (keywords.has(text.slice(start, i))) return null
        return {
          line: position.line,
          character: position.character - (target - start),
        }
      }
    } else {
      i++
    }
    if (target < i) return null
  }
  return null
}
