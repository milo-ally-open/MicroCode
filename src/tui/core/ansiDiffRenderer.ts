import type { RenderFrame, Renderer, TerminalSession } from './contracts.ts'

const CURSOR_HIDE = '\u001b[?25l'
const CURSOR_SHOW = '\u001b[?25h'
const ALT_SCREEN_ENTER = '\u001b[?1049h'
const ALT_SCREEN_EXIT = '\u001b[?1049l'
const RESET_STYLE = '\u001b[0m\u001b]8;;\u001b\\'

/** Paints a frame in an alternate screen and writes only rows that changed. */
export class AnsiDiffRenderer implements Renderer {
  private terminal?: Pick<TerminalSession, 'write'>
  private previousLines?: string[]
  private previousSize?: { columns: number; rows: number }
  private previousCursor?: string

  start(terminal: Pick<TerminalSession, 'write'>): void {
    if (this.terminal) throw new Error('Renderer is already started.')
    this.terminal = terminal
    this.previousLines = undefined
    this.previousSize = undefined
    this.previousCursor = undefined
    terminal.write(`${ALT_SCREEN_ENTER}${CURSOR_HIDE}${RESET_STYLE}`)
  }

  render(frame: RenderFrame): void {
    const terminal = this.terminal
    if (!terminal) throw new Error('Renderer must be started before rendering.')

    const dimensionsChanged = this.previousSize?.columns !== frame.columns || this.previousSize?.rows !== frame.rows
    const fullRedraw = !this.previousLines || dimensionsChanged
    let output = fullRedraw ? '\u001b[2J' : ''
    let changed = fullRedraw

    for (let row = 0; row < frame.rows; row++) {
      const line = frame.renderLine(row)
      if (fullRedraw || this.previousLines?.[row] !== line) {
        output += `\u001b[${row + 1};1H${line}\u001b[K`
        changed = true
      }
    }

    const cursor = frame.getCursor()
    const cursorKey = cursor ? `${cursor.row}:${cursor.column}:${cursor.visible}` : 'hidden'
    if (cursorKey !== this.previousCursor || fullRedraw) {
      if (cursor?.visible) {
        output += `\u001b[${cursor.row + 1};${cursor.column + 1}H${CURSOR_SHOW}`
      } else {
        output += CURSOR_HIDE
      }
      changed = true
    }

    if (changed) {
      // Disable autowrap while painting exact-width rows so the last cell cannot scroll the screen.
      terminal.write(`\u001b[?7l${output}${RESET_STYLE}\u001b[?7h`)
    }

    this.previousLines = Array.from({ length: frame.rows }, (_, row) => frame.renderLine(row))
    this.previousSize = { columns: frame.columns, rows: frame.rows }
    this.previousCursor = cursorKey
  }

  stop(): void {
    const terminal = this.terminal
    if (!terminal) return
    terminal.write(`${RESET_STYLE}${CURSOR_SHOW}\u001b[?7h${ALT_SCREEN_EXIT}`)
    this.terminal = undefined
    this.previousLines = undefined
    this.previousSize = undefined
    this.previousCursor = undefined
  }
}
