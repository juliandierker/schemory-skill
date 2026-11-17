---
name: schemory
description: Use before changing exported TypeScript types, Zod or JSON Schemas, or a Postgres schema, and again after the change. Takes deterministic snapshots into .schemory/, diffs them, and reports breaking changes.
---

# schemory

Snapshot the shape of your types and schemas before a change, snapshot again after, diff, and report what broke. The scripts need only `node` (24+); they use the target project's own `typescript` and `zod`.

Add `.schemory/` to the project's `.gitignore`.

## Workflow

1. Before editing, snapshot into `.schemory/before`.
2. Make the change.
3. Snapshot into `.schemory/after` with the same commands.
4. Run the diff and read it.
5. Report breaking changes to the user before handing back (see `references/breaking-changes.md`).

Run only the snapshots that match what the change touches. Scripts live in this skill's `scripts/` folder; call them with `node <skill-dir>/scripts/<name>.mjs`.

| Script | Captures | Writes |
|---|---|---|
| `snapshot-ts.mjs` | declaration output (`.d.ts`) of the project's `tsconfig.json` | `ts.d.ts` |
| `snapshot-zod.mjs` | Zod schemas and JSON Schema files as JSON Schema | `zod.json` |
| `snapshot-pg.mjs` | `pg_dump --schema-only`, normalized | `pg.sql` |
| `diff.mjs` | compares two snapshot directories | stdout |

```sh
node scripts/snapshot-ts.mjs --out .schemory/before
node scripts/snapshot-zod.mjs --out .schemory/before src/schemas.ts openapi/user.json
SCHEMORY_PG_URL=... node scripts/snapshot-pg.mjs --out .schemory/before
node scripts/diff.mjs .schemory/before .schemory/after
```

Common flags: `--out <dir>` (default `.schemory/current`), `--project <dir>` (default `.`), `--resolve-from <dir>` to load `typescript` or `zod` from somewhere other than the project. Each script prints `--help`.

## Rules

- Never print, log or commit a database URL. Use a development or branch database, never production. Pass the URL through an environment variable (`--url-env NAME` picks a different variable name).
- If a script reports that `typescript` or `zod` cannot be resolved, install it in the project or use `--resolve-from`; do not vendor a copy.
- Zod modules are imported, so they must load under plain `node` (TypeScript files need Node 24 type stripping).
- Snapshots are deterministic: an unchanged schema diffs as `no changes`. A diff you did not expect is a finding, not noise.
