/**
 * Temporary pi-tui compatibility seam.
 *
 * TUI views import through this module while the owned terminal engine and widgets
 * replace the legacy implementation. Keep direct pi-tui imports out of the rest
 * of src/tui so the dependency can be removed by replacing this adapter.
 */
export * from '@earendil-works/pi-tui'
