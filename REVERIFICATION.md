# REVERIFICATION.md — re-verifying recipes on a new Angular release

Signal Forms is young and its behaviour has **already changed between releases**. This
project has been burned twice:

| What | v21 | v22 |
| --- | --- | --- |
| `required()` on `false` | passes (only `null`/`''` count as empty) | **fails** — `false` is missing, matching `<input type="checkbox" required>` |
| `disabled()` / `hidden()` signature | bare callback: `disabled(path, cb)` | **options object**: `disabled(path, { when: cb })` |
| Binding directive | `[control]` in pre-release material | `[formField]` |
| Experimental banner | present | removed |

So: **recipes are not portable across Angular versions, and memory is not a source.**
This document is the procedure. Follow it exactly; do not shortcut it with recall.

---

## The procedure

### 1. Bump the target version

```ts
// src/core/version.ts
export const VERIFIED_ANGULAR_VERSION = 23; // was 22
```

That single line is the only place the target version lives. Recipes, the audit, the
tests and the README all read from it.

### 2. Get the worklist

```bash
npm run docs:audit
```

Every recipe is now **STALE** (`!`) because each still records
`verifiedAgainstVersion: 22`. The command exits non-zero while anything is stale, and
prints the deduplicated list of doc URLs to re-read.

Work the **version-sensitive** (`~`) recipes first — those are the ones already known to
differ across releases, so they are where a silent behaviour change is most likely.

### 3. Re-query the official docs — with the version pinned

Use the official Angular CLI MCP server, **not** memory and **not** a search engine:

```
npx @angular/cli mcp
```

Then, for each URL from step 2:

- Call `search_documentation` with an **explicit `version:`** matching the new target.
- **Confirm the reply reports `searchedVersion: <new version>`.** The tool silently falls
  back to older docs when a version has no results — a recipe verified against a silent
  fallback is worse than no recipe. If the version does not match, fix the query.
- Cross-check by fetching the page directly. A bare `angular.dev/...` URL is the current
  release; `vN.angular.dev/...` is an archived one.
- Read the page **in full**, not skimmed. The v21→v22 `required()` change was one
  sentence of prose under an unchanged table.

Pages that matter most, in rough order of risk:

1. `guide/forms/signals/validation` — the empty/missing semantics live here
2. `guide/forms/signals/form-logic` — rule signatures (`disabled`, `hidden`, `applyWhen`)
3. `essentials/signal-forms` — `form()`, `[formField]`, field state
4. `guide/forms/signals/field-state-management`
5. `guide/forms/signals/custom-controls` — `FormValueControl` / `FormCheckboxControl`
6. `guide/forms/signals/async-operations` — `validateHttp` / `validateAsync`
7. `guide/forms/signals/models` and `dynamic-forms-with-json` — arrays
8. `guide/forms/signals/migration` — `compatForm`, `SignalFormControl`

### 4. Update each recipe

For a recipe whose syntax is unchanged, update only its provenance:

```ts
sources: [DOCS.validation],
// verifiedAgainstVersion and retrievedISO come from withProvenance() —
// bump RETRIEVED_ISO at the top of recipes.ts once per re-verification pass.
```

For a recipe whose behaviour **changed**:

1. Update `before`/`after` to the new verified syntax.
2. Set `versionSensitive: true`.
3. Add a caveat starting `VERSION-SENSITIVE` that names **both** behaviours and says which
   version each applies to.
4. Give a **version-independent fallback** the agent can use when it is unsure of the
   project's version.

`Validators.requiredTrue` is the worked example of all four — copy its shape.

If a page is internally inconsistent, follow the **more specific prose**, and say so in a
caveat. Never silently pick one and move on. (The v22 validation page still has an "empty"
table listing only `null`/`''` while its prose says `false` is missing; the recipe follows
the prose and flags the contradiction.)

If something cannot be confirmed at all, ship it with
`caveats: ["UNVERIFIED — confirm on <exact URL>"]` rather than guessing.

### 5. Update the file header and the divergence table

`src/core/recipes.ts` has a provenance header block. Update:

- the targeted version and stability wording,
- the "BEHAVIOUR THAT CHANGED" list, adding any new divergence you found,

and add a row to the table at the top of this file.

### 6. Verify

```bash
npm run check      # tsc strict + eslint + tests
npm run docs:audit # must print "No stale recipes" and exit 0
```

The test suite enforces the invariants that reviews miss:

- every recipe has non-empty `sources` and a `verifiedAgainstVersion`
- every source is an `angular.dev` URL
- no recipe claims a version newer than the target
- every `versionSensitive` recipe actually carries a `VERSION-SENSITIVE` caveat

### 7. Re-run against a real codebase

Unit tests use synthetic fixtures and will not tell you the detector still matches real
code. Run the server against an actual Angular repo and eyeball the output — that is how
the three M1 detection gaps were found:

```bash
npm run build
node dist/server.js   # then call find_form_candidates over stdio
```

---

## Why the constraints are what they are

**Why pin and check `searchedVersion`.** The doc tool falls back to older versions
silently. Without the check you can spend an afternoon "verifying" against v20 docs and
produce confidently wrong recipes.

**Why `sources` is required by the schema.** An un-sourced recipe is indistinguishable
from one written out of a model's memory. Making it a required field means the failure is
a compile error and a red test, not something a reviewer has to notice.

**Why the audit exits non-zero.** So a stale-recipe state cannot be merged and forgotten.

**Why version-sensitive recipes need a fallback.** The server does not read the user's
installed Angular version, so it cannot pick for them. The agent must be handed both the
version-specific answer and a safe version-independent one.
