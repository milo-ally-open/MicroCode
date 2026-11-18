import type { Component, InputEvent } from './contracts.ts'
import { matchesTuiAction } from './keybindings.ts'
import { truncateToWidth, visibleWidth } from './textMetrics.ts'

export interface SelectItem {
  value: string
  label: string
  description?: string
}

export interface SelectListTheme {
  selectedPrefix: (text: string) => string
  selectedText: (text: string) => string
  description: (text: string) => string
  scrollInfo: (text: string) => string
  noMatch: (text: string) => string
}

export interface SelectListTruncatePrimaryContext {
  text: string
  maxWidth: number
  columnWidth: number
  item: SelectItem
  isSelected: boolean
}

export interface SelectListLayoutOptions {
  minPrimaryColumnWidth?: number
  maxPrimaryColumnWidth?: number
  truncatePrimary?: (context: SelectListTruncatePrimaryContext) => string
}

const DEFAULT_PRIMARY_COLUMN_WIDTH = 32
const PRIMARY_COLUMN_GAP = 2
const MIN_DESCRIPTION_WIDTH = 10

function normalizeToSingleLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim()
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

/** Keyboard-selectable, filterable list used by menus and interactive prompts. */
export class SelectList implements Component {
  private filteredItems: SelectItem[]
  private selectedIndex = 0
  focused = false

  onSelect?: (item: SelectItem) => void
  onCancel?: () => void
  onSelectionChange?: (item: SelectItem) => void

  constructor(
    private readonly items: SelectItem[],
    private readonly maxVisible: number,
    private readonly theme: SelectListTheme,
    private readonly layout: SelectListLayoutOptions = {},
  ) {
    this.filteredItems = items
  }

  setFilter(filter: string): void {
    const query = filter.toLowerCase()
    this.filteredItems = this.items.filter((item) => item.value.toLowerCase().startsWith(query))
    this.selectedIndex = 0
  }

  setSelectedIndex(index: number): void {
    this.selectedIndex = Math.max(0, Math.min(index, this.filteredItems.length - 1))
  }

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, Math.floor(width))
    if (this.filteredItems.length === 0) return [this.theme.noMatch('  No matching commands')]

    const primaryColumnWidth = this.getPrimaryColumnWidth()
    const maxVisible = Math.max(1, Math.floor(this.maxVisible))
    const startIndex = Math.max(0, Math.min(
      this.selectedIndex - Math.floor(maxVisible / 2),
      this.filteredItems.length - maxVisible,
    ))
    const endIndex = Math.min(startIndex + maxVisible, this.filteredItems.length)
    const lines: string[] = []

    for (let index = startIndex; index < endIndex; index++) {
      const item = this.filteredItems[index]
      if (!item) continue
      lines.push(this.renderItem(
        item,
        index === this.selectedIndex,
        safeWidth,
        item.description ? normalizeToSingleLine(item.description) : undefined,
        primaryColumnWidth,
      ))
    }

    if (startIndex > 0 || endIndex < this.filteredItems.length) {
      lines.push(this.theme.scrollInfo(truncateToWidth(`  (${this.selectedIndex + 1}/${this.filteredItems.length})`, safeWidth - 2, '')))
    }
    return lines
  }

  handleInput(input: string | InputEvent): void {
    const keyData = typeof input === 'string' ? input : input.type === 'key' ? input.raw : undefined
    if (keyData === undefined) return
    if (this.filteredItems.length === 0) {
      if (matchesTuiAction(keyData, 'select.cancel')) this.onCancel?.()
      return
    }

    if (matchesTuiAction(keyData, 'select.up')) {
      this.selectedIndex = this.selectedIndex === 0 ? this.filteredItems.length - 1 : this.selectedIndex - 1
      this.notifySelectionChange()
    } else if (matchesTuiAction(keyData, 'select.down')) {
      this.selectedIndex = this.selectedIndex === this.filteredItems.length - 1 ? 0 : this.selectedIndex + 1
      this.notifySelectionChange()
    } else if (matchesTuiAction(keyData, 'select.confirm')) {
      const item = this.filteredItems[this.selectedIndex]
      if (item) this.onSelect?.(item)
    } else if (matchesTuiAction(keyData, 'select.cancel')) {
      this.onCancel?.()
    }
  }

  getSelectedItem(): SelectItem | null {
    return this.filteredItems[this.selectedIndex] ?? null
  }

  private renderItem(
    item: SelectItem,
    selected: boolean,
    width: number,
    description: string | undefined,
    primaryColumnWidth: number,
  ): string {
    const prefix = selected ? '→ ' : '  '
    const prefixWidth = visibleWidth(prefix)
    const displayValue = item.label || item.value

    if (description && width > 40) {
      const columnWidth = Math.max(1, Math.min(primaryColumnWidth, width - prefixWidth - 4))
      const maxPrimaryWidth = Math.max(1, columnWidth - PRIMARY_COLUMN_GAP)
      const truncatedValue = this.truncatePrimary(item, selected, maxPrimaryWidth, columnWidth)
      const valueWidth = visibleWidth(truncatedValue)
      const spacing = ' '.repeat(Math.max(1, columnWidth - valueWidth))
      const descriptionStart = prefixWidth + valueWidth + spacing.length
      const remainingWidth = width - descriptionStart - 2
      if (remainingWidth > MIN_DESCRIPTION_WIDTH) {
        const truncatedDescription = truncateToWidth(description, remainingWidth, '')
        if (selected) return this.theme.selectedText(`${prefix}${truncatedValue}${spacing}${truncatedDescription}`)
        return `${prefix}${truncatedValue}${this.theme.description(spacing + truncatedDescription)}`
      }
    }

    const maxWidth = Math.max(0, width - prefixWidth - 2)
    const truncatedValue = this.truncatePrimary(item, selected, maxWidth, maxWidth)
    const line = `${prefix}${truncatedValue}`
    return selected ? this.theme.selectedText(line) : line
  }

  private getPrimaryColumnWidth(): number {
    const { min, max } = this.getPrimaryColumnBounds()
    const widestPrimary = this.filteredItems.reduce((widest, item) =>
      Math.max(widest, visibleWidth(item.label || item.value) + PRIMARY_COLUMN_GAP), 0)
    return clamp(widestPrimary, min, max)
  }

  private getPrimaryColumnBounds(): { min: number; max: number } {
    const rawMin = this.layout.minPrimaryColumnWidth ?? this.layout.maxPrimaryColumnWidth ?? DEFAULT_PRIMARY_COLUMN_WIDTH
    const rawMax = this.layout.maxPrimaryColumnWidth ?? this.layout.minPrimaryColumnWidth ?? DEFAULT_PRIMARY_COLUMN_WIDTH
    return {
      min: Math.max(1, Math.min(rawMin, rawMax)),
      max: Math.max(1, Math.max(rawMin, rawMax)),
    }
  }

  private truncatePrimary(item: SelectItem, isSelected: boolean, maxWidth: number, columnWidth: number): string {
    const displayValue = item.label || item.value
    const truncated = this.layout.truncatePrimary?.({
      text: displayValue,
      maxWidth,
      columnWidth,
      item,
      isSelected,
    }) ?? truncateToWidth(displayValue, maxWidth, '')
    return truncateToWidth(truncated, maxWidth, '')
  }

  private notifySelectionChange(): void {
    const selected = this.filteredItems[this.selectedIndex]
    if (selected) this.onSelectionChange?.(selected)
  }
}
