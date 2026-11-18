import { EventEmitter } from 'node:events'
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, test } from 'bun:test'
import { AnsiDiffRenderer } from '../../src/tui/core/ansiDiffRenderer.ts'
import type { InputEvent, TerminalSession, TerminalSize } from '../../src/tui/core/contracts.ts'
import { TuiEngine } from '../../src/tui/core/engine.ts'
import { TerminalInputDecoder, matchesKey } from '../../src/tui/core/inputDecoder.ts'
import { ProcessTerminalSession } from '../../src/tui/core/processTerminalSession.ts'
import { SelectList } from '../../src/tui/core/selectList.ts'
import { ScreenBuffer } from '../../src/tui/core/screenBuffer.ts'
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '../../src/tui/core/textMetrics.ts'
import { Box, Container, Spacer, Text } from '../../src/tui/core/widgets.ts'

describe('TUI core text metrics', () => {
  test('counts terminal columns for CJK, combining marks, emoji, and ANSI styles', () => {
    expect(visibleWidth('中文')).toBe(4)
    expect(visibleWidth('e\u0301')).toBe(1)
    expect(visibleWidth('👩‍💻')).toBe(2)
    expect(visibleWidth('\u001b[31m错误\u001b[39m')).toBe(4)
  })

  test('truncates at grapheme boundaries and preserves style resets', () => {
    const truncated = truncateToWidth('\u001b[31m界界界\u001b[39m', 5, '…')
    expect(visibleWidth(truncated)).toBe(5)
    expect(truncated).toContain('界界…')
    expect(truncated.endsWith('\u001b[0m')).toBe(true)
  })

  test('wraps at word boundaries while preserving ANSI styles across lines', () => {
    const lines = wrapTextWithAnsi('\u001b[31mhello world\u001b[39m', 6)
    expect(lines.map((line) => visibleWidth(line))).toEqual([6, 5])
    expect(stripVTControlCharacters(lines.join(''))).toBe('hello world')
    expect(lines[0]).toContain('\u001b[0m')
    expect(lines[1]).toContain('\u001b[31m')
  })
})

describe('TUI core widgets', () => {
  test('containers, text, boxes, and spacers compose within their column width', () => {
    const text = new Text('hello world', 0, 0)
    const box = new Box(1, 0)
    box.addChild(text)
    const container = new Container()
    container.addChild(box)
    container.addChild(new Spacer(1))

    const lines = container.render(8)
    expect(lines).toHaveLength(3)
    expect(lines.every((line) => visibleWidth(line) <= 8)).toBe(true)
    expect(lines[0]?.trim()).toBe('hello')
    expect(lines[1]?.trim()).toBe('world')
    expect(lines[2]).toBe('')
  })

  test('select lists filter, navigate, confirm, and cancel with terminal keys', () => {
    const identity = (text: string) => text
    const list = new SelectList([
      { value: 'alpha', label: 'Alpha', description: 'First choice' },
      { value: 'beta', label: 'Beta', description: 'Second choice' },
    ], 1, {
      selectedPrefix: identity,
      selectedText: identity,
      description: identity,
      scrollInfo: identity,
      noMatch: identity,
    })
    const selected: string[] = []
    let cancelled = 0
    list.onSelect = (item) => selected.push(item.value)
    list.onCancel = () => { cancelled++ }

    list.handleInput('\u001b[B')
    expect(list.getSelectedItem()?.value).toBe('beta')
    list.handleInput('\r')
    expect(selected).toEqual(['beta'])
    list.handleInput('\u001b')
    expect(cancelled).toBe(1)

    list.setFilter('al')
    expect(list.getSelectedItem()?.value).toBe('alpha')
    expect(list.render(20).join('\n')).toContain('Alpha')
  })
})

describe('TUI core input decoder', () => {
  test('decodes keys across split terminal chunks', () => {
    const decoder = new TerminalInputDecoder()
    expect(decoder.feed('\u001b[')).toEqual([])
    expect(decoder.feed('5~')).toEqual([{
      type: 'key', key: 'pageUp', raw: '\u001b[5~', shift: false, alt: false, ctrl: false, meta: false,
    }])
    expect(matchesKey('\u001b[6~', 'pageDown')).toBe(true)
    expect(decoder.feed('\u001b[1;5A')[0]).toMatchObject({ type: 'key', key: 'up', ctrl: true })
    expect(decoder.feed('\u0003')[0]).toMatchObject({ type: 'key', key: 'c', ctrl: true })
  })

  test('keeps bracketed paste intact when its delimiters arrive in chunks', () => {
    const decoder = new TerminalInputDecoder()
    expect(decoder.feed('\u001b[200~line 1\nline 2\u001b[20')).toEqual([])
    expect(decoder.feed('1~')).toEqual([{ type: 'paste', text: 'line 1\nline 2' }])
  })

  test('decodes SGR mouse coordinates and resolves an isolated Escape', () => {
    const decoder = new TerminalInputDecoder()
    expect(decoder.feed('\u001b[<64;12;7M')[0]).toMatchObject({
      type: 'mouse', action: 'wheel', button: 64, column: 11, row: 6,
    })
    expect(decoder.feed('\u001b')).toEqual([])
    expect(decoder.flushPending()).toEqual([{
      type: 'key', key: 'escape', raw: '\u001b', shift: false, alt: false, ctrl: false, meta: false,
    }])
  })
})

describe('TUI core screen buffer and renderer', () => {
  test('stores wide graphemes in terminal cells and avoids writing half a grapheme', () => {
    const frame = new ScreenBuffer(4, 1)
    frame.writeText(0, 0, 'A界B')
    expect(visibleWidth(frame.renderLine(0))).toBe(4)
    expect(frame.renderLine(0)).toContain('A界B')

    const narrow = new ScreenBuffer(3, 1)
    narrow.writeText(0, 0, 'ab界')
    expect(narrow.renderLine(0)).toContain('ab ')
    expect(visibleWidth(narrow.renderLine(0))).toBe(3)
  })

  test('renders changed rows only and restores terminal modes on stop', () => {
    const writes: string[] = []
    const renderer = new AnsiDiffRenderer()
    renderer.start({ write: (data) => writes.push(data) })
    const frame = new ScreenBuffer(6, 2)
    frame.writeText(0, 0, 'ready')
    renderer.render(frame)
    expect(writes.join('')).toContain('\u001b[1;1H')
    expect(writes.join('')).toContain('\u001b[2;1H')

    writes.length = 0
    renderer.render(frame)
    expect(writes).toEqual([])

    frame.writeText(1, 0, 'done')
    renderer.render(frame)
    expect(writes.join('')).toContain('\u001b[2;1H')
    expect(writes.join('')).not.toContain('\u001b[1;1H')

    renderer.stop()
    expect(writes.join('')).toContain('\u001b[?1049l')
    expect(writes.join('')).toContain('\u001b[?25h')
  })
})

describe('process terminal session', () => {
  test('normalizes stream input, reports resize, and restores the previous raw mode', () => {
    class FakeInput extends EventEmitter {
      isTTY = true
      isRaw = false
      rawModes: boolean[] = []
      resume(): void {}
      setRawMode(mode: boolean): void {
        this.rawModes.push(mode)
        this.isRaw = mode
      }
    }
    class FakeOutput extends EventEmitter {
      isTTY = true
      columns = 90
      rows = 30
      write(_data: string): boolean { return true }
    }

    const input = new FakeInput()
    const output = new FakeOutput()
    const session = new ProcessTerminalSession(
      input as unknown as NodeJS.ReadStream,
      output as unknown as NodeJS.WriteStream,
    )
    const events: unknown[] = []
    session.start((event) => events.push(event))
    input.emit('data', Buffer.from('\u0003'))
    output.rows = 40
    output.emit('resize')
    session.stop()

    expect(session.size).toEqual({ columns: 90, rows: 40 })
    expect(events).toMatchObject([
      { type: 'key', key: 'c', ctrl: true },
      { type: 'resize', size: { columns: 90, rows: 40 } },
    ])
    expect(input.rawModes).toEqual([true, false])
  })
})

describe('TUI engine', () => {
  test('routes focused input, gives newest listeners priority, and redraws on resize', () => {
    const writes: string[] = []
    const emitted: InputEvent[] = []
    let currentSize: TerminalSize = { columns: 12, rows: 3 }
    let listener: ((event: InputEvent) => void) | undefined
    const terminal: TerminalSession = {
      get size() { return currentSize },
      isInteractive: true,
      start(onEvent) { listener = onEvent },
      write(data) { writes.push(data) },
      stop() {},
    }
    const renderer = new AnsiDiffRenderer()
    const component = {
      focused: false,
      render: () => ['prompt>'],
      handleInput: (event: InputEvent) => emitted.push(event),
      invalidate() {},
    }
    const engine = new TuiEngine(terminal, renderer)
    engine.setRoot({ render: () => ['ready'], invalidate() {} })
    engine.setFocus(component)
    engine.start()
    const handled: string[] = []
    engine.addInputListener(() => { handled.push('older'); return false })
    const removeNewest = engine.addInputListener(() => { handled.push('newer'); return true })
    listener?.({ type: 'key', key: 'enter', raw: '\r', ctrl: false, alt: false, shift: false, meta: false })
    expect(handled).toEqual(['newer'])
    expect(emitted).toEqual([])
    removeNewest()

    const terminalEvent: InputEvent = { type: 'key', key: 'x', raw: 'x', text: 'x', ctrl: false, alt: false, shift: false, meta: false }
    listener?.(terminalEvent)
    expect(emitted).toEqual([terminalEvent])

    const before = writes.length
    currentSize = { columns: 20, rows: 5 }
    listener?.({ type: 'resize', size: currentSize })
    expect(writes.length).toBeGreaterThan(before)
    engine.stop()
    expect(writes.join('')).toContain('\u001b[?1049l')
  })
})
