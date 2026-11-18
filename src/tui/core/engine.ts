import type { Component, Focusable, InputEvent, Renderer, TerminalSession } from './contracts.ts'
import { ScreenBuffer } from './screenBuffer.ts'

export type InputListener = (event: InputEvent) => boolean | void

/** Owns the terminal event loop, component focus, and frame-to-renderer boundary. */
export class TuiEngine {
  private root?: Component
  private focused?: Focusable
  private readonly inputListeners: InputListener[] = []
  private started = false
  private rendering = false
  private renderAgain = false

  constructor(
    private readonly terminal: TerminalSession,
    private readonly renderer: Renderer,
  ) {}

  setRoot(component: Component): void {
    this.root = component
    this.root.invalidate?.()
    this.requestRender()
  }

  setFocus(component: Focusable | null): void {
    if (this.focused === component) return
    if (this.focused) this.focused.focused = false
    this.focused = component ?? undefined
    if (this.focused) this.focused.focused = true
    this.focused?.invalidate?.()
    this.requestRender()
  }

  addInputListener(listener: InputListener): () => void {
    this.inputListeners.push(listener)
    return () => {
      const index = this.inputListeners.lastIndexOf(listener)
      if (index >= 0) this.inputListeners.splice(index, 1)
    }
  }

  start(): void {
    if (this.started) return
    if (!this.root) throw new Error('A root component must be set before the TUI engine starts.')

    this.renderer.start(this.terminal)
    try {
      this.terminal.start((event) => this.handleEvent(event))
      this.started = true
      this.requestRender()
    } catch (error) {
      this.renderer.stop()
      this.terminal.stop()
      throw error
    }
  }

  requestRender(): void {
    if (!this.started || !this.root) return
    if (this.rendering) {
      this.renderAgain = true
      return
    }

    this.rendering = true
    try {
      do {
        this.renderAgain = false
        const { columns, rows } = this.terminal.size
        const frame = new ScreenBuffer(columns, rows)
        const lines = this.root.render(columns)
        const top = Math.max(0, lines.length - rows)
        for (let row = 0; row < rows; row++) {
          const line = lines[top + row]
          if (line !== undefined) frame.writeText(row, 0, line)
        }
        this.renderer.render(frame)
      } while (this.renderAgain)
    } finally {
      this.rendering = false
    }
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    try {
      this.renderer.stop()
    } finally {
      this.terminal.stop()
    }
  }

  private handleEvent(event: InputEvent): void {
    if (event.type === 'resize') {
      this.root?.invalidate?.()
      this.requestRender()
      return
    }

    for (let index = this.inputListeners.length - 1; index >= 0; index--) {
      if (this.inputListeners[index]?.(event)) {
        this.requestRender()
        return
      }
    }

    this.focused?.handleInput(event)
    this.requestRender()
  }
}
