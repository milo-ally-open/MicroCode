import { StringDecoder } from 'node:string_decoder'
import type { InputEvent, TerminalSession, TerminalSize } from './contracts.ts'
import { TerminalInputDecoder } from './inputDecoder.ts'

type InputStream = NodeJS.ReadStream & {
  setRawMode?: (mode: boolean) => void
  isRaw?: boolean
}

/** Process stdin/stdout terminal access; it contains no OS-specific shell or path behavior. */
export class ProcessTerminalSession implements TerminalSession {
  private readonly decoder = new TerminalInputDecoder()
  private utf8Decoder = new StringDecoder('utf8')
  private onEvent?: (event: InputEvent) => void
  private wasRaw = false
  private rawModeChanged = false
  private started = false
  private escapeTimer?: ReturnType<typeof setTimeout>

  constructor(
    private readonly input: InputStream = process.stdin,
    private readonly output: NodeJS.WriteStream = process.stdout,
  ) {}

  get size(): TerminalSize {
    return {
      columns: Math.max(1, this.output.columns || 80),
      rows: Math.max(1, this.output.rows || 24),
    }
  }

  get isInteractive(): boolean {
    return this.input.isTTY === true && this.output.isTTY === true
  }

  start(onEvent: (event: InputEvent) => void): void {
    if (this.started) throw new Error('Terminal session is already started.')

    this.onEvent = onEvent
    this.utf8Decoder = new StringDecoder('utf8')
    this.wasRaw = this.input.isRaw === true
    if (this.input.isTTY && this.input.setRawMode && !this.wasRaw) {
      this.input.setRawMode(true)
      this.rawModeChanged = true
    }

    this.input.on('data', this.handleData)
    this.output.on('resize', this.handleResize)
    this.input.resume()
    this.started = true
  }

  write(data: string): void {
    this.output.write(data)
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    this.input.removeListener('data', this.handleData)
    this.output.removeListener('resize', this.handleResize)
    if (this.escapeTimer) clearTimeout(this.escapeTimer)
    this.escapeTimer = undefined

    if (this.rawModeChanged && this.input.setRawMode) {
      this.input.setRawMode(this.wasRaw)
    }
    this.rawModeChanged = false
    this.decoder.reset()
    this.utf8Decoder.end()
    this.utf8Decoder = new StringDecoder('utf8')
    this.onEvent = undefined
  }

  private readonly handleData = (chunk: Buffer | string): void => {
    const text = typeof chunk === 'string' ? chunk : this.utf8Decoder.write(chunk)
    this.dispatch(this.decoder.feed(text))
    this.scheduleEscapeFlush()
  }

  private readonly handleResize = (): void => {
    this.onEvent?.({ type: 'resize', size: this.size })
  }

  private dispatch(events: InputEvent[]): void {
    for (const event of events) this.onEvent?.(event)
  }

  private scheduleEscapeFlush(): void {
    if (this.escapeTimer) clearTimeout(this.escapeTimer)
    this.escapeTimer = undefined
    if (!this.decoder.hasPendingEscape) return

    this.escapeTimer = setTimeout(() => {
      this.escapeTimer = undefined
      this.dispatch(this.decoder.flushPending())
    }, 35)
  }
}
