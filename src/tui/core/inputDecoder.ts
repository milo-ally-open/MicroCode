import type { InputEvent, KeyInputEvent, MouseInputEvent } from './contracts.ts'

const ESC = '\u001b'
const PASTE_START = `${ESC}[200~`
const PASTE_END = `${ESC}[201~`
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const csiKeys: Record<string, string> = {
  A: 'up',
  B: 'down',
  C: 'right',
  D: 'left',
  H: 'home',
  F: 'end',
  Z: 'shiftTab',
}

function keyEvent(
  key: string,
  raw: string,
  modifiers = 1,
  text?: string,
): KeyInputEvent {
  const flags = Math.max(0, modifiers - 1)
  return {
    type: 'key',
    key,
    raw,
    ...(text === undefined ? {} : { text }),
    shift: (flags & 1) !== 0,
    alt: (flags & 2) !== 0,
    ctrl: (flags & 4) !== 0,
    meta: (flags & 8) !== 0,
  }
}

function parseMouse(body: string, final: string): MouseInputEvent | undefined {
  const match = body.match(/^<(\d+);(\d+);(\d+)$/)
  if (!match) return undefined
  const button = Number(match[1])
  return {
    type: 'mouse',
    action: (button & 64) !== 0 ? 'wheel' : (button & 32) !== 0 ? 'move' : final === 'm' ? 'release' : 'press',
    button,
    column: Math.max(0, Number(match[2]) - 1),
    row: Math.max(0, Number(match[3]) - 1),
    shift: (button & 4) !== 0,
    alt: (button & 8) !== 0,
    ctrl: (button & 16) !== 0,
  }
}

function firstGrapheme(text: string): string | undefined {
  return segmenter.segment(text)[Symbol.iterator]().next().value?.segment
}

/** Turns chunked terminal input into complete, platform-neutral key/paste/mouse events. */
export class TerminalInputDecoder {
  private buffer = ''
  private pasteBuffer = ''
  private inPaste = false

  get hasPendingEscape(): boolean {
    return !this.inPaste && this.buffer.startsWith(ESC)
  }

  feed(chunk: string): InputEvent[] {
    this.buffer += chunk
    const events: InputEvent[] = []

    while (this.buffer.length > 0) {
      if (this.inPaste) {
        if (!this.consumePaste(events)) break
        continue
      }

      if (this.buffer.startsWith(PASTE_START)) {
        this.buffer = this.buffer.slice(PASTE_START.length)
        this.inPaste = true
        continue
      }
      if (this.isPartialPrefix(PASTE_START)) break

      if (this.buffer.startsWith(ESC)) {
        if (!this.consumeEscape(events)) break
        continue
      }

      if (this.consumeControl(events)) continue
      const grapheme = firstGrapheme(this.buffer)
      if (!grapheme) break
      this.buffer = this.buffer.slice(grapheme.length)
      events.push(keyEvent('character', grapheme, 1, grapheme))
    }

    return events
  }

  /** Resolve an isolated Escape after the caller's terminal-specific ambiguity timeout. */
  flushPending(): InputEvent[] {
    if (!this.buffer) return []
    if (this.buffer === ESC) {
      this.buffer = ''
      return [keyEvent('escape', ESC)]
    }
    if (this.inPaste) {
      const text = this.pasteBuffer + this.buffer
      this.pasteBuffer = ''
      this.buffer = ''
      this.inPaste = false
      return [{ type: 'paste', text }]
    }
    const raw = this.buffer
    this.buffer = ''
    return [{ type: 'unknown', raw }]
  }

  reset(): void {
    this.buffer = ''
    this.pasteBuffer = ''
    this.inPaste = false
  }

  private consumePaste(events: InputEvent[]): boolean {
    const end = this.buffer.indexOf(PASTE_END)
    if (end >= 0) {
      this.pasteBuffer += this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end + PASTE_END.length)
      events.push({ type: 'paste', text: this.pasteBuffer })
      this.pasteBuffer = ''
      this.inPaste = false
      return true
    }

    const keep = Math.min(PASTE_END.length - 1, this.buffer.length)
    const take = this.buffer.length - keep
    this.pasteBuffer += this.buffer.slice(0, take)
    this.buffer = this.buffer.slice(take)
    return false
  }

  private consumeControl(events: InputEvent[]): boolean {
    const code = this.buffer.charCodeAt(0)
    if (code === 0x0d) {
      const raw = this.buffer.startsWith('\r\n') ? '\r\n' : '\r'
      this.buffer = this.buffer.slice(raw.length)
      events.push(keyEvent('enter', raw))
      return true
    }
    if (code === 0x0a) {
      this.buffer = this.buffer.slice(1)
      events.push(keyEvent('enter', '\n'))
      return true
    }
    if (code === 0x09) {
      this.buffer = this.buffer.slice(1)
      events.push(keyEvent('tab', '\t'))
      return true
    }
    if (code === 0x7f || code === 0x08) {
      const raw = String.fromCharCode(code)
      this.buffer = this.buffer.slice(1)
      events.push(keyEvent('backspace', raw))
      return true
    }
    if (code > 0 && code < 0x20) {
      this.buffer = this.buffer.slice(1)
      const letter = String.fromCharCode(code + 0x60)
      events.push({ ...keyEvent(letter, String.fromCharCode(code)), ctrl: true })
      return true
    }
    return false
  }

  private consumeEscape(events: InputEvent[]): boolean {
    if (this.buffer.length === 1) return false

    if (this.buffer.startsWith(`${ESC}[M`)) {
      if (this.buffer.length < 6) return false
      const button = this.buffer.charCodeAt(3) - 32
      events.push({
        type: 'mouse',
        action: (button & 64) !== 0 ? 'wheel' : (button & 32) !== 0 ? 'move' : 'press',
        button,
        column: Math.max(0, this.buffer.charCodeAt(4) - 33),
        row: Math.max(0, this.buffer.charCodeAt(5) - 33),
        shift: (button & 4) !== 0,
        alt: (button & 8) !== 0,
        ctrl: (button & 16) !== 0,
      })
      this.buffer = this.buffer.slice(6)
      return true
    }

    if (this.buffer[1] === '[') return this.consumeCsi(events)
    if (this.buffer[1] === 'O') {
      if (this.buffer.length < 3) return false
      const raw = this.buffer.slice(0, 3)
      const key = csiKeys[this.buffer[2]]
      this.buffer = this.buffer.slice(3)
      events.push(key ? keyEvent(key, raw) : { type: 'unknown', raw })
      return true
    }

    const grapheme = firstGrapheme(this.buffer.slice(1))
    if (!grapheme) return false
    const raw = `${ESC}${grapheme}`
    this.buffer = this.buffer.slice(raw.length)
    events.push(keyEvent('character', raw, 3, grapheme))
    return true
  }

  private consumeCsi(events: InputEvent[]): boolean {
    let finalIndex = -1
    for (let index = 2; index < this.buffer.length; index++) {
      const code = this.buffer.charCodeAt(index)
      if (code >= 0x40 && code <= 0x7e) {
        finalIndex = index
        break
      }
    }
    if (finalIndex < 0) return false

    const raw = this.buffer.slice(0, finalIndex + 1)
    const body = this.buffer.slice(2, finalIndex)
    const final = this.buffer[finalIndex]
    this.buffer = this.buffer.slice(finalIndex + 1)

    if (final === 'M' || final === 'm') {
      const mouse = parseMouse(body, final)
      if (mouse) events.push(mouse)
      else events.push({ type: 'unknown', raw })
      return true
    }

    if (final === 'u') {
      const [codePointPart, modifierPart] = body.split(';')
      const codePoint = Number(codePointPart)
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        events.push({ type: 'unknown', raw })
        return true
      }
      const modifier = Number(modifierPart?.split(':')[0] ?? '1') || 1
      const character = String.fromCodePoint(codePoint)
      const specialKeys: Record<number, string> = { 9: 'tab', 13: 'enter', 27: 'escape', 127: 'backspace' }
      events.push(keyEvent(specialKeys[codePoint] ?? 'character', raw, modifier, specialKeys[codePoint] ? undefined : character))
      return true
    }

    if (final === '~') {
      const [codePart, modifierPart] = body.split(';')
      const code = Number(codePart)
      const key = ({ 1: 'home', 2: 'insert', 3: 'delete', 4: 'end', 5: 'pageUp', 6: 'pageDown', 7: 'home', 8: 'end' } as Record<number, string>)[code]
      if (key) events.push(keyEvent(key, raw, Number(modifierPart ?? '1') || 1))
      else events.push({ type: 'unknown', raw })
      return true
    }

    const key = csiKeys[final]
    if (key) {
      const parameters = body.split(';')
      const modifier = Number(parameters[1] ?? '1') || 1
      events.push(keyEvent(key, raw, modifier))
    } else {
      events.push({ type: 'unknown', raw })
    }
    return true
  }

  private isPartialPrefix(sequence: string): boolean {
    return this.buffer.length < sequence.length && sequence.startsWith(this.buffer)
  }
}

export function matchesKey(raw: string, key: string): boolean {
  const decoder = new TerminalInputDecoder()
  const events = decoder.feed(raw)
  const pending = decoder.flushPending()
  const event = [...events, ...pending][0]
  return event?.type === 'key' && event.key === key
}
