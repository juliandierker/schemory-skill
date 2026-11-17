import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { CliError, run, writeSnapshot } from './lib.mjs'

const usage = `usage: snapshot-pg.mjs [--url-env <NAME> | --url <url> | --input <dump.sql>] [--out <dir>]

Runs pg_dump --schema-only against the database and writes the normalized result to
<out>/pg.sql. The connection URL is read from the environment variable named by
--url-env (default SCHEMORY_PG_URL) and is never printed. --input normalizes an
existing dump instead of connecting. Default out: .schemory/current.`

const dropPatterns = [
  /^SET\s/i,
  /^SELECT\s+pg_catalog\.set_config\(/i,
  /^ALTER\s.+\sOWNER\s+TO\s/i,
  /^\\/,
  /^COMMENT\s+ON\s+EXTENSION\s/i,
]

function splitStatements(text) {
  const statements = []
  let current = []
  let dollarTag = null
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (dollarTag === null && current.length === 0 && (line.trim() === '' || line.startsWith('--')))
      continue
    current.push(line)
    for (const match of line.matchAll(/\$[A-Za-z_0-9]*\$/g)) {
      if (dollarTag === null) dollarTag = match[0]
      else if (dollarTag === match[0]) dollarTag = null
    }
    if (dollarTag === null && line.trimEnd().endsWith(';')) {
      statements.push(current.join('\n').trim())
      current = []
    } else if (dollarTag === null && line.startsWith('\\')) {
      current = []
    }
  }
  if (current.join('').trim()) statements.push(current.join('\n').trim())
  return statements
}

function normalizeDump(text) {
  const kept = splitStatements(text).filter(
    (statement) => !dropPatterns.some((pattern) => pattern.test(statement)),
  )
  return [...new Set(kept)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join('\n\n')
}

function dumpFromDatabase(url) {
  const result = spawnSync(
    'pg_dump',
    [
      '--schema-only',
      '--no-owner',
      '--no-privileges',
      '--no-comments',
      '--no-tablespaces',
      '--dbname',
      url,
    ],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  )
  if (result.error?.code === 'ENOENT') {
    throw new CliError('pg_dump not found on PATH; install the PostgreSQL client tools')
  }
  if (result.error) throw new CliError(`failed to run pg_dump: ${result.error.message}`)
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').split(url).join('<redacted>').trim()
    throw new CliError(`pg_dump failed (exit ${result.status}): ${stderr}`)
  }
  return result.stdout
}

run(() => {
  const { values } = parseArgs({
    options: {
      'url-env': { type: 'string', default: 'SCHEMORY_PG_URL' },
      url: { type: 'string' },
      input: { type: 'string' },
      out: { type: 'string', default: '.schemory/current' },
      help: { type: 'boolean', default: false },
    },
  })
  if (values.help) {
    process.stdout.write(`${usage}\n`)
    return
  }
  let dump
  if (values.input) {
    const file = path.resolve(values.input)
    if (!existsSync(file)) throw new CliError(`input not found: ${file}`)
    dump = readFileSync(file, 'utf8')
  } else {
    const url = values.url ?? process.env[values['url-env']]
    if (!url) {
      throw new CliError(
        `no database URL: set the ${values['url-env']} environment variable (or pass --url-env <NAME>)`,
      )
    }
    dump = dumpFromDatabase(url)
  }
  const normalized = normalizeDump(dump)
  if (!normalized) throw new CliError('dump contains no schema statements')
  const written = writeSnapshot(values.out, 'pg.sql', normalized)
  process.stdout.write(`wrote ${written}\n`)
})
