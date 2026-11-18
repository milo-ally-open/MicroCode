# TUI Engine Replacement Specification

**Status:** In progress  
**Scope:** Replace Microcode's dependency on `@earendil-works/pi-tui` with an owned terminal UI engine.  
**Platforms:** Windows, Linux, and macOS interactive terminals.

## Goal

`microcode` should start as a terminal application on all supported operating systems without requiring a platform-specific shell or a separate UI runtime. The owned TUI engine handles terminal input/output, rendering, layout, focus, and UI widgets. Agent, model, tool, session, and runtime-service behavior remain behind the existing TUI ports.

## Requirements

### REQ-TUI-01: Platform-neutral terminal session

The terminal session uses process input/output streams and terminal capabilities rather than OS-specific shell behavior. It reports terminal size changes, decodes input into normalized events, and restores the prior raw-input state when stopped.

**Acceptance:**

- **AC-TUI-01.1:** The terminal session has no Windows-, Linux-, or macOS-specific branch for ordinary input, resize, or output.
- **AC-TUI-01.2:** Tests cover raw-mode restoration, key input, paste, mouse, and resize events through an injected terminal session.
- **AC-TUI-01.3:** Interactive startup and shutdown are manually verified in Windows Terminal, PowerShell/cmd, VS Code Terminal, and representative Linux/macOS terminals.

### REQ-TUI-02: Owned input and component contracts

Terminal input is normalized into key, paste, mouse, resize, and unknown events. Components, focus targets, renderers, and terminal sessions are typed by Microcode-owned contracts.

**Acceptance:**

- **AC-TUI-02.1:** Application and view modules depend on owned TUI contracts, not Pi TUI types.
- **AC-TUI-02.2:** Escape-key ambiguity, split escape sequences, modified keys, bracketed paste, and SGR mouse events have focused tests.

### REQ-TUI-03: Cell-based differential rendering

The renderer stores text in terminal cells, respects grapheme and display-column widths, preserves ANSI styling safely, and repaints only changed rows. It handles narrow terminal dimensions without emitting partial wide graphemes.

**Acceptance:**

- **AC-TUI-03.1:** CJK, combining marks, emoji sequences, ANSI colors, clipping, and changed-row behavior have unit coverage.
- **AC-TUI-03.2:** Terminal mode cleanup restores the cursor and exits the alternate screen after normal shutdown.

### REQ-TUI-04: Preserve TUI behavior

The migration preserves the current editor and command flows, autocomplete, permission prompts, scrolling, tool interaction targets, streaming updates, session behavior, and the existing concise tool-presentation contracts.

**Acceptance:**

- **AC-TUI-04.1:** Existing TUI/runtime contract tests continue to pass throughout migration.
- **AC-TUI-04.2:** App exit, Ctrl+C, cancellation, and failure paths restore terminal state and retain session/runtime cleanup behavior.

### REQ-TUI-05: Remove the Pi TUI dependency

After all views and interactive controls use the owned engine, no source under `src/tui` imports `@earendil-works/pi-tui`; the package is removed from the manifest and lockfile.

**Acceptance:**

- **AC-TUI-05.1:** Static import-boundary check finds no Pi TUI imports under `src/tui`.
- **AC-TUI-05.2:** Full tests and the production build pass, followed by manual terminal checks on the supported platform matrix.

## Design

```text
Agent / Runtime ports
        ↓
App workflows and view state
        ↓
Transcript, tool cards, editor, dialogs, and selection widgets
        ↓
Owned TUI engine: input events, focus, layout, cell buffer, diff renderer
        ↓
Process terminal session: stdin/stdout, terminal size, ANSI modes, cleanup
```

The migration uses a temporary adapter as the only location allowed to import Pi TUI. This permits view modules to move to owned contracts and utilities in small, reviewable steps. The adapter is removed after the editor, selection widgets, prompts, and application loop have migrated.

The engine uses ANSI/VT terminal controls and does not add OS-specific shell requirements. Terminal capability limitations must have a readable fallback or be included in the documented supported-terminal matrix.

## Current Interaction Baseline

- **Startup and focus:** `App.run()` restores the current session, subscribes to Agent events, creates the prompt editor, places the editor in focus, starts the UI, and enables SGR mouse reporting.
- **Input order:** App-level input listeners run before the focused component. The layout handles PageUp/PageDown and mouse scrolling, scrollbar dragging, tool-preview hit targets, and return-to-latest interaction. When autocomplete is visible, layout scrolling yields to the editor.
- **Editor behavior:** the editor owns text editing, cursor movement, history, undo, and asynchronous autocomplete. `$` opens skill completion, `#` opens plugin completion, Ctrl+V/Shift+Insert requests clipboard-image input, Escape cancels autocomplete before App-level behavior, Ctrl+C cancels/exits according to the active workflow, and Ctrl+D exits only when the prompt is empty.
- **Interactive workflows:** model/provider, auth, MCP, session/task, Git, permission, and question flows move focus among select lists, multi-select lists, prompts, and the editor. Their callbacks can be asynchronous and must restore focus after completion/cancellation.
- **Streaming:** Agent and tool events update the active timeline/tool row. Streaming tool frames may request an immediate render; working and elapsed-time rows use timers that must stop during shutdown.
- **Shutdown:** App shutdown aborts active auth, unsubscribes runtime events, cancels active Bash work, stops timers, disables SGR mouse tracking, and stops the UI. The caller then closes the selected local or daemon runtime path.
- **Terminal verification targets:** Windows Terminal, PowerShell, cmd, VS Code integrated terminal, common Linux terminal emulators, macOS Terminal, and iTerm2. `microcode` should be the only command needed to enter the interactive UI; shell choice must not be a prerequisite.

## Work Items

- [x] P0 source inventory: inspect input listeners, focus changes, terminal mode setup/cleanup, scrolling, mouse hit targets, streaming, shutdown, and existing TUI tests; record the cross-platform terminal matrix.
- [x] P1 boundary start: add owned `TerminalSession`, `InputEvent`, `Renderer`, `Component`, and `Focusable` contracts; isolate direct Pi imports behind a temporary adapter.
- [ ] P1 finish migration: replace Pi TUI types and utility calls in the remaining application/view modules with owned contracts.
- [ ] P2 finish core: harden input parsing, terminal lifecycle, grapheme-aware cells, resize/layout behavior, cursor/IME positioning, and renderer recovery.
- [ ] P3 finish views: migrate the main transcript, fixed prompt/footer, timeline, and tool views to the owned renderer.
- [ ] P4 replace editor, autocomplete, selection lists, prompts, and focus workflows while retaining existing command behavior.
- [ ] P5 remove the adapter and Pi TUI dependency; run full regression/build and cross-platform manual verification.

## Current Evidence and Limits

The initial core implementation lives under `src/tui/core/`. Focused tests cover text width, wrapping, basic widgets, input decoding, screen buffering, differential output, terminal-session cleanup, focus dispatch, and resize redraw. The live App still runs on Pi TUI, so platform support and end-to-end interaction preservation remain unverified until the later migration phases.
