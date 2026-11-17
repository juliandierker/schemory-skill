import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { CliError, run } from './lib.mjs'

const usage = `usage: diff.mjs <before-dir> <after-dir>

Compares the snapshot files present in either directory and prints, per file, the
removed (-) and added (+) lines. Removed lines are potential breaking changes.
Exit code 0 means the comparison ran, whether or not anything differs.`

function lineDiff(before, after) {
  const a = before.split('\n')
  const b = after.split('\n')
  const table = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] =
        a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const out = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++
      j++
    } else if (j >= b.length || (i < a.length && table[i + 1][j] >= table[i][j + 1])) {
      out.push(`- ${a[i++]}`)
    } else {
      out.push(`+ ${b[j++]}`)
    }
  }
  return out
}

function readDir(dir) {
  if (!existsSync(dir)) throw new CliError(`snapshot directory not found: ${dir}`)
  return new Map(
    readdirSync(dir)
      .sort()
      .map((name) => [name, readFileSync(path.join(dir, name), 'utf8')]),
  )
}

run(() => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { help: { type: 'boolean', default: false } },
  })
  if (values.help) {
    process.stdout.write(`${usage}\n`)
    return
  }
  if (positionals.length !== 2) throw new CliError(`expected two directories\n${usage}`)
  const before = readDir(path.resolve(positionals[0]))
  const after = readDir(path.resolve(positionals[1]))
  const names = [...new Set([...before.keys(), ...after.keys()])].sort((x, y) =>
    x < y ? -1 : x > y ? 1 : 0,
  )
  let changed = 0
  for (const name of names) {
    if (!before.has(name)) {
      process.stdout.write(`== ${name}: new snapshot\n`)
      changed++
      continue
    }
    if (!after.has(name)) {
      process.stdout.write(`== ${name}: snapshot missing after the change\n`)
      changed++
      continue
    }
    const lines = lineDiff(before.get(name), after.get(name))
    if (lines.length === 0) continue
    changed++
    const removed = lines.filter((line) => line.startsWith('- ')).length
    process.stdout.write(
      `== ${name}: ${removed} removed, ${lines.length - removed} added\n${lines.join('\n')}\n`,
    )
  }
  if (changed === 0) process.stdout.write('no changes\n')
})
