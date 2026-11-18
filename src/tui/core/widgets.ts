import type { Component } from './contracts.ts'
import { applyBackgroundToLine, truncateToWidth, visibleWidth, wrapTextWithAnsi } from './textMetrics.ts'

export interface RenderScheduler {
  requestRender(): void
}

export interface LoaderIndicatorOptions {
  frames?: string[]
  intervalMs?: number
}

export class Container implements Component {
  readonly children: Component[] = []

  addChild(component: Component): void {
    this.children.push(component)
    this.invalidate()
  }

  removeChild(component: Component): void {
    const index = this.children.indexOf(component)
    if (index >= 0) {
      this.children.splice(index, 1)
      this.invalidate()
    }
  }

  clear(): void {
    this.children.length = 0
    this.invalidate()
  }

  invalidate(): void {
    for (const child of this.children) child.invalidate?.()
  }

  render(width: number): string[] {
    return this.children.flatMap((child) => child.render(width))
  }
}

export class Text implements Component {
  private cachedText?: string
  private cachedWidth?: number
  private cachedLines?: string[]

  constructor(
    private text = '',
    private paddingX = 1,
    private paddingY = 1,
    private customBgFn?: (text: string) => string,
  ) {}

  setText(text: string): void {
    this.text = text
    this.invalidate()
  }

  setCustomBgFn(background?: (text: string) => string): void {
    this.customBgFn = background
    this.invalidate()
  }

  invalidate(): void {
    this.cachedText = undefined
    this.cachedWidth = undefined
    this.cachedLines = undefined
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, Math.floor(width))
    if (this.cachedLines && this.cachedText === this.text && this.cachedWidth === safeWidth) return this.cachedLines
    if (!this.text || this.text.trim() === '') {
      this.cachedText = this.text
      this.cachedWidth = safeWidth
      this.cachedLines = []
      return []
    }

    const paddingX = Math.min(Math.max(0, Math.floor(this.paddingX)), Math.floor((safeWidth - 1) / 2))
    const paddingY = Math.max(0, Math.floor(this.paddingY))
    const contentWidth = Math.max(1, safeWidth - paddingX * 2)
    const left = ' '.repeat(paddingX)
    const right = ' '.repeat(paddingX)
    const contentLines = wrapTextWithAnsi(this.text.replace(/\t/g, '   '), contentWidth).map((line) => {
      const clipped = visibleWidth(line) > contentWidth ? truncateToWidth(line, contentWidth, '') : line
      const padded = `${left}${clipped}${right}`
      return this.customBgFn
        ? applyBackgroundToLine(padded, safeWidth, this.customBgFn)
        : `${padded}${' '.repeat(Math.max(0, safeWidth - visibleWidth(padded)))}`
    })
    const blank = ' '.repeat(safeWidth)
    const emptyLines = Array.from({ length: paddingY }, () =>
      this.customBgFn ? applyBackgroundToLine(blank, safeWidth, this.customBgFn) : blank,
    )
    const result = [...emptyLines, ...contentLines, ...emptyLines]

    this.cachedText = this.text
    this.cachedWidth = safeWidth
    this.cachedLines = result
    return result
  }
}

export class Spacer implements Component {
  constructor(private lines = 1) {}

  setLines(lines: number): void {
    this.lines = Math.max(0, Math.floor(lines))
  }

  invalidate(): void {}

  render(_width: number): string[] {
    return Array.from({ length: Math.max(0, Math.floor(this.lines)) }, () => '')
  }
}

export class Box implements Component {
  readonly children: Component[] = []

  constructor(
    private paddingX = 1,
    private paddingY = 1,
    private bgFn?: (text: string) => string,
  ) {}

  addChild(component: Component): void {
    this.children.push(component)
    this.invalidate()
  }

  removeChild(component: Component): void {
    const index = this.children.indexOf(component)
    if (index >= 0) {
      this.children.splice(index, 1)
      this.invalidate()
    }
  }

  clear(): void {
    this.children.length = 0
    this.invalidate()
  }

  setBgFn(background?: (text: string) => string): void {
    this.bgFn = background
    this.invalidate()
  }

  invalidate(): void {
    for (const child of this.children) child.invalidate?.()
  }

  render(width: number): string[] {
    if (this.children.length === 0) return []
    const safeWidth = Math.max(1, Math.floor(width))
    const paddingX = Math.min(Math.max(0, Math.floor(this.paddingX)), Math.floor((safeWidth - 1) / 2))
    const paddingY = Math.max(0, Math.floor(this.paddingY))
    const contentWidth = Math.max(1, safeWidth - paddingX * 2)
    const left = ' '.repeat(paddingX)
    const childLines = this.children.flatMap((child) => child.render(contentWidth))
    if (childLines.length === 0) return []

    const padded = childLines.map((line) => {
      const clipped = visibleWidth(line) > contentWidth ? truncateToWidth(line, contentWidth, '') : line
      return `${left}${clipped}${' '.repeat(Math.max(0, safeWidth - paddingX - visibleWidth(clipped) - paddingX))}`
    })
    const content = padded.map((line) => this.bgFn ? applyBackgroundToLine(line, safeWidth, this.bgFn) : line)
    const blank = ' '.repeat(safeWidth)
    const verticalPadding = Array.from({ length: paddingY }, () =>
      this.bgFn ? applyBackgroundToLine(blank, safeWidth, this.bgFn) : blank,
    )
    return [...verticalPadding, ...content, ...verticalPadding]
  }
}

const DEFAULT_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export class Loader extends Text {
  private frames = [...DEFAULT_FRAMES]
  private intervalMs = 80
  private currentFrame = 0
  private intervalId?: ReturnType<typeof setInterval>
  private renderIndicatorVerbatim = false

  constructor(
    private readonly ui: RenderScheduler | undefined,
    private readonly spinnerColorFn: (text: string) => string,
    private readonly messageColorFn: (text: string) => string,
    private message = 'Loading...',
    indicator?: LoaderIndicatorOptions,
  ) {
    super('', 1, 0)
    this.setIndicator(indicator)
  }

  render(width: number): string[] {
    return ['', ...super.render(width)]
  }

  start(): void {
    this.updateDisplay()
    this.restartAnimation()
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId)
    this.intervalId = undefined
  }

  setMessage(message: string): void {
    this.message = message
    this.updateDisplay()
  }

  setIndicator(indicator?: LoaderIndicatorOptions): void {
    this.renderIndicatorVerbatim = indicator !== undefined
    this.frames = indicator?.frames ? [...indicator.frames] : [...DEFAULT_FRAMES]
    this.intervalMs = indicator?.intervalMs && indicator.intervalMs > 0 ? indicator.intervalMs : 80
    this.currentFrame = 0
    this.start()
  }

  private restartAnimation(): void {
    this.stop()
    if (this.frames.length <= 1) return
    this.intervalId = setInterval(() => {
      this.currentFrame = (this.currentFrame + 1) % this.frames.length
      this.updateDisplay()
    }, this.intervalMs)
  }

  private updateDisplay(): void {
    const frame = this.frames[this.currentFrame] ?? ''
    const indicator = frame.length > 0
      ? `${this.renderIndicatorVerbatim ? frame : this.spinnerColorFn(frame)} `
      : ''
    this.setText(`${indicator}${this.messageColorFn(this.message)}`)
    this.ui?.requestRender()
  }
}
