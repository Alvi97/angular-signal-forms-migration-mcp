# signal-forms-migration-mcp

An MCP server that helps an AI coding agent migrate **Angular Reactive Forms** to
**Angular Signal Forms**.

It finds the Reactive Forms constructs in your codebase, tells you which ones are a
safe mechanical rename and which ones need a human decision, and hands back verified
before→after recipes for each.

## It detects and advises. It never edits your code.

This is the one architectural rule the server is built around. There is no tool here
that writes to your source files, and there never will be. The server returns findings
and recipes; **your agent decides what to change and makes the edits**, so every change
still goes through your normal review and version control.

## Docs provenance

Signal Forms is new and is not reliably present in any model's training data — which
means recipes written from memory are wrong in ways that look right.

Every recipe in `src/core/recipes.ts` was verified against **Angular v22** using the
official Angular CLI MCP server (`npx @angular/cli mcp`), cross-checked against
angular.dev. Anything that could not be confirmed is labelled
`UNVERIFIED — confirm on <url>` in its `caveats`.

Provenance is **structured and required** — no recipe can exist without it:

```jsonc
"provenance": {
  "verifiedAgainstVersion": 22,
  "retrievedISO": "2026-07-21",
  "sources": ["https://angular.dev/guide/forms/signals/validation"],
  "versionSensitive": true
}
```

It ships in the tool response, so the calling agent can judge how current the advice is.
A CI test fails the build on any recipe with an empty `sources` list.

```bash
npm run docs:audit   # every recipe + version + date + sources; exits non-zero if stale
```

The target version lives in exactly one place, `src/core/version.ts`. Upgrading to a new
Angular release starts by changing that line and running the audit — see
[REVERIFICATION.md](./REVERIFICATION.md) for the full procedure.

Things this caught that memory gets wrong:

- The binding directive is `[formField]` / `FormField` — **not** `[control]` / `Control`,
  which appeared in pre-release v21 material and is what models tend to reproduce.
- `required()` treats `false` as missing on **v22** but as present on **v21**. That flips
  `Validators.requiredTrue` between a one-line rename and a rewrite.
- `disabled()` / `hidden()` take an options object (`{ when: … }`) on v22, but a bare
  callback on v21.

Recipes whose behaviour differs across releases carry a `VERSION-SENSITIVE` caveat **and**
a version-independent fallback, because this server does not read your installed Angular
version and so cannot choose for you.

Recipes carry a `caveats` array. Read it — that is where the sharp edges live.

## It tells you when there is no clean answer

Not every Reactive Forms pattern has a Signal Forms equivalent, and a migration tool that
pretends otherwise is worse than none. Form streams are graded by the RxJS operators in
their `.pipe()` chain:

| Tier | Operators | Answer |
| --- | --- | --- |
| trivial | none / bare `subscribe` | `computed()`, or `effect()` for a real side effect |
| moderate | `map`, `filter`, `debounceTime`, `distinctUntilChanged`, … | `computed()` + the `debounce()` schema rule |
| hard | `switchMap`, `combineLatest`, `withLatestFrom`, `forkJoin`, … | **no direct equivalent** |

For the hard tier the recipe says so outright and offers three real strategies —
async validation rules, `rxResource`, or keeping RxJS behind `toObservable`/`toSignal` —
rather than inventing a one-liner that does not exist.

Likewise `addControl()` / `removeControl()` have no counterpart at all: the field tree is
derived from the model signal's type. The recipe explains the three actual answers instead
of implying an API that would not compile.

## Composes with the official Angular MCP server

This server is deliberately narrow: it knows about *migration*. Run it alongside the
official `@angular/cli` MCP server, which knows about *Angular*. Your agent can pull
findings and recipes from here, then use `search_documentation` / `find_examples` there
to confirm anything current or project-specific before it edits.

## Install

Requires Node.js 20+.

```bash
git clone https://github.com/<your-user>/signal-forms-migration-mcp.git
cd signal-forms-migration-mcp
npm install
npm run build
```

## Run it from Claude Code

```bash
claude mcp add signal-forms-migration -- node /absolute/path/to/signal-forms-migration-mcp/dist/server.js
```

Or add it to your MCP client config directly:

```json
{
  "mcpServers": {
    "signal-forms-migration": {
      "command": "node",
      "args": ["/absolute/path/to/signal-forms-migration-mcp/dist/server.js"]
    }
  }
}
```

The transport is stdio, so stdout is reserved for the protocol; all logging goes to stderr.

## Tools

### `find_form_candidates`

Scans a `.ts` file or a directory (recursively) and reports every Reactive Forms
construct it finds.

```jsonc
{ "path": "/abs/path/to/src/app" }
```

Returns one entry per file, each finding carrying `construct`, `line`, `snippet`, a
`classification` of `"mechanical"` or `"judgment"`, and the `reason` for that call.

`node_modules`, `dist`, `.angular` and `*.spec.ts` are skipped. Parsing uses the
TypeScript compiler API, not regex.

### `get_signalforms_recipe`

Looks up a verified before→after recipe.

```jsonc
{ "construct": "FormBuilder.group" }
```

Accepts the exact construct names `find_form_candidates` emits, plus the spellings a
human would type — `fb.group`, `required`, `ValidatorFn`, and so on, case-insensitively.

An unknown construct is **not** an error: you get
`{ found: false, availableConstructs: [...] }` so the agent can correct itself and retry.

### `analyze_migration_complexity`

Summarises the whole job: how big it is, and where to start.

```jsonc
{ "path": "/abs/path/to/src/app" }
```

Returns `totalFindings`, `byConstruct`, the `mechanicalCount` / `judgmentCount` split, and
`suggestedOrder` — files sorted simplest-first, so all-mechanical files come before any
that need design decisions, and the smallest of those comes first. Migrating in that order
means you establish the model shape on easy files before you hit the hard ones.

## Example

```
> Migrate the forms in src/app/checkout to Signal Forms.

  1. find_form_candidates { path: ".../src/app/checkout" }
     → 9 findings across 2 files: 6 mechanical, 3 judgment
       (the FormArray of line items is judgment — its shape changes)
  2. get_signalforms_recipe { construct: "FormBuilder.group" }
     → before/after + caveats
  3. the agent applies the edits, you review the diff
```

## Development

```bash
npm run typecheck   # strict tsc, no emit
npm run lint        # eslint, type-checked rules
npm test            # vitest
npm run check       # all three
```

The core (`src/core/*`) is pure and has no MCP dependency — detection takes an injected
`FileSystemPort`, so it is unit-tested entirely in memory. `src/server.ts` only adapts
core functions to the protocol.

## Status

M1. See [SPEC.md](./SPEC.md) for the full v1 scope and [ROADMAP.md](./ROADMAP.md) for
what is deferred — notably `FormArray`, async validators,
`ControlValueAccessor` guidance, `valueChanges` pipelines, and the workspace-wide
migration report.

## License

MIT
