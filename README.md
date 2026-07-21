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
angular.dev. The file's header comment records the version, the verification date, and
every doc URL used. Anything that could not be confirmed is labelled
`UNVERIFIED — confirm on angular.dev` in its `caveats`.

Two things this caught that memory gets wrong:

- The binding directive is `[formField]` / `FormField` — **not** `[control]` / `Control`,
  which appeared in pre-release v21 material and is what models tend to reproduce.
- `required()` treats `false` as missing on **v22** but as present on **v21**. That flips
  `Validators.requiredTrue` between a one-line rename and a rewrite. Recipes whose
  behaviour differs across releases say so and give a version-independent fallback.

Recipes carry a `caveats` array. Read it — that is where the sharp edges live.

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
