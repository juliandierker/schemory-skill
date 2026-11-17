import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const scripts = path.join(here, '..')
const fixtures = path.join(here, 'fixtures')

function node(script, args, env = {}) {
  return spawnSync(process.execPath, [path.join(scripts, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), 'schemory-test-'))
}

function findLibrary(name) {
  const candidates = [
    path.join(here, '..', '..', '..', '..', 'web'),
    path.join(here, '..', '..', '..', '..'),
  ]
  for (const dir of candidates) {
    try {
      createRequire(path.join(dir, 'noop.js')).resolve(`${name}/package.json`)
      return dir
    } catch {
      continue
    }
  }
  return null
}

const tsHome = findLibrary('typescript')
const zodHome = findLibrary('zod')

test(
  'snapshot-ts writes normalized declarations deterministically',
  { skip: !tsHome && 'typescript not resolvable from the repository' },
  () => {
    const project = path.join(fixtures, 'ts-project')
    const outA = tempDir()
    const outB = tempDir()
    try {
      const a = node('snapshot-ts.mjs', [
        '--project',
        project,
        '--out',
        outA,
        '--resolve-from',
        tsHome,
      ])
      assert.equal(a.status, 0, a.stderr)
      const b = node('snapshot-ts.mjs', [
        '--project',
        project,
        '--out',
        outB,
        '--resolve-from',
        tsHome,
      ])
      assert.equal(b.status, 0, b.stderr)
      const first = readFileSync(path.join(outA, 'ts.d.ts'), 'utf8')
      assert.equal(first, readFileSync(path.join(outB, 'ts.d.ts'), 'utf8'))
      assert.match(first, /^\/\/ src\/index\.d\.ts\n/)
      assert.match(first, /export interface User/)
      assert.match(first, /export declare function greet\(user: User, role\?: Role\): string;/)
    } finally {
      rmSync(outA, { recursive: true, force: true })
      rmSync(outB, { recursive: true, force: true })
    }
  },
)

test('snapshot-ts fails clearly when typescript cannot be resolved', () => {
  const project = tempDir()
  try {
    writeFileSync(path.join(project, 'tsconfig.json'), '{}')
    const result = node('snapshot-ts.mjs', [
      '--project',
      project,
      '--out',
      path.join(project, 'out'),
      '--resolve-from',
      project,
    ])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /cannot resolve "typescript\/package\.json"/)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('snapshot-ts fails without a tsconfig', () => {
  const project = tempDir()
  try {
    const result = node('snapshot-ts.mjs', ['--project', project])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /no tsconfig\.json/)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('snapshot-zod accepts plain JSON Schema files with sorted keys', () => {
  const out = tempDir()
  try {
    const result = node('snapshot-zod.mjs', [
      '--project',
      path.join(fixtures, 'zod-project'),
      '--out',
      out,
      'user.schema.json',
    ])
    assert.equal(result.status, 0, result.stderr)
    const written = readFileSync(path.join(out, 'zod.json'), 'utf8')
    const parsed = JSON.parse(written)
    assert.deepEqual(Object.keys(parsed['user.schema'].properties), ['id', 'name'])
    assert.deepEqual(Object.keys(parsed['user.schema']), ['properties', 'required', 'type'])
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('snapshot-zod fails clearly when zod cannot be resolved', () => {
  const project = tempDir()
  try {
    writeFileSync(
      path.join(project, 'schema.mjs'),
      'export const User = { safeParse() {}, _zod: {} }\n',
    )
    const result = node('snapshot-zod.mjs', [
      '--project',
      project,
      '--out',
      path.join(project, 'out'),
      'schema.mjs',
    ])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /cannot resolve "zod\/package\.json"/)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('snapshot-zod rejects missing inputs and invalid JSON', () => {
  const project = tempDir()
  try {
    const missing = node('snapshot-zod.mjs', ['--project', project, 'nope.json'])
    assert.notEqual(missing.status, 0)
    assert.match(missing.stderr, /input not found/)
    writeFileSync(path.join(project, 'bad.json'), '{')
    const bad = node('snapshot-zod.mjs', ['--project', project, 'bad.json'])
    assert.notEqual(bad.status, 0)
    assert.match(bad.stderr, /invalid JSON/)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test(
  'snapshot-zod converts Zod schemas',
  {
    skip:
      !zodHome && 'zod not resolvable from the repository (install zod in a project to run this)',
  },
  () => {
    const out = tempDir()
    try {
      const result = node('snapshot-zod.mjs', [
        '--project',
        path.join(fixtures, 'zod-project'),
        '--out',
        out,
        '--resolve-from',
        zodHome,
        'user.mjs',
      ])
      assert.equal(result.status, 0, result.stderr)
      const parsed = JSON.parse(readFileSync(path.join(out, 'zod.json'), 'utf8'))
      assert.deepEqual(Object.keys(parsed), ['user.User'])
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  },
)

test('snapshot-pg normalizes a dump independent of order, SET lines and ownership', () => {
  const out = tempDir()
  try {
    const first = node('snapshot-pg.mjs', [
      '--input',
      path.join(fixtures, 'pg', 'sample-dump.sql'),
      '--out',
      path.join(out, 'a'),
    ])
    assert.equal(first.status, 0, first.stderr)
    const second = node('snapshot-pg.mjs', [
      '--input',
      path.join(fixtures, 'pg', 'sample-dump-reordered.sql'),
      '--out',
      path.join(out, 'b'),
    ])
    assert.equal(second.status, 0, second.stderr)
    const a = readFileSync(path.join(out, 'a', 'pg.sql'), 'utf8')
    assert.equal(a, readFileSync(path.join(out, 'b', 'pg.sql'), 'utf8'))
    assert.doesNotMatch(a, /OWNER TO|^SET |^--|restrict|set_config/m)
    assert.match(a, /CREATE TABLE public\.accounts/)
    assert.match(a, /\$\$;/)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('snapshot-pg writes an empty snapshot for a database without schema objects', () => {
  const out = tempDir()
  try {
    const result = node('snapshot-pg.mjs', [
      '--input',
      path.join(fixtures, 'pg', 'empty-dump.sql'),
      '--out',
      out,
    ])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(path.join(out, 'pg.sql'), 'utf8').trim(), '')
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('snapshot-pg requires a URL and never echoes it', () => {
  const missing = node('snapshot-pg.mjs', [], { SCHEMORY_PG_URL: '' })
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /no database URL/)

  const secret = 'postgres://user:s3cretpw@127.0.0.1:1/db'
  const out = tempDir()
  try {
    const result = node('snapshot-pg.mjs', ['--out', out], { SCHEMORY_PG_URL: secret })
    assert.notEqual(result.status, 0)
    assert.doesNotMatch(result.stdout + result.stderr, /s3cretpw/)
    assert.equal(existsSync(path.join(out, 'pg.sql')), false)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('diff reports removed and added lines between snapshot directories', () => {
  const root = tempDir()
  try {
    const before = path.join(root, 'before')
    const after = path.join(root, 'after')
    mkdirSync(before)
    mkdirSync(after)
    writeFileSync(path.join(before, 'ts.d.ts'), 'a\nb\nc\n')
    writeFileSync(path.join(after, 'ts.d.ts'), 'a\nc\nd\n')
    writeFileSync(path.join(after, 'pg.sql'), 'x\n')
    const result = node('diff.mjs', [before, after])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /== pg\.sql: new snapshot/)
    assert.match(result.stdout, /== ts\.d\.ts: 1 removed, 1 added\n- b\n\+ d/)

    const same = node('diff.mjs', [before, before])
    assert.equal(same.stdout, 'no changes\n')
    const bad = node('diff.mjs', [before, path.join(root, 'nope')])
    assert.notEqual(bad.status, 0)
    assert.match(bad.stderr, /snapshot directory not found/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
