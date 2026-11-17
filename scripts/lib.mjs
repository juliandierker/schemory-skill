import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export class CliError extends Error {}

export function run(main) {
  Promise.resolve()
    .then(main)
    .catch((error) => {
      if (error instanceof CliError) {
        process.stderr.write(`error: ${error.message}\n`)
      } else {
        process.stderr.write(`error: unexpected failure: ${error?.stack ?? error}\n`)
      }
      process.exitCode = 1
    })
}

export function resolveFrom(dir, specifier) {
  const require = createRequire(path.join(path.resolve(dir), 'noop.js'))
  try {
    return { require, resolved: require.resolve(specifier) }
  } catch {
    throw new CliError(
      `cannot resolve "${specifier}" from ${path.resolve(dir)}. Install it in the target project or pass --resolve-from <dir>.`,
    )
  }
}

export function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    )
  }
  return value
}

export function writeSnapshot(outDir, name, content) {
  const dir = path.resolve(outDir)
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, name)
  writeFileSync(file, content.endsWith('\n') ? content : `${content}\n`)
  return file
}
