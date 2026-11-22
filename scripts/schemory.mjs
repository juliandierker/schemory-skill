#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const usage = `usage:
  schemory.mjs snapshot <file> <entity> --name <name> [--force] [--allow-suspect]
                        [--project <dir>] [--date YYYY-MM-DD]
  schemory.mjs list
  schemory.mjs use [name]

Blueprints live in $SCHEMORY_HOME (default ~/.schemory) as <name>.md.
Names are kebab-case (worker-blueprint) or camelCase (workerBlueprint).`

class CliError extends Error {}

const NAME = /^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)+|[a-z][a-zA-Z0-9]*)$/

const SUSPECT = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"`]+:[^\s@'"`]+@/i,
  /(?:secret|password|passwd|pwd|token|api[_-]?key|private[_-]?key|credential)\w*['"`]?\s*[:=]\s*['"`][^'"`\s]{6,}['"`]/i,
]

const REGEX_AFTER_WORD = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
])

const CONTINUE_END = new Set([
  '=',
  ',',
  '.',
  '?.',
  '=>',
  '(',
  '[',
  '{',
  ':',
  '?',
  '|',
  '&',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '!',
  '~',
  '^',
  '==',
  '===',
  '!=',
  '!==',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
  '+=',
  '-=',
  '*=',
  '/=',
  '|=',
  '&=',
  '??=',
  '||=',
  '&&=',
  '**',
  '<<',
  '...',
  '@',
  'extends',
  'implements',
  'satisfies',
  'keyof',
  'typeof',
  'new',
  'instanceof',
  'export',
  'declare',
  'abstract',
])

const CONTINUE_START = new Set([
  '.',
  '?.',
  ')',
  ']',
  '}',
  '?',
  ':',
  '|',
  '&',
  '=>',
  '=',
  ',',
  '+',
  '*',
  '/',
  '%',
  '<',
  '>',
  '==',
  '===',
  '!=',
  '!==',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
  '**',
  'as',
  'satisfies',
  'extends',
  'implements',
  'from',
  '(',
  '[',
])

const PUNCT = [
  '>>>=',
  '...',
  '===',
  '!==',
  '**=',
  '<<=',
  '>>=',
  '>>>',
  '&&=',
  '||=',
  '??=',
  '=>',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
  '?.',
  '++',
  '--',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '**',
  '<<',
  '>>',
]

const DECL_KINDS = new Map([
  ['function', 'function'],
  ['class', 'class'],
  ['interface', 'interface'],
  ['type', 'type'],
  ['enum', 'enum'],
  ['namespace', 'namespace'],
  ['module', 'namespace'],
  ['const', 'const'],
  ['let', 'let'],
  ['var', 'var'],
])

function lex(text) {
  const tokens = []
  const stack = []
  let i = 0
  let newline = true
  const isIdStart = (c) => /[A-Za-z_$#\u0080-\uffff]/.test(c)
  const isId = (c) => /[\w$\u0080-\uffff]/.test(c)
  const lastSignificant = () => {
    for (let k = tokens.length - 1; k >= 0; k--) if (tokens[k].type !== 'comment') return tokens[k]
    return null
  }
  const push = (type, value, start, end) => {
    tokens.push({ type, value, start, end, newline })
    newline = false
  }
  const scanTemplate = (start, head) => {
    let j = start + 1
    while (j < text.length) {
      if (text[j] === '\\') j += 2
      else if (text[j] === '`') {
        push('template', head ? 'full' : 'tail', start, j + 1)
        return j + 1
      } else if (text[j] === '$' && text[j + 1] === '{') {
        push('template', head ? 'head' : 'middle', start, j + 2)
        stack.push('template')
        return j + 2
      } else j++
    }
    push('template', head ? 'full' : 'tail', start, text.length)
    return text.length
  }
  while (i < text.length) {
    const c = text[i]
    if (c === '\n') {
      newline = true
      i++
    } else if (/\s/.test(c)) i++
    else if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i)
      const stop = end === -1 ? text.length : end
      tokens.push({ type: 'comment', start: i, end: stop, newline })
      i = stop
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end === -1 ? text.length : end + 2
      tokens.push({ type: 'comment', start: i, end: stop, newline })
      i = stop
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < text.length && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1
      if (text[j] === c) {
        push('string', c, i, j + 1)
        i = j + 1
      } else {
        push('punct', c, i, i + 1)
        i++
      }
    } else if (c === '`') {
      i = scanTemplate(i, true)
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
      let j = i + 1
      while (j < text.length && /[\w.]/.test(text[j])) j++
      push('number', text.slice(i, j), i, j)
      i = j
    } else if (isIdStart(c)) {
      let j = i + 1
      while (j < text.length && isId(text[j])) j++
      push('ident', text.slice(i, j), i, j)
      i = j
    } else if (
      c === '/' &&
      isRegexStart(lastSignificant()) &&
      !isJsxClose(text, i, lastSignificant())
    ) {
      let j = i + 1
      let inClass = false
      while (j < text.length && text[j] !== '\n') {
        if (text[j] === '\\') j += 2
        else if (text[j] === '/' && !inClass) break
        else {
          if (text[j] === '[') inClass = true
          if (text[j] === ']') inClass = false
          j++
        }
      }
      j++
      while (j < text.length && isId(text[j])) j++
      push('regex', text.slice(i, j), i, j)
      i = j
    } else if (c === '{') {
      stack.push('brace')
      push('punct', c, i, i + 1)
      i++
    } else if (c === '}') {
      if (stack.pop() === 'template') i = scanTemplate(i, false)
      else {
        push('punct', c, i, i + 1)
        i++
      }
    } else {
      const op = PUNCT.find((p) => text.startsWith(p, i)) ?? c
      push('punct', op, i, i + op.length)
      i += op.length
    }
  }
  return tokens
}

function isJsxClose(text, i, prev) {
  return text[i + 1] === '>' && prev && (prev.type !== 'punct' || prev.value === '}')
}

function isRegexStart(prev) {
  if (!prev) return true
  if (prev.type === 'ident') return REGEX_AFTER_WORD.has(prev.value)
  if (prev.type === 'punct') return ![')', ']', '<'].includes(prev.value)
  if (prev.type === 'template') return prev.value === 'head' || prev.value === 'middle'
  return false
}

function splitStatements(tokens) {
  const significant = tokens.filter((t) => t.type !== 'comment')
  const statements = []
  let current = []
  let depth = 0
  const close = () => {
    if (current.length) statements.push(current)
    current = []
  }
  for (const token of significant) {
    const prev = current[current.length - 1]
    const startsNew =
      depth === 0 &&
      prev &&
      token.newline &&
      !(
        CONTINUE_END.has(prev.value) && !['.', '?.'].includes(current[current.length - 2]?.value)
      ) &&
      !(token.type === 'punct' && CONTINUE_START.has(token.value)) &&
      !(token.type === 'ident' && CONTINUE_START.has(token.value))
    if (startsNew) close()
    current.push(token)
    if (token.type === 'punct') {
      if ('([{'.includes(token.value)) depth++
      else if (')]}'.includes(token.value)) depth = Math.max(0, depth - 1)
      else if (token.value === ';' && depth === 0) close()
    }
    if (token.type === 'template' && token.value === 'head') depth++
    else if (token.type === 'template' && token.value === 'tail') depth = Math.max(0, depth - 1)
  }
  close()
  return statements
}

function analyze(tokens) {
  let k = 0
  const at = (n) => tokens[k + n]
  while (at(0)?.value === '@') {
    k += 2
    while (at(0)?.value === '.') k += 2
    if (at(0)?.value === '(') k = skipGroup(tokens, k)
  }
  if (at(0)?.value === 'import') return importNames(tokens)
  while (['export', 'default', 'declare', 'abstract', 'async'].includes(at(0)?.value)) k++
  if (at(0)?.value === 'const' && at(1)?.value === 'enum') k++
  const keyword = at(0)?.value
  if (!DECL_KINDS.has(keyword) || at(0).type !== 'ident') return { names: [], kind: null }
  k++
  if (at(0)?.value === '*') k++
  if (['const', 'let', 'var'].includes(keyword))
    return { names: bindingNames(tokens, k), kind: keyword, import: false }
  const name = at(0)
  if (name?.type !== 'ident') return { names: [], kind: null }
  return { names: [name.value], kind: DECL_KINDS.get(keyword), import: false }
}

function skipGroup(tokens, k) {
  let depth = 0
  for (; k < tokens.length; k++) {
    if ('([{'.includes(tokens[k].value) && tokens[k].type === 'punct') depth++
    else if (')]}'.includes(tokens[k].value) && tokens[k].type === 'punct' && --depth === 0)
      return k + 1
  }
  return k
}

function bindingNames(tokens, k) {
  const first = tokens[k]
  if (first?.type === 'ident') return [first.value]
  if (!first || !['{', '['].includes(first.value)) return []
  const names = []
  const end = skipGroup(tokens, k)
  for (let n = k + 1; n < end - 1; n++) {
    const t = tokens[n]
    if (t.type === 'ident' && [',', '}', ']', '='].includes(tokens[n + 1]?.value))
      names.push(t.value)
  }
  return names
}

function importNames(tokens) {
  const names = []
  if (tokens[1]?.type === 'ident' && tokens[2]?.value === '=')
    return { names: [tokens[1].value], kind: 'import', import: true }
  for (let k = 1; k < tokens.length && tokens[k].value !== 'from'; k++) {
    const t = tokens[k]
    if (t.type !== 'ident' || t.value === 'type' || t.value === 'as') continue
    if (tokens[k + 1]?.value === 'as') continue
    names.push(t.value)
  }
  return { names, kind: 'import', import: true }
}

function references(tokens) {
  const names = new Set()
  tokens.forEach((t, k) => {
    if (t.type !== 'ident') return
    const prev = tokens[k - 1]
    const next = tokens[k + 1]
    if (prev && (prev.value === '.' || prev.value === '?.')) return
    if (prev && ['{', ','].includes(prev.value) && next && [':', '?:'].includes(next.value)) return
    names.add(t.value)
  })
  return names
}

function leadingStart(text, comments, first, floor) {
  let start = first.start
  for (let k = comments.length - 1; k >= 0; k--) {
    const c = comments[k]
    if (c.end > start || c.start < floor) continue
    if ((text.slice(c.end, start).match(/\n/g) ?? []).length > 1) break
    if (/\S/.test(text.slice(c.end, start))) break
    start = c.start
  }
  return start
}

function extract(text, entity) {
  const tokens = lex(text)
  const comments = tokens.filter((t) => t.type === 'comment')
  const statements = splitStatements(tokens).map((toks, index, all) => {
    const info = analyze(toks)
    const floor = index === 0 ? 0 : all[index - 1][all[index - 1].length - 1].end
    return {
      ...info,
      index,
      toks,
      start: leadingStart(text, comments, toks[0], floor),
      end: toks[toks.length - 1].end,
    }
  })
  const decls = statements.filter((s) => !s.import)
  const targets = decls.filter((s) => s.names.includes(entity))
  if (targets.length === 0) {
    const available = [...new Set(decls.flatMap((s) => s.names))].sort(byText)
    throw new CliError(
      `no top-level declaration "${entity}"${available.length ? `. Declared: ${available.join(', ')}` : ''}`,
    )
  }
  const byName = new Map()
  for (const s of statements)
    for (const name of s.names) byName.set(name, [...(byName.get(name) ?? []), s])
  const included = new Set(targets)
  const queue = [...targets]
  while (queue.length) {
    for (const name of references(queue.shift().toks)) {
      for (const dep of byName.get(name) ?? []) {
        if (included.has(dep)) continue
        included.add(dep)
        if (!dep.import) queue.push(dep)
      }
    }
  }
  const ordered = [...included].sort((a, b) => a.index - b.index)
  const slice = (s) => text.slice(s.start, s.end)
  return {
    kind: [...new Set(targets.map((t) => t.kind))].join(', '),
    entityCode: targets.map(slice).join('\n\n'),
    depCode: ordered
      .filter((s) => !s.import && !targets.includes(s))
      .map(slice)
      .join('\n\n'),
    importCode: ordered
      .filter((s) => s.import)
      .map(slice)
      .join('\n'),
  }
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

function store() {
  return path.resolve(process.env.SCHEMORY_HOME || path.join(homedir(), '.schemory'))
}

function parseArgs(argv) {
  const positional = []
  const flags = {}
  const valued = new Set(['name', 'project', 'date'])
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const key = arg.slice(2)
    if (valued.has(key)) {
      const value = argv[++i]
      if (value === undefined || value.startsWith('--'))
        throw new CliError(`--${key} needs a value`)
      flags[key] = value
    } else if (['force', 'allow-suspect', 'help'].includes(key)) {
      flags[key] = true
    } else {
      throw new CliError(`unknown flag ${arg}\n${usage}`)
    }
  }
  return { positional, flags }
}

function checkName(name) {
  if (!name) throw new CliError('missing --name')
  if (!NAME.test(name)) {
    throw new CliError(
      `invalid name "${name}": use kebab-case (worker-blueprint) or camelCase (workerBlueprint)`,
    )
  }
}

function findProjectRoot(file) {
  let dir = path.dirname(file)
  while (true) {
    if (existsSync(path.join(dir, 'package.json')) || existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return path.dirname(file)
    dir = parent
  }
}

function fence(code, lang) {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length))
  const ticks = '`'.repeat(longest + 1)
  return `${ticks}${lang}\n${code}\n${ticks}`
}

function snapshot(positional, flags) {
  const [file, entity] = positional
  if (!file || !entity) throw new CliError(`snapshot needs <file> and <entity>\n${usage}`)
  checkName(flags.name)
  if (flags.date && !/^\d{4}-\d{2}-\d{2}$/.test(flags.date))
    throw new CliError('--date must be YYYY-MM-DD')
  const abs = path.resolve(file)
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new CliError(`file not found: ${abs}`)
  const target = path.join(store(), `${flags.name}.md`)
  if (existsSync(target) && !flags.force) {
    throw new CliError(
      `blueprint "${flags.name}" already exists at ${target}. Ask the user, then rerun with --force to overwrite.`,
    )
  }
  const root = path.resolve(flags.project ?? findProjectRoot(abs))
  const rel = path.relative(root, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel))
    throw new CliError(`${abs} is not inside project ${root}`)
  const sourcePath = `${path.basename(root)}/${rel.split(path.sep).join('/')}`
  let result
  try {
    result = extract(readFileSync(abs, 'utf8'), entity)
  } catch (error) {
    if (error instanceof CliError) throw new CliError(`${error.message} (in ${sourcePath})`)
    throw error
  }
  const suspects = [result.importCode, result.entityCode, result.depCode]
    .join('\n')
    .split('\n')
    .filter((line) => SUSPECT.some((re) => re.test(line)))
  if (suspects.length && !flags['allow-suspect']) {
    throw new CliError(
      `not saved: these lines look like credentials:\n${suspects.map((s) => `  ${s.trim()}`).join('\n')}\nRemove the value from the source, or rerun with --allow-suspect if the user confirms it is not a secret.`,
    )
  }
  const ext = path.extname(abs).toLowerCase()
  const lang =
    { '.tsx': 'tsx', '.jsx': 'jsx', '.js': 'js', '.mjs': 'js', '.cjs': 'js' }[ext] ?? 'ts'
  const parts = [
    '---',
    `name: ${flags.name}`,
    `entity: ${entity}`,
    `kind: ${result.kind}`,
    `source: ${sourcePath}`,
    `date: ${flags.date ?? new Date().toISOString().slice(0, 10)}`,
    '---',
    '',
    `# ${flags.name}`,
    '',
    `Blueprint of \`${entity}\` from \`${sourcePath}\`. Follow it as a pattern; adapt names, imports and types to the current project instead of pasting it.`,
    '',
    `## ${entity}`,
    '',
    fence(result.entityCode, lang),
  ]
  if (result.depCode) parts.push('', '## Same-file dependencies', '', fence(result.depCode, lang))
  if (result.importCode) parts.push('', '## Imports it uses', '', fence(result.importCode, lang))
  mkdirSync(store(), { recursive: true })
  writeFileSync(target, `${parts.join('\n')}\n`)
  process.stdout.write(
    `saved ${flags.name} (${result.kind} ${entity} from ${sourcePath}) to ${target}\n`,
  )
}

function readMeta(file) {
  const match = readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/)
  const meta = {}
  for (const line of match ? match[1].split('\n') : []) {
    const i = line.indexOf(':')
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return meta
}

function names() {
  const dir = store()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && NAME.test(f.slice(0, -3)))
    .map((f) => f.slice(0, -3))
    .sort(byText)
}

function list() {
  const all = names()
  if (all.length === 0) {
    process.stdout.write(`no blueprints in ${store()}\n`)
    return
  }
  const rows = all.map((name) => {
    const meta = readMeta(path.join(store(), `${name}.md`))
    const entity = [meta.kind, meta.entity].filter(Boolean).join(' ') || '?'
    return [name, entity, meta.source ?? '?', meta.date ?? '?']
  })
  const table = [['NAME', 'ENTITY', 'SOURCE', 'DATE'], ...rows]
  const widths = table[0].map((_, c) => Math.max(...table.map((r) => r[c].length)))
  const lines = table.map((r) =>
    r.map((cell, c) => (c === r.length - 1 ? cell : cell.padEnd(widths[c]))).join('  '),
  )
  process.stdout.write(`${lines.join('\n')}\n`)
}

function use(name) {
  if (!name) return list()
  checkName(name)
  const file = path.join(store(), `${name}.md`)
  if (!existsSync(file)) {
    const all = names()
    throw new CliError(
      `no blueprint "${name}" in ${store()}${all.length ? `. Saved: ${all.join(', ')}` : ''}`,
    )
  }
  process.stdout.write(readFileSync(file, 'utf8'))
}

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2))
  const [command, ...rest] = positional
  if (flags.help || !command) return process.stdout.write(`${usage}\n`)
  if (command === 'snapshot') return snapshot(rest, flags)
  if (command === 'list') return list()
  if (command === 'use') return use(rest[0])
  throw new CliError(`unknown command "${command}"\n${usage}`)
}

try {
  main()
} catch (error) {
  process.stderr.write(
    error instanceof CliError
      ? `error: ${error.message}\n`
      : `error: unexpected failure: ${error?.stack ?? error}\n`,
  )
  process.exitCode = 1
}
