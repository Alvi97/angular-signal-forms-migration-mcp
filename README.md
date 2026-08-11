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

**The recipes also compile.** CI installs a real `@angular/forms@22` and typechecks
fixtures that exercise every API the recipes use — so a recipe naming a function that
does not exist, or calling it with the wrong argument shape, fails the build:

```bash
npm run verify:install   # installs a real Angular 22
npm run verify:recipes   # compiles the recipe API surface against it
```

That check is what proves `disabled(path, { when })` is the v22 signature, and that the
nested `schema()` + `apply()` composition works — the docs demonstrate neither.

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
- `disabled()` / `hidden()` gained an options-object form on **v22** (`{ when: … }`) and
  marked the bare-callback form `@deprecated` rather than removing it — so a v21-shaped rule
  still compiles, with a warning. Established by diffing the shipped overloads, not the
  guides.

Recipes whose behaviour differs across releases carry a `VERSION-SENSITIVE` caveat naming the
form each version takes. The server reads your project's Angular version where it can (exact
version from `node_modules`, falling back to the declared range) and resolves those recipes
against it; when the version cannot be determined, the caveat gives you both.

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

Requires Node.js 20+. No clone needed — `npx` fetches it on demand.

```bash
claude mcp add signal-forms-migration -- npx -y angular-signal-forms-migration-mcp
```

Or add it to any MCP client config:

```json
{
  "mcpServers": {
    "signal-forms-migration": {
      "command": "npx",
      "args": ["-y", "angular-signal-forms-migration-mcp"]
    }
  }
}
```

<details>
<summary>Running from a local clone instead</summary>

```bash
git clone https://github.com/Alvi97/angular-signal-forms-migration-mcp.git
cd angular-signal-forms-migration-mcp
npm install
npm run build
claude mcp add signal-forms-migration -- node "$PWD/dist/server.js"
```

</details>

The transport is stdio, so stdout is reserved for the protocol; all logging goes to stderr.

**Do not `npm install` this into your Angular app.** It is a standalone process your
editor spawns, not a library your project depends on — installing it adds a dev tool to
your production dependencies. Use `npx` (above), which keeps it in a cache outside your
project entirely.

## Upgrading

**If you installed with `@latest` (as shown above), there is nothing to do.** `npx`
re-resolves the version on every launch, so restarting your editor picks up new releases.

The server also checks for updates once a day and writes a one-line notice to stderr when
a newer version exists — so you find out without having to look. It is throttled, has a
2-second timeout, never touches stdout, and stays silent on any failure. Turn it off with:

```json
{
  "mcpServers": {
    "signal-forms-migration": {
      "command": "npx",
      "args": ["-y", "angular-signal-forms-migration-mcp@latest"],
      "env": { "SIGNAL_FORMS_MCP_NO_UPDATE_CHECK": "1" }
    }
  }
}
```

To see what is actually running:

```bash
npx angular-signal-forms-migration-mcp --version
```

If you installed **without** `@latest`, npx keeps serving whichever version it cached
first. Repoint the config at `@latest`, or clear the cache with `npm cache clean --force`
and restart.

## Tools

### `find_form_candidates`

Scans `.ts` and `.html` files (or a directory, recursively) and reports every Reactive
Forms construct it finds.

```jsonc
{ "path": "/abs/path/to/src/app" }
```

Returns one entry per file, each finding carrying `construct`, `line`, `snippet`, a
`classification` of `"mechanical"` or `"judgment"`, and the `reason` for that call.
Template findings use a `Template.` prefix (`Template.formControlName`, …) and resolve to
the `templateBindings` recipe.

`node_modules`, `dist`, `.angular` and `*.spec.ts` are skipped. TypeScript parses with the
compiler API; templates use a quote-aware token scan (not a full Angular AST), so re-run
the AOT build after editing a template — the compiler is the real check. Inline `template:`
strings and CSS/SCSS are not scanned.

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

### `get_migration_report`

Composes everything into one markdown document.

```jsonc
{ "path": "/abs/path/to/repo" }
```

Returns a report with the headline totals, a suggested file order, a construct table
naming the recipe for each, the individual judgment calls with line numbers and reasons,
and a **"Read the caveats"** section listing any version-sensitive recipe that actually
applies to your codebase (it stays silent when none does).

It returns the markdown as a **string**. It does not write a file — saving it is your
decision, not the server's.

### `get_angular_upgrade_plan`

Signal Forms needs Angular 21+. When your project is older, the migration cannot start —
so this returns the upgrade plan instead.

```jsonc
{ "path": "/abs/path/to/repo", "level": 3, "material": true }
```

It asks the same questions angular.dev/update-guide does — application complexity (1 Basic,
2 Medium, 3 Advanced), and whether you use ngUpgrade, Angular Material or Windows — and
returns before/during/after steps as markdown, plus the one-major-at-a-time command
sequence.

**None of the step text is written by this tool.** It is Angular's own update-guide data,
vendored verbatim from
[the Angular repo](https://github.com/angular/angular/blob/main/adev/src/app/features/update/recommendations.ts)
with the commit recorded, and reproduced with Angular's own filter logic. Every plan links
back to the live guide, which stays authoritative.

It also tells you which of those questions are **irrelevant to your version range** — for
19 → 22 the Windows and ngUpgrade answers cannot change anything, because those steps stop
at v9 and v19 respectively. The official guide asks anyway.

It handles **any forward range the data covers — v2 to v22** — not just the Signal Forms
prerequisite. `{ "fromMajor": 14, "toMajor": 17 }` works, and both default sensibly:
`fromMajor` to the detected version, `toMajor` to the version the recipes target.

Outside that range it refuses rather than guesses. A target above the newest known
release, a downgrade, and a no-op range are all rejected with a message saying which —
because an empty or partial plan reads as "nothing to do", which is the worst possible
answer. The refusal for a too-new target names the vendored date and points at
`data:update-steps`, so a genuinely new Angular release is a refresh rather than a dead
end.

Refresh the vendored data with `npm run data:update-steps` — the covered range widens
automatically, since it is computed from the data rather than hardcoded.

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

Feature-complete through M7: five tools ship, with doc-verified recipes covering basic
constructs, arrays, runtime shape mutation, async validators, custom controls, the three
RxJS stream tiers, reading/writing form state, submission, model-shape constraints, CSS
status classes, spec-file migration, and the `.html` template layer (bindings, the
`<select multiple>` blocker, and the silent error-key rename).

See [ROADMAP.md](./ROADMAP.md) for what is still deliberately **not** covered — inline
`template:` strings, ngModel/template-driven migration (undocumented upstream), and a
`ts.Program`-backed deep mode. Those are real gaps, and the report says so in its own
"Scope" section rather than letting the totals imply completeness.

## License

MIT
