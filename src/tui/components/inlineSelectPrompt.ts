import { Container, Text } from '../core/widgets.ts'
import type { InputEvent } from '../core/contracts.ts'
import { SelectList } from '../core/selectList.ts'

/** Select prompt that remains in the turn timeline after it is answered. */
export class InlineSelectPrompt extends Container {
  focused = false
  private choicesVisible = true
  private result?: Text
  private onRenderInvalidated?: () => void

  constructor(
    title: string,
    private readonly choices: SelectList,
  ) {
    super()
    this.addChild(new Text(title, 1, 0))
    this.addChild(choices)
  }

  handleInput(input: string | InputEvent): void {
    if (this.choicesVisible) this.choices.handleInput(input)
  }

  isTranscriptRenderStable(): boolean {
    return !this.choicesVisible
  }

  setRenderInvalidationListener(listener?: () => void): void {
    this.onRenderInvalidated = listener
  }

  complete(result: string): void {
    if (this.choicesVisible) {
      this.removeChild(this.choices)
      this.choicesVisible = false
    }
    if (this.result) this.removeChild(this.result)
    this.result = new Text(result, 1, 0)
    this.addChild(this.result)
    this.onRenderInvalidated?.()
  }
}
