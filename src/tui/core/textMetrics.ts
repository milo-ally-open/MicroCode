import { eastAsianWidth } from 'get-east-asian-width'

export interface TerminalTextToken {
  type: 'ansi' | 'text'
  value: string
}

const ESC = '\u001b'
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const combiningOrFormat = /[\p{M}\p{Cf}]/u
const extendedPictographic = /\p{Extended_Pictographic}/u

function readEscapeSequence(text: string, start: number): string | undefined {
  if (text[start] !== ESC || start + 1 >= text.length) return undefined

  const introducer = text[start + 1]
  if (introducer === '[') {
    for (let index = start + 2; index < text.length; index++) {
      const code = text.charCodeAt(index)
      if (code >= 0x40 && code <= 0x7e) return text.slice(start, index + 1)
    }
    return text.slice(start)
  }

  if (introducer === ']') {
    for (let index = start + 2; index < text.length; index++) {
      if (text[index] === '\u0007') return text.slice(start, index + 1)
      if (text[index] === ESC && text[index + 1] === '\\') return text.slice(start, index + 2)
    }
    return text.slice(start)
  }

  if (introducer === '_' || introducer === 'P' || introducer === 'X' || introducer === '^') {
    for (let index = start + 2; index < text.length; index++) {
      if (text[index] === '\u0007') return text.slice(start, index + 1)
      if (text[index] === ESC && text[index + 1] === '\\') return text.slice(start, index + 2)
    }
    return text.slice(start)
  }

  return text.slice(start, start + 2)
}

/** Split ANSI control sequences from printable text without stripping color styles. */
export function* tokenizeTerminalText(text: string): Generator<TerminalTextToken> {
  let cursor = 0
  while (cursor < text.length) {
    if (text[cursor] === ESC) {
      const sequence = readEscapeSequence(text, cursor)
      if (sequence) {
        yield { type: 'ansi', value: sequence }
        cursor += sequence.length
        continue
      }
    }

    let nextEscape = text.indexOf(ESC, cursor)
    if (nextEscape < 0) nextEscape = text.length
    if (nextEscape === cursor) nextEscape++
    yield { type: 'text', value: text.slice(cursor, nextEscape) }
    cursor = nextEscape
  }
}

/** Width of one grapheme cluster in terminal columns. Ambiguous characters default to narrow. */
export function graphemeWidth(grapheme: string): number {
  if (!grapheme || grapheme === '\n' || grapheme === '\r') return 0
  if (grapheme.includes('\u20e3') || extendedPictographic.test(grapheme)) return 2

  let width = 0
  for (const character of grapheme) {
    const codePoint = character.codePointAt(0)!
    if (combiningOrFormat.test(character) || codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) continue
    width += eastAsianWidth(codePoint, { ambiguousAsWide: false })
  }
  return Math.min(width, 2)
}

/** Calculate the widest rendered line, ignoring ANSI controls and counting terminal cells. */
export function visibleWidth(text: string): number {
  let widest = 0
  let column = 0

  for (const token of tokenizeTerminalText(text)) {
    if (token.type === 'ansi') continue
    for (const { segment } of graphemeSegmenter.segment(token.value)) {
      if (segment === '\n') {
        widest = Math.max(widest, column)
        column = 0
      } else if (segment === '\t') {
        column += 4 - (column % 4)
      } else if (segment !== '\r') {
        column += graphemeWidth(segment)
      }
    }
  }

  return Math.max(widest, column)
}

/** Wrap terminal text by words when possible while carrying ANSI styles across lines. */
export function wrapTextWithAnsi(text: string, width: number): string[] {
  const limit = Math.max(1, Math.floor(width))
  if (!text) return ['']

  interface WrapToken {
    kind: 'ansi' | 'text' | 'newline'
    value: string
    width: number
    styleBefore: string
    styleAfter: string
  }

  const tokens: WrapToken[] = []
  let style = ''
  for (const token of tokenizeTerminalText(text)) {
    if (token.type === 'ansi') {
      const before = style
      if (token.value.startsWith('\u001b[') && /m$/.test(token.value)) {
        const parameters = token.value.slice(2, -1).split(';')
        style = parameters[0] === '' || parameters[0] === '0' ? token.value : `${style}${token.value}`
      } else if (token.value.startsWith('\u001b]8;')) {
        style += token.value
      }
      tokens.push({ kind: 'ansi', value: token.value, width: 0, styleBefore: before, styleAfter: style })
      continue
    }

    for (const { segment } of graphemeSegmenter.segment(token.value)) {
      if (segment === '\n') {
        tokens.push({ kind: 'newline', value: segment, width: 0, styleBefore: style, styleAfter: style })
      } else if (segment === '\r') {
        continue
      } else if (segment === '\t') {
        tokens.push({ kind: 'text', value: '   ', width: 3, styleBefore: style, styleAfter: style })
      } else {
        tokens.push({ kind: 'text', value: segment, width: graphemeWidth(segment), styleBefore: style, styleAfter: style })
      }
    }
  }

  const lines: string[] = []
  let line: WrapToken[] = []
  let lineWidth = 0

  const lineText = (parts: WrapToken[]): string => {
    const rendered = parts.map((part) => part.value).join('')
    return parts.some((part) => part.kind === 'ansi') ? `${rendered}\u001b[0m\u001b]8;;\u001b\\` : rendered
  }
  const activeStyle = (parts: WrapToken[], fallback: string): string => parts.at(-1)?.styleAfter ?? fallback
  const addStylePrefix = (active: string): void => {
    if (active) line.push({ kind: 'ansi', value: active, width: 0, styleBefore: '', styleAfter: active })
  }

  for (const token of tokens) {
    if (token.kind === 'newline') {
      lines.push(lineText(line))
      line = []
      lineWidth = 0
      addStylePrefix(token.styleAfter)
      continue
    }

    if (token.width > 0 && lineWidth + token.width > limit) {
      let breakIndex = -1
      for (let index = line.length - 1; index >= 0; index--) {
        const candidate = line[index]
        if (candidate?.kind === 'text' && /^\s+$/u.test(candidate.value)) {
          breakIndex = index
          break
        }
      }

      if (breakIndex > 0) {
        const head = line.slice(0, breakIndex + 1)
        const tail = line.slice(breakIndex + 1)
        const nextStyle = activeStyle(head, token.styleBefore)
        lines.push(lineText(head))
        line = []
        addStylePrefix(nextStyle)
        line.push(...tail)
        lineWidth = tail.reduce((sum, part) => sum + part.width, 0)
      } else {
        lines.push(lineText(line))
        const nextStyle = activeStyle(line, token.styleBefore)
        line = []
        lineWidth = 0
        addStylePrefix(nextStyle)
      }

      if (lineWidth > 0 && lineWidth + token.width > limit) {
        lines.push(lineText(line))
        line = []
        lineWidth = 0
        addStylePrefix(token.styleBefore)
      }
    }

    line.push(token)
    lineWidth += token.width
  }

  if (line.length > 0 || lines.length === 0 || text.endsWith('\n')) lines.push(lineText(line))
  return lines
}

export function applyBackgroundToLine(line: string, width: number, background: (text: string) => string): string {
  const safeWidth = Math.max(0, Math.floor(width))
  const content = visibleWidth(line) > safeWidth ? truncateToWidth(line, safeWidth, '') : line
  const padded = `${content}${' '.repeat(Math.max(0, safeWidth - visibleWidth(content)))}`
  return background(padded)
}

/** Truncate a single-line label to terminal columns while preserving ANSI style sequences. */
export function truncateToWidth(text: string, width: number, ellipsis = '...'): string {
  const limit = Math.max(0, Math.floor(width))
  if (limit === 0) return ''
  if (visibleWidth(text) <= limit) return text

  const ellipsisWidth = visibleWidth(ellipsis)
  const contentLimit = Math.max(0, limit - Math.min(limit, ellipsisWidth))
  let result = ''
  let used = 0
  let hasAnsi = false
  let truncated = false

  outer: for (const token of tokenizeTerminalText(text)) {
    if (token.type === 'ansi') {
      result += token.value
      hasAnsi = true
      continue
    }

    for (const { segment } of graphemeSegmenter.segment(token.value)) {
      if (segment === '\n' || segment === '\r') {
        truncated = true
        break outer
      }
      const segmentWidth = segment === '\t' ? 4 - (used % 4) : graphemeWidth(segment)
      if (used + segmentWidth > contentLimit) {
        truncated = true
        break outer
      }
      result += segment === '\t' ? ' '.repeat(segmentWidth) : segment
      used += segmentWidth
    }
  }

  if (!truncated) return result
  result += truncatePlainText(ellipsis, limit - used)
  if (hasAnsi) result += '\u001b[0m'
  return result
}

function truncatePlainText(text: string, width: number): string {
  let result = ''
  let used = 0
  for (const { segment } of graphemeSegmenter.segment(text)) {
    const nextWidth = graphemeWidth(segment)
    if (used + nextWidth > width) break
    result += segment
    used += nextWidth
  }
  return result
}
