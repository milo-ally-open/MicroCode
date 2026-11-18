import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return listFiles(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  }))
  return nested.flat()
}

describe('TUI runtime import boundaries', () => {
  test('isolates the temporary pi-tui dependency behind one adapter', async () => {
    const tuiRoot = resolve(fileURLToPath(new URL('../../src/tui/', import.meta.url)))
    const files = await listFiles(tuiRoot)
    const imports = await Promise.all(files.map(async (path) => ({
      path,
      source: await readFile(path, 'utf8'),
    })))
    const piImports = imports
      .filter(({ source }) => /from\s+['"]@earendil-works\/pi-tui['"]/.test(source))
      .map(({ path }) => relative(tuiRoot, path).replaceAll('\\', '/'))
      .sort()

    expect(piImports).toEqual(['core/legacyPiAdapter.ts'])
  })

  test('permission views and facades import neutral permission contracts', async () => {
    const files = [
      new URL('../../src/tui/app.ts', import.meta.url),
      new URL('../../src/tui/agentPort.ts', import.meta.url),
      new URL('../../src/tui/runtimeAgentFacade.ts', import.meta.url),
    ]
    const sources = await Promise.all(files.map((file) => readFile(file, 'utf8')))

    expect(sources[0]).toContain("from '../permissions/types.ts'")
    expect(sources.join('\n')).not.toContain("from '../permissions/index.ts'")
  })
})
