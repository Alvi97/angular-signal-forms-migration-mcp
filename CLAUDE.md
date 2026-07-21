# CLAUDE.md — signal-forms-migration-mcp

You are building an MCP server that helps migrate Angular Reactive Forms to
Angular Signal Forms. Signal Forms landed in v21; recipes are verified against
**v22**, the current release. Full scope and tool specs live in SPEC.md — read it
first, every session. This file is the rules you must never break.

## Non-negotiable rules

1. **THIS SERVER NEVER EDITS USER CODE.** It only DETECTS and ADVISES. Never add a
   tool that writes to the user's source files. The calling agent does all edits.
2. **GROUND EVERY SIGNAL FORMS RECIPE IN OFFICIAL DOCS.** Signal Forms is new and is
   NOT reliable from memory. Before writing any recipe or "after" snippet:
   use the official Angular CLI MCP server (`npx @angular/cli mcp`)
   `search_documentation` / `find_examples`, and cross-check angular.dev. Encode only
   verified syntax; mark anything unverified as
   `caveats: ["UNVERIFIED — confirm on angular.dev"]`. Docs beat memory when they conflict.
   **Always pass an explicit `version:` and check the `searchedVersion` in the reply** —
   the tool silently falls back to older docs. Behaviour has already changed across
   releases (`disabled(path, cb)` in v21 became `disabled(path, { when: cb })` in v22), so a
   recipe verified against the wrong version is worse than no recipe. Recipes must name the
   version they were verified against and flag anything version-sensitive.

   **A DOC GAP IS NOT A BEHAVIOUR.** This rule previously cited "v22 made `required()`
   reject `false`; v21 accepted it". That was wrong, and it survived two audits because
   every check compared *documentation* across versions. `isEmpty` is byte-identical in
   `@angular/forms` 21.0.0 and 22.0.7 — both contain `value === false` — so v21 rejected
   `false` exactly as v22 does. Only the docs changed: v22 added the sentence v21 omitted.
   When claiming a version difference, diff the shipped source (`npm pack @angular/forms@N`),
   not the two doc pages. Absence of a statement is not evidence of different behaviour.
3. **SHIP INCREMENTALLY.** Commit M1 to GitHub before starting M2. One milestone in
   flight at a time. Do not scope-creep a later milestone's work into the current one.
   Milestones are defined in SPEC.md (M1→M4).
4. **VERIFY THE SDK FROM SOURCE.** Before writing `server.ts`, read the installed
   `@modelcontextprotocol/sdk` `.d.ts` files in `node_modules` and match the current API
   exactly. Trust installed types over any snippet, including SPEC.md.

## TypeScript standards (enforce on every file)

- Strict tsconfig: `strict`, `noUncheckedIndexedAccess`, `noImplicitReturns`,
  `noFallthroughCasesInSwitch`, `exactOptionalPropertyTypes`. ES2022 / NodeNext.
- No `any` — use `unknown` and narrow. No non-null `!` except validated env vars.
- Validate all tool inputs with zod; derive types via `z.infer` (single source of truth).
- Explicit return types on all exported functions.
- Results are discriminated unions (`{ ok: true, data } | { ok: false, error }`); never
  throw across a tool boundary.
- Pure core, thin shell: logic in `src/core/*` as pure functions; `src/server.ts` only
  adapts core → MCP protocol. Core must be unit-testable without the MCP runtime.
- Tests in vitest. No `console.log` in library code — logs to STDERR only (stdout is
  the MCP stdio channel and must stay clean).
- ESLint + Prettier (typescript-eslint `recommended-type-checked`) must pass.

## Definition of done (per milestone)

- Strict tsconfig compiles with zero errors; ESLint clean; all vitest tests green.
- New tools callable from Claude Code over stdio.
- Recipes carry a provenance comment (Angular version + doc URLs used).
- README updated; ROADMAP.md holds anything deferred.

## Working style

- Build in the order in SPEC.md; stop at each gate for review before continuing.
- When unsure about an API, read docs/types — do not guess.
- Keep changes small and reviewable. Explain each decision briefly in the commit.
