#!/usr/bin/env bun

import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const specDir = resolve(import.meta.dir, '../docs/specs/runtime-architecture')
const specPath = join(specDir, 'spec.md')
const tasksPath = join(specDir, 'tasks.md')

function uniqueIds(text: string, pattern: RegExp, label: string): Set<string> {
  const found = [...text.matchAll(pattern)].map((match) => match[1])
  const unique = new Set(found)
  if (unique.size !== found.length) {
    const duplicate = found.find((id, index) => found.indexOf(id) !== index)
    throw new Error(`Duplicate ${label}: ${duplicate}`)
  }
  return unique
}

const spec = await readFile(specPath, 'utf8')
const tasks = await readFile(tasksPath, 'utf8')
const requirementIds = uniqueIds(spec, /^### (REQ-\d{2})\b/gm, 'requirement')
const acceptanceIds = uniqueIds(spec, /^- \*\*(AC-\d{2}\.\d+)\*\*/gm, 'acceptance criterion')

if (requirementIds.size === 0 || acceptanceIds.size === 0) {
  throw new Error('Runtime spec must define requirements and acceptance criteria')
}

for (const [label, source, expected] of [
  ['task requirement reference', tasks, requirementIds],
  ['task acceptance reference', tasks, acceptanceIds],
] as const) {
  const pattern = label.includes('requirement') ? /REQ-\d{2}/g : /AC-\d{2}\.\d+/g
  for (const id of source.match(pattern) ?? []) {
    if (!expected.has(id)) throw new Error(`Unknown ${label}: ${id}`)
  }
}

const files = (await readdir(specDir)).filter((file) => file.endsWith('.md'))
const markdown = new Map(await Promise.all(files.map(async (file) => [file, await readFile(join(specDir, file), 'utf8')] as const)))
for (const [file, content] of markdown) {
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
    const target = match[1]
    if (/^(?:[a-z]+:|\/\/|#)/i.test(target)) continue
    const resolved = resolve(specDir, target)
    try {
      await readFile(resolved)
    } catch {
      throw new Error(`Broken Markdown link in ${file}: ${target}`)
    }
  }
}

console.log(`Runtime spec valid: ${requirementIds.size} REQ, ${acceptanceIds.size} AC, ${files.length} Markdown files`)
