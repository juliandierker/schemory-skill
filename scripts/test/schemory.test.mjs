import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemory.mjs')
const temp = mkdtempSync(path.join(tmpdir(), 'schemory-test-'))
const project = path.join(temp, 'fixture-app')
after(() => rmSync(temp, { recursive: true, force: true }))

const files = {
  'package.json': '{ "name": "fixture-app", "private": true }\n',
  'src/jobs/worker.ts': `import { z } from 'zod'
import { readFile } from 'node:fs/promises'

const DEFAULT_RETRIES = 3

export const JobSchema = z.object({ id: z.string(), retries: z.number() })
export type Job = z.infer<typeof JobSchema>

interface WorkerOptions {
  retries?: number
}

type Unrelated = { flag: boolean }

/** Processes analysis jobs one at a time. */
export class AnalysisWorker {
  private retries: number

  constructor(options: WorkerOptions = {}) {
    this.retries = options.retries ?? DEFAULT_RETRIES
  }

  async run(job: Job): Promise<void> {
    JobSchema.parse(job)
  }
}

export function unrelatedHelper(): Unrelated {
  return { flag: readFile !== undefined }
}
`,
  'src/components/Badge.tsx': `import { useState } from 'react'
import type { ReactNode } from 'react'

const sizes = { sm: 'px-2', lg: 'px-4' } as const
const pattern = /^[a-z]+\\/[0-9]+$/
const label = (n: number) => \`count: \${n > 1 ? \`\${n}x\` : 'once'}\`

export type Size = keyof typeof sizes

export function Badge({ size, children }: { size: Size; children: ReactNode }) {
  const [count, setCount] = useState(0)
  return (
    <span className={sizes[size]} onClick={() => setCount(count + 1)}>
      Don't click {label(count)} <b>{children}</b>
      <br />
    </span>
  )
}

export function Unused() {
  return pattern.test('a/1')
}
`,
  'src/client.ts': `export const client = { apiKey: 'sk_live_abcdefghijklmnop1234', region: 'eu' }\n`,
}

for (const [rel, content] of Object.entries(files)) {
  mkdirSync(path.dirname(path.join(project, rel)), { recursive: true })
  writeFileSync(path.join(project, rel), content)
}

function freshHome() {
  return mkdtempSync(path.join(temp, 'home-'))
}

function run(home, ...args) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, SCHEMORY_HOME: home },
  })
}

const worker = path.join(project, 'src/jobs/worker.ts')
const badge = path.join(project, 'src/components/Badge.tsx')

test('snapshot saves the entity with its same-file dependencies and source', () => {
  const home = freshHome()
  const result = run(
    home,
    'snapshot',
    worker,
    'AnalysisWorker',
    '--name',
    'workerBlueprint',
    '--date',
    '2026-01-02',
  )
  assert.equal(result.status, 0, result.stderr)
  const saved = readFileSync(path.join(home, 'workerBlueprint.md'), 'utf8')
  assert.match(saved, /^---\nname: workerBlueprint\nentity: AnalysisWorker\nkind: class\n/)
  assert.match(saved, /source: fixture-app\/src\/jobs\/worker\.ts\ndate: 2026-01-02\n/)
  assert.match(
    saved,
    /\/\*\* Processes analysis jobs one at a time\. \*\/\nexport class AnalysisWorker \{/,
  )
  for (const dep of [
    'const DEFAULT_RETRIES = 3',
    'export const JobSchema',
    'export type Job',
    'interface WorkerOptions',
    "import { z } from 'zod'",
  ]) {
    assert.ok(saved.includes(dep), `missing ${dep}`)
  }
  for (const unrelated of ['Unrelated', 'unrelatedHelper', 'node:fs/promises']) {
    assert.ok(!saved.includes(unrelated), `unexpected ${unrelated}`)
  }
})

test('snapshot is deterministic', () => {
  const a = freshHome()
  const b = freshHome()
  run(a, 'snapshot', worker, 'AnalysisWorker', '--name', 'w', '--date', '2026-01-02')
  run(b, 'snapshot', worker, 'AnalysisWorker', '--name', 'w', '--date', '2026-01-02')
  assert.equal(
    readFileSync(path.join(a, 'w.md'), 'utf8'),
    readFileSync(path.join(b, 'w.md'), 'utf8'),
  )
})

test('snapshot handles tsx with templates, regexes and JSX text', () => {
  const home = freshHome()
  const result = run(home, 'snapshot', badge, 'Badge', '--name', 'component-blueprint')
  assert.equal(result.status, 0, result.stderr)
  const saved = readFileSync(path.join(home, 'component-blueprint.md'), 'utf8')
  assert.match(saved, /```tsx\nexport function Badge/)
  for (const dep of [
    'const sizes',
    'const label',
    'export type Size',
    "import { useState } from 'react'",
    "import type { ReactNode } from 'react'",
  ]) {
    assert.ok(saved.includes(dep), `missing ${dep}`)
  }
  assert.ok(!saved.includes('const pattern'), 'unexpected pattern')
  assert.ok(!saved.includes('Unused'), 'unexpected Unused')
})

test('snapshot refuses to overwrite without --force', () => {
  const home = freshHome()
  assert.equal(run(home, 'snapshot', worker, 'JobSchema', '--name', 'job').status, 0)
  const again = run(home, 'snapshot', worker, 'AnalysisWorker', '--name', 'job')
  assert.equal(again.status, 1)
  assert.match(again.stderr, /already exists.*--force/)
  assert.match(readFileSync(path.join(home, 'job.md'), 'utf8'), /entity: JobSchema/)
  assert.equal(
    run(home, 'snapshot', worker, 'AnalysisWorker', '--name', 'job', '--force').status,
    0,
  )
  assert.match(readFileSync(path.join(home, 'job.md'), 'utf8'), /entity: AnalysisWorker/)
})

test('snapshot rejects bad names, unknown entities and missing files', () => {
  const home = freshHome()
  const bad = run(home, 'snapshot', worker, 'JobSchema', '--name', 'Bad_Name')
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /invalid name "Bad_Name"/)
  const unknown = run(home, 'snapshot', worker, 'Nope', '--name', 'x')
  assert.equal(unknown.status, 1)
  assert.match(
    unknown.stderr,
    /no top-level declaration "Nope"\. Declared: AnalysisWorker, DEFAULT_RETRIES, Job, JobSchema/,
  )
  const missing = run(home, 'snapshot', path.join(project, 'nope.ts'), 'X', '--name', 'x')
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /file not found/)
  assert.ok(!existsSync(path.join(home, 'x.md')))
})

test('snapshot refuses credential-like code unless --allow-suspect', () => {
  const home = freshHome()
  const client = path.join(project, 'src/client.ts')
  const refused = run(home, 'snapshot', client, 'client', '--name', 'client')
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /look like credentials/)
  assert.ok(!existsSync(path.join(home, 'client.md')))
  assert.equal(
    run(home, 'snapshot', client, 'client', '--name', 'client', '--allow-suspect').status,
    0,
  )
})

test('list and use', () => {
  const home = freshHome()
  assert.match(run(home, 'list').stdout, /no blueprints in/)
  run(
    home,
    'snapshot',
    worker,
    'AnalysisWorker',
    '--name',
    'workerBlueprint',
    '--date',
    '2026-01-02',
  )
  run(home, 'snapshot', worker, 'JobSchema', '--name', 'job-schema', '--date', '2026-01-03')
  const listed = run(home, 'use').stdout
  assert.equal(
    listed,
    [
      'NAME             ENTITY                SOURCE                          DATE',
      'job-schema       const JobSchema       fixture-app/src/jobs/worker.ts  2026-01-03',
      'workerBlueprint  class AnalysisWorker  fixture-app/src/jobs/worker.ts  2026-01-02',
      '',
    ].join('\n'),
  )
  assert.equal(run(home, 'list').stdout, listed)
  const used = run(home, 'use', 'workerBlueprint')
  assert.equal(used.status, 0)
  assert.equal(used.stdout, readFileSync(path.join(home, 'workerBlueprint.md'), 'utf8'))
  const unknown = run(home, 'use', 'nope')
  assert.equal(unknown.status, 1)
  assert.match(unknown.stderr, /no blueprint "nope".*Saved: job-schema, workerBlueprint/)
})
