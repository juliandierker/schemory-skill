# Reading a schemory diff

Lines starting with `-` were removed or changed; lines starting with `+` are new. A changed line shows up as one `-` and one `+`. Removed lines are the candidates for breaking changes.

## TypeScript (`ts.d.ts`)

Breaking for consumers:
- an exported type, function, class or constant was removed or renamed
- a property was removed, renamed, or went from optional to required
- a property type was narrowed in an input position or widened in an output position
- a function parameter was added without a default, removed, or retyped
- a return type changed
- a union member was removed from an input type, or added to an output type

Usually safe: new exports, new optional properties, new optional parameters, widened input types.

## Zod and JSON Schema (`zod.json`)

Breaking for producers (data that used to validate may now fail):
- a property became `required`, or `additionalProperties` became `false`
- `type`, `enum`, `format`, `pattern`, `minimum`, `maxLength` and similar constraints got stricter

Breaking for consumers (data they read may now be missing or different):
- a property was removed or its `type` changed
- an `enum` value was removed or added

## Postgres (`pg.sql`)

Breaking:
- `DROP`, or a removed `CREATE TABLE` / column / index / constraint line
- a column type change, or `NOT NULL` added without a default
- a new `UNIQUE`, `CHECK` or foreign key that existing rows may violate
- a renamed table or column

Usually safe: new tables, new nullable columns, new indexes (note lock time on large tables).

## Report format

Write one short list for the user: each breaking change, who it affects, and the migration or call-site fix you made or recommend. If the diff shows no breaking changes, say so and name the snapshots you compared.
