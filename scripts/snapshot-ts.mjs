import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { CliError, resolveFrom, run, writeSnapshot } from './lib.mjs'

const usage = `usage: snapshot-ts.mjs [--project <dir>] [--out <dir>] [--resolve-from <dir>]

Writes <out>/ts.d.ts with the declaration output of the project's tsconfig.json,
using the project's own typescript install. Defaults: project=., out=.schemory/current.`

function listFiles(dir) {
  const result = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) result.push(...listFiles(full))
    else if (entry.name.endsWith('.d.ts')) result.push(full)
  }
  return result
}

function normalize(text) {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.startsWith('//# sourceMappingURL='))
    .join('\n')
    .trim()
}

run(() => {
  const { values } = parseArgs({
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
  const projectDir = path.resolve(values.project)
  const tsconfig = path.join(projectDir, 'tsconfig.json')
  if (!existsSync(tsconfig)) throw new CliError(`no tsconfig.json in ${projectDir}`)

  const { resolved } = resolveFrom(values['resolve-from'] ?? projectDir, 'typescript/package.json')
  const pkgPath = path.dirname(resolved)
  const pkg = JSON.parse(readFileSync(resolved, 'utf8'))
  const tscRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.tsc
  if (!tscRel) throw new CliError(`typescript at ${pkgPath} has no tsc binary`)

  const tmp = mkdtempSync(path.join(tmpdir(), 'schemory-ts-'))
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(pkgPath, tscRel),
        '-p',
        tsconfig,
        '--declaration',
        '--emitDeclarationOnly',
        '--noEmit',
        'false',
        '--declarationMap',
        'false',
        '--incremental',
        'false',
        '--composite',
        'false',
        '--rootDir',
        projectDir,
        '--outDir',
        tmp,
      ],
      { cwd: projectDir, encoding: 'utf8' },
    )
    if (result.error) throw new CliError(`failed to run tsc: ${result.error.message}`)
    const files = listFiles(tmp)
      .map((file) => path.relative(tmp, file).split(path.sep).join('/'))
      .sort()
    if (files.length === 0) {
      throw new CliError(
        `tsc emitted no declarations (exit ${result.status}):\n${result.stdout}${result.stderr}`,
      )
    }
    if (result.status !== 0) {
      process.stderr.write(
        `warning: tsc reported errors, snapshot may be incomplete:\n${result.stdout}`,
      )
    }
    const body = files
      .map((file) => `// ${file}\n${normalize(readFileSync(path.join(tmp, file), 'utf8'))}`)
      .join('\n\n')
    const written = writeSnapshot(values.out, 'ts.d.ts', body)
    process.stdout.write(`wrote ${written} (${files.length} files)\n`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
