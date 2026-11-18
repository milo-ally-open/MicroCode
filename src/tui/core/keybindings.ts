import { TerminalInputDecoder, matchesKey } from './inputDecoder.ts'

export type TuiAction = 'select.up' | 'select.down' | 'select.confirm' | 'select.cancel' | 'select.pageUp' | 'select.pageDown'

const actionKeys: Record<TuiAction, readonly string[]> = {
  'select.up': ['up'],
  'select.down': ['down'],
  'select.confirm': ['enter'],
  'select.cancel': ['escape', 'ctrl+c'],
  'select.pageUp': ['pageUp'],
  'select.pageDown': ['pageDown'],
}

function isCtrlC(raw: string): boolean {
  const decoder = new TerminalInputDecoder()
  const event = [...decoder.feed(raw), ...decoder.flushPending()][0]
  return event?.type === 'key' && event.ctrl && event.key.toLowerCase() === 'c'
}

/** Microcode-owned default key actions for list and prompt widgets. */
export function matchesTuiAction(raw: string, action: TuiAction): boolean {
  if (action === 'select.cancel' && isCtrlC(raw)) return true
  return actionKeys[action].some((key) => matchesKey(raw, key))
}
