# SPEC.md — signal-forms-migration-mcp (v1, full scope)

## What we are building

A Model Context Protocol (MCP) server in TypeScript that helps an AI coding agent
migrate Angular Reactive Forms to Angular Signal Forms (v21+, verified against v22) — covering the full
range of real-world form patterns, not just the simple cases.

**Hard architectural rule: THIS SERVER NEVER EDITS CODE.**
DETECT and ADVISE only. The calling agent performs all edits.
Do not add any tool that writes to the user's source files.

## MANDATORY: ground every recipe in the latest official Angular docs

Signal Forms is new (v21+, current release v22) and is NOT reliably in any model's
training data. Its behaviour has ALREADY changed across releases.
Before writing ANY recipe or "after" snippet, the building agent MUST:

1. Connect to the official Angular CLI MCP server in the same session
   (`npx @angular/cli mcp`) and use its `search_documentation` and `find_examples` tools.
2. Cross-check against angular.dev (Signal Forms guide, Forms API reference).
3. Encode only VERIFIED syntax. Any snippet that cannot be verified against
   official docs must be labelled `caveats: ["UNVERIFIED — confirm on angular.dev"]`.
4. Record, in a top comment of `src/core/recipes.ts`, the Angular version and the
   doc URLs the recipes were derived from.
5. **Pin and verify the version.** Always pass an explicit `version:` to
   `search_documentation` and check the `searchedVersion` field in the reply — the tool
   silently falls back to older docs when a version has no results. A recipe verified
   against the wrong version is worse than no recipe.
6. **Flag version-sensitive behaviour.** Where releases disagree, the recipe must say so
   in its `caveats` and give the version-independent fallback. Known example: `required()`
   treats `false` as missing on v22 but as present on v21, which flips whether
   `Validators.requiredTrue` is a mechanical rename or a judgment rewrite.

Do NOT invent Signal Forms API shapes from memory. If docs and memory conflict,
docs win.

## Incremental shipping rule — NON-NEGOTIABLE

Target scope is everything below, but SHIP IN THIS ORDER, committing each milestone
to GitHub before starting the next:

- **M1** (ship first, standalone): `find_form_candidates` + `get_signalforms_recipe`,
  basic constructs only. Push to GitHub with README. This is the first credential.
- **M2**: extend detection + recipes to FormArray, dynamic controls, async validators.
  Adds `analyze_migration_complexity`.
- **M3**: ControlValueAccessor guidance + RxJS-interop (`valueChanges` pipelines).
- **M4**: workspace-wide migration report tool (`get_migration_report`).

Do not begin M2 until M1 is committed and runnable. One milestone in flight at a time.

---

## TOOLS (full v1 set)

### 1. `find_form_candidates`

Input: `{ path: string }` — absolute path to a `.ts` file or directory (recurse)

- Skip `node_modules`, `dist`, `.angular`, `*.spec.ts`.
- Parse with the TypeScript compiler API (`ts.createSourceFile` + node walk).
  Regex only as justified fallback, commented.
- Detect: `FormGroup`, `FormControl`, `FormArray`, `FormBuilder`, `new FormControl(...)`,
  `fb.group/control/array(...)`, `.valueChanges`, `.statusChanges`, `Validators.*`,
  `ControlValueAccessor` implementations, async validators, dynamic/conditional controls.
- Classify each finding: `"mechanical" | "judgment"`, with a reason.

Output (typed): array of
`{ file, findings: Array<{ construct, line, snippet, classification, reason }> }`.

### 2. `get_signalforms_recipe`

Input: `{ construct: string }`

- Return a verified before→after recipe from a typed `RECIPES` map.
- Full v1 coverage target: `FormControl`, `FormGroup`, `FormArray`, `FormBuilder.group`,
  `Validators.required/email/min/max/pattern`, custom validators, async validators,
  `valueChanges`→signal/computed, `ControlValueAccessor` patterns.
- Unknown construct → structured `{ found: false, availableConstructs }`. Never throw.

Output (typed): `{ construct, found, description?, before?, after?, caveats?, availableConstructs? }`.

### 3. `analyze_migration_complexity` (M2+)

Input: `{ path: string }`

- Reuse `find_form_candidates`, then summarise: counts by construct, mechanical vs
  judgment ratio, and an ordered suggested migration sequence (simplest first).

Output (typed): `{ totalFindings, byConstruct: Record<string, number>, mechanicalCount, judgmentCount, suggestedOrder: string[] }`.

### 4. `get_migration_report` (M4)

Input: `{ path: string }`

- Directory-wide markdown report combining findings + complexity + relevant recipe
  references. Returned as a string; the AGENT decides whether to write it to a file.

---

## TypeScript best practices — ENFORCE ALL

- tsconfig: `strict:true`, `noUncheckedIndexedAccess`, `noImplicitReturns`,
  `noFallthroughCasesInSwitch`, `exactOptionalPropertyTypes`,
  `forceConsistentCasingInFileNames`. Target ES2022; module/resolution NodeNext.
- NO `any` (use `unknown` + narrowing). NO non-null `!` except validated env vars.
- Validate ALL tool inputs with zod; derive types via `z.infer` (single source of truth).
- Explicit return types on every exported function.
- Discriminated-union results (`{ ok:true, data } | { ok:false, error }`); never throw
  across a tool boundary.
- Pure core, thin shell:

```
src/server.ts        // MCP wiring only
src/core/detect.ts   // detection (pure, no I/O beyond an injected file reader)
src/core/recipes.ts  // RECIPES map + lookup (pure) + docs-provenance comment
src/core/complexity.ts
src/core/report.ts
src/core/types.ts    // zod schemas + inferred types
test/*.test.ts
```

- vitest (Angular default). Tests must cover: a mechanical case, a FormArray
  judgment case, an async-validator case, an unreadable path, and an unknown-construct
  lookup. Add tests as each milestone lands.
- ESLint + Prettier; typescript-eslint `recommended-type-checked`.
- No `console.log` in library code. Logs go to STDERR only — stdout is the MCP stdio
  channel and must stay clean.

## MCP wiring

- Official `@modelcontextprotocol/sdk` (TypeScript). Transport: stdio (local-first).
- BEFORE writing `server.ts`, read the INSTALLED SDK's `.d.ts` files in `node_modules` and
  match the current tool-registration API exactly. Trust installed types over any
  snippet, including this spec.

## Definition of done — v1

- [ ] M1 committed to GitHub first, runnable from Claude Code, README present.
- [ ] All four tools registered and callable over stdio.
- [ ] Recipes verified against angular.dev / Angular MCP; provenance comment present.
- [ ] Strict tsconfig compiles clean; ESLint clean; all vitest tests green.
- [ ] README.md: what it is, detect-not-edit architecture, install/run, usage example,
      docs-provenance note, and that it composes with the official Angular MCP server.
- [ ] ROADMAP.md lists anything deferred beyond M4.
