---
name: schemory
description: Use when the user wants to reuse a proven structure across projects or runs. Saves a type, interface, class, function, Zod schema or const as a named blueprint in a personal library (~/.schemory), and loads it into context later. Trigger on "/schemory snapshot", "/schemory use [name]", or a request to save or reuse a data structure, schema or code example as a pattern.
---

# schemory

A personal, cross-project library of blueprints: code a user wants an agent to follow again later. The script needs only `node` (24+) and no packages.

```sh
node <skill-dir>/scripts/schemory.mjs snapshot <file> <entity> --name <name> [--force] [--allow-suspect] [--project <dir>]
node <skill-dir>/scripts/schemory.mjs list
node <skill-dir>/scripts/schemory.mjs use [name]
```

Blueprints live in `~/.schemory/<name>.md` (`SCHEMORY_HOME` overrides the folder). Each holds the entity verbatim, the declarations from the same file it depends on, the imports it uses, its source as `<project-folder>/<path>`, and the date.

## /schemory snapshot

1. Ask which file, which entity in it, and what name to save it under, unless the user already said. Names are kebab-case or camelCase.
2. Run `snapshot`. The project root is the nearest folder with `package.json` or `.git`; pass `--project` to change it.
3. If the name already exists, show the user and rerun with `--force` only after they confirm the overwrite.
4. If the script refuses because lines look like credentials, show those lines. Never save real secrets: ask the user to move the value out of the code first. Use `--allow-suspect` only when the user confirms it is a false positive.
5. Report the saved name, entity and path.

Example: snapshot `AnalysisWorker` from `src/jobs/worker.ts` as `workerBlueprint`.

```sh
node <skill-dir>/scripts/schemory.mjs snapshot src/jobs/worker.ts AnalysisWorker --name workerBlueprint
```

## /schemory use [name]

- No name: run `list` and show the saved blueprints (name, entity, source, date).
- With a name: run `use <name>` so the blueprint lands in context, then follow it as the pattern for the current task. Example: in another project, `/schemory use workerBlueprint` and build the new worker in the same shape.

## Rules

- A blueprint is a pattern to follow, not code to paste. Adapt names, imports, types and dependencies to the current project.
- Never store secrets, tokens, connection strings or environment values in a blueprint.
- Extraction is a lightweight scanner, not a full TypeScript parser. Read the saved blueprint once; if a dependency is missing or extra, tell the user.
