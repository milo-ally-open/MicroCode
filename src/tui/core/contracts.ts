/** Terminal dimensions are measured in character cells, not Unicode code points. */
export interface TerminalSize {
  columns: number
  rows: number
}

export interface KeyInputEvent {
  type: 'key'
  key: string
  raw: string
  text?: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

export interface PasteInputEvent {
  type: 'paste'
  text: string
}

export interface MouseInputEvent {
  type: 'mouse'
  action: 'press' | 'release' | 'move' | 'wheel'
  button: number
  column: number
  row: number
  ctrl: boolean
  alt: boolean
  shift: boolean
}

export interface ResizeInputEvent {
  type: 'resize'
  size: TerminalSize
}

export interface UnknownInputEvent {
  type: 'unknown'
  raw: string
}

export type InputEvent = KeyInputEvent | PasteInputEvent | MouseInputEvent | ResizeInputEvent | UnknownInputEvent

export interface TerminalSession {
  readonly size: TerminalSize
  readonly isInteractive: boolean
  start(onEvent: (event: InputEvent) => void): void
  write(data: string): void
  stop(): void
}

/** A renderable view. Input is routed only to the currently focused component. */
export interface Component {
  render(width: number): string[]
  invalidate(): void
}

export interface InteractiveComponent extends Component {
  handleInput(event: InputEvent): void
}

export interface Focusable extends InteractiveComponent {
  focused: boolean
  getCursorPosition?(): { row: number; column: number } | undefined
}

export interface DefaultTextStyle {
  color?: (text: string) => string
  bgColor?: (text: string) => string
  bold?: boolean
  italic?: boolean
  strikethrough?: boolean
  underline?: boolean
}

export interface MarkdownTheme {
  heading: (text: string) => string
  link: (text: string) => string
  linkUrl: (text: string) => string
  code: (text: string) => string
  codeBlock: (text: string) => string
  codeBlockBorder: (text: string) => string
  quote: (text: string) => string
  quoteBorder: (text: string) => string
  hr: (text: string) => string
  listBullet: (text: string) => string
  bold: (text: string) => string
  italic: (text: string) => string
  strikethrough: (text: string) => string
  underline: (text: string) => string
  highlightCode?: (code: string, language?: string) => string[]
  codeBlockIndent?: string
}

export interface Renderer {
  start(terminal: Pick<TerminalSession, 'write'>): void
  render(frame: RenderFrame): void
  stop(): void
}

export interface RenderFrame {
  readonly columns: number
  readonly rows: number
  renderLine(row: number): string
  getCursor(): { row: number; column: number; visible: boolean } | undefined
}
