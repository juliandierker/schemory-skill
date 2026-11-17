import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { CliError, run, writeSnapshot } from './lib.mjs'

const usage = `usage: snapshot-pg.mjs [--url-env <NAME> | --input <dump.sql>] [--out <dir>]

Runs pg_dump --schema-only against the database and writes the normalized result to
<out>/pg.sql. The connection URL is read from the environment variable named by
--url-env (default SCHEMORY_PG_URL), handed to pg_dump through libpq environment
variables and never printed or passed on the command line. --input normalizes an
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

const queryEnv = {
  sslmode: 'PGSSLMODE',
  channel_binding: 'PGCHANNELBINDING',
  options: 'PGOPTIONS',
  application_name: 'PGAPPNAME',
  connect_timeout: 'PGCONNECT_TIMEOUT',
  target_session_attrs: 'PGTARGETSESSIONATTRS',
}

function libpqEnv(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new CliError('database URL is not a valid postgres:// or postgresql:// URL')
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new CliError('database URL must start with postgres:// or postgresql://')
  }
  let env = {}
  if (parsed.hostname) env.PGHOST = decodeURIComponent(parsed.hostname)
  if (parsed.port) env.PGPORT = parsed.port
  if (parsed.username) env.PGUSER = decodeURIComponent(parsed.username)
  if (parsed.password) env.PGPASSWORD = decodeURIComponent(parsed.password)
  let database = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (database) env.PGDATABASE = database
  for (const [key, value] of parsed.searchParams) {
    let name = queryEnv[key]
    if (!name) throw new CliError(`unsupported database URL parameter: ${key}`)
    env[name] = value
  }
  return env
}

function dumpFromDatabase(url) {
  const result = spawnSync(
    'pg_dump',
    ['--schema-only', '--no-owner', '--no-privileges', '--no-comments', '--no-tablespaces'],
    {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, ...libpqEnv(url) },
    },
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
    const url = process.env[values['url-env']]
    if (!url) {
      throw new CliError(
        `no database URL: set the ${values['url-env']} environment variable (or pass --url-env <NAME>)`,
      )
    }
    dump = dumpFromDatabase(url)
  }
  if (!dump.trim()) throw new CliError('dump is empty')
  const normalized = normalizeDump(dump)
  const written = writeSnapshot(values.out, 'pg.sql', normalized)
  process.stdout.write(`wrote ${written}\n`)
})
