import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { CliError, resolveFrom, run, sortKeys, writeSnapshot } from './lib.mjs'

const usage = `usage: snapshot-zod.mjs [--out <dir>] [--project <dir>] [--resolve-from <dir>] <file>...

Each <file> is either a JSON Schema file (.json) or a module (.js, .mjs, .ts) whose
exports are Zod schemas. Writes <out>/zod.json mapping names to JSON Schema.
Zod is resolved from the project (zod 4 toJSONSchema, or zod-to-json-schema for zod 3).
Defaults: project=., out=.schemory/current.`

function isZodSchema(value) {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof value.safeParse === 'function' &&
    ('_zod' in value || '_def' in value)
  )
}

function createConverter(resolveDir) {
  let converter
  return () => {
    if (converter) return converter
    const { require } = resolveFrom(resolveDir, 'zod/package.json')
    const zod = require('zod')
    if (typeof zod.toJSONSchema === 'function') {
      converter = (schema) => zod.toJSONSchema(schema)
    } else {
      let legacy
      try {
        legacy = require('zod-to-json-schema')
      } catch {
        throw new CliError(
          'the installed zod has no toJSONSchema (zod 3); install zod-to-json-schema in the project or upgrade zod',
        )
      }
      const fn = legacy.zodToJsonSchema ?? legacy.default
      converter = (schema) => fn(schema)
    }
    return converter
  }
}

run(async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      project: { type: 'string', default: '.' },
      out: { type: 'string', default: '.schemory/current' },
      'resolve-from': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  })
  if (values.help) {
    process.stdout.write(`${usage}\n`)
    return
  }
  if (positionals.length === 0) throw new CliError(`no input files given\n${usage}`)
  const getConverter = createConverter(values['resolve-from'] ?? values.project)
  const schemas = {}

  for (const input of positionals) {
    const file = path.resolve(values.project, input)
    if (!existsSync(file)) throw new CliError(`input not found: ${file}`)
    const stem = path.basename(file).replace(/\.[^.]+$/, '')
    if (file.endsWith('.json')) {
      let parsed
      try {
        parsed = JSON.parse(readFileSync(file, 'utf8'))
      } catch (error) {
        throw new CliError(`invalid JSON in ${file}: ${error.message}`)
      }
      schemas[stem] = parsed
      continue
    }
    let mod
    try {
      mod = await import(pathToFileURL(file).href)
    } catch (error) {
      throw new CliError(`cannot import ${file}: ${error.message}`)
    }
    const names = Object.keys(mod).filter((name) => isZodSchema(mod[name]))
    if (names.length === 0) throw new CliError(`no Zod schema exports found in ${file}`)
    for (const name of names) {
      const key = `${stem}.${name}`
      try {
        schemas[key] = getConverter()(mod[name])
      } catch (error) {
        if (error instanceof CliError) throw error
        throw new CliError(`cannot convert ${key} to JSON Schema: ${error.message}`)
      }
    }
  }

  const written = writeSnapshot(values.out, 'zod.json', JSON.stringify(sortKeys(schemas), null, 2))
  process.stdout.write(`wrote ${written} (${Object.keys(schemas).length} schemas)\n`)
})
