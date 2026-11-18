import type { RenderFrame } from './contracts.ts'
import { graphemeWidth, tokenizeTerminalText } from './textMetrics.ts'

const CURSOR_MARKER = '\u001b_pi:c\u0007'
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

interface Cell {
  text: string
  width: 0 | 1 | 2
  style: string
}

export class ScreenBuffer implements RenderFrame {
  private cells: Cell[][]
  private cursor?: { row: number; column: number; visible: boolean }

  constructor(public columns: number, public rows: number) {
    this.columns = Math.max(1, Math.floor(columns))
    this.rows = Math.max(1, Math.floor(rows))
    this.cells = this.createCells(this.columns, this.rows)
  }

  resize(columns: number, rows: number): void {
    const nextColumns = Math.max(1, Math.floor(columns))
    const nextRows = Math.max(1, Math.floor(rows))
    if (nextColumns === this.columns && nextRows === this.rows) return
    this.columns = nextColumns
    this.rows = nextRows
    this.cells = this.createCells(this.columns, this.rows)
    this.cursor = undefined
  }

  clear(): void {
    this.cells = this.createCells(this.columns, this.rows)
    this.cursor = undefined
  }

  clearRow(row: number): void {
    if (!this.isValidRow(row)) return
    this.cells[row] = this.createRow()
  }

  setCursor(row: number, column: number, visible = true): void {
    if (row < 0 || row >= this.rows || column < 0 || column >= this.columns) {
      this.cursor = undefined
      return
    }
    this.cursor = { row, column, visible }
  }

  getCursor(): { row: number; column: number; visible: boolean } | undefined {
    return this.cursor && { ...this.cursor }
  }

  /** Write printable text at a cell position, consuming ANSI styles but not rendering controls. */
  writeText(row: number, column: number, text: string): { row: number; column: number } {
    let targetRow = Math.max(0, Math.floor(row))
    let targetColumn = Math.max(0, Math.floor(column))
    let style = ''

    for (const token of tokenizeTerminalText(text)) {
      if (token.type === 'ansi') {
        if (token.value === CURSOR_MARKER) {
          this.setCursor(targetRow, targetColumn)
        } else if (token.value.startsWith('\u001b[') && /m$/.test(token.value)) {
          const parameters = token.value.slice(2, -1).split(';')
          if (parameters[0] === '' || parameters[0] === '0') style = token.value
          else style += token.value
        } else if (token.value.startsWith('\u001b]8;')) {
          style += token.value
        }
        continue
      }

      for (const { segment } of graphemeSegmenter.segment(token.value)) {
        if (segment === '\n') {
          targetRow++
          targetColumn = 0
          continue
        }
        if (segment === '\r') continue
        if (segment === '\t') {
          const spaces = 4 - (targetColumn % 4)
          for (let index = 0; index < spaces; index++) {
            if (!this.writeGrapheme(targetRow, targetColumn, ' ', style)) return { row: targetRow, column: targetColumn }
            targetColumn++
          }
          continue
        }
        if (/^[\u0000-\u001f\u007f-\u009f]$/u.test(segment)) continue

        const width = graphemeWidth(segment)
        if (width === 0) {
          if (targetColumn > 0 && this.isValidRow(targetRow)) {
            let previousColumn = targetColumn - 1
            if (this.cells[targetRow][previousColumn]?.width === 0) previousColumn--
            const previous = this.cells[targetRow][previousColumn]
            if (previous) previous.text += segment
          }
          continue
        }
        if (!this.writeGrapheme(targetRow, targetColumn, segment, style)) return { row: targetRow, column: targetColumn }
        targetColumn += width
      }
    }

    return { row: targetRow, column: targetColumn }
  }

  renderLine(row: number): string {
    if (!this.isValidRow(row)) return ''
    let output = ''
    let currentStyle: string | undefined
    const reset = '\u001b[0m\u001b]8;;\u001b\\'

    for (const cell of this.cells[row]) {
      if (cell.width === 0) continue
      const style = cell.style
      if (style !== currentStyle) {
        output += reset
        output += style
        currentStyle = style
      }
      output += cell.text
    }

    return `${output}${reset}`
  }

  private writeGrapheme(row: number, column: number, text: string, style: string): boolean {
    const width = graphemeWidth(text)
    if (!this.isValidRow(row) || column < 0 || column + width > this.columns) return false
    this.clearOccupiedCell(row, column)
    if (width === 2) this.clearOccupiedCell(row, column + 1)
    this.cells[row][column] = { text, width: width as 1 | 2, style }
    if (width === 2) this.cells[row][column + 1] = { text: '', width: 0, style }
    return true
  }

  private clearOccupiedCell(row: number, column: number): void {
    if (!this.isValidRow(row) || column < 0 || column >= this.columns) return
    const cell = this.cells[row][column]
    if (cell.width === 0 && column > 0) {
      this.cells[row][column - 1] = this.emptyCell()
      this.cells[row][column] = this.emptyCell()
    } else if (cell.width === 2 && column + 1 < this.columns) {
      this.cells[row][column] = this.emptyCell()
      this.cells[row][column + 1] = this.emptyCell()
    } else {
      this.cells[row][column] = this.emptyCell()
    }
  }

  private isValidRow(row: number): boolean {
    return row >= 0 && row < this.rows
  }

  private createCells(columns: number, rows: number): Cell[][] {
    return Array.from({ length: rows }, () => this.createRow(columns))
  }

  private createRow(columns = this.columns): Cell[] {
    return Array.from({ length: columns }, () => this.emptyCell())
  }

  private emptyCell(): Cell {
    return { text: ' ', width: 1, style: '' }
  }
}
