# REVERIFICATION.md — re-verifying recipes on a new Angular release

Signal Forms is young and its behaviour has **already changed between releases**. Verified
divergences, each established by diffing the shipped packages:

| What                                | v21                                 | v22                                                                                                                                                   |
| ----------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disabled()` / `hidden()` signature | bare callback: `disabled(path, cb)` | **options object**: `disabled(path, { when: cb })`. The bare callback is still declared and marked `@deprecated`, so v21 code compiles with a warning |
| Binding directive                   | `[control]` in pre-release material | `[formField]`                                                                                                                                         |
| Experimental banner                 | present                             | removed                                                                                                                                               |

This table once carried a fourth row asserting a `required()` divergence across those two
versions. **That row was false**, and it is recorded and refuted in full in `CLAUDE.md`
rule 2 — deliberately in one place only, so the wording that was wrong is quoted exactly
once in this repo. The short version: the two shipped packages are byte-identical on that
code path, only the documentation differed, and the absence of a sentence was read as a
behaviour change. It survived two audits because every audit compared doc pages to doc
pages. Step 5b below is what stops the next one.

So: **recipes are not portable across Angular versions, memory is not a source, and neither
is a diff of two documentation pages.** This document is the procedure. Follow it exactly;
do not shortcut it with recall.

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

`hidden` / `disabled` are the worked example of all four — copy their shape. (`requiredTrue`
used to be cited here, on the strength of a divergence that does not exist;
`test/provenance.test.ts` now asserts it is NOT flagged version-sensitive.)

If a page is internally inconsistent, follow the **more specific prose**, and say so in a
caveat. Never silently pick one and move on. (The v22 validation page still has an "empty"
table listing only `null`/`''` while its prose says `false` is missing; the recipe follows
the prose and flags the contradiction.)

If something cannot be confirmed at all, ship it with
`caveats: ["UNVERIFIED — confirm on <exact URL>"]` rather than guessing.

### 5. Update the file header and the divergence table

`src/core/recipes.ts` has a provenance header block. Update:

- the targeted version and stability wording,
- any new divergence you found, as a `VERSION-SENSITIVE` caveat on the affected recipe,

and add a row to the table at the top of this file.

### 5b. Establish every version claim from shipped source

**Do this before writing any `VERSION-SENSITIVE` caveat, and before adding a row to the
table above.** This step did not exist when the `required()` row was written, which is why
the row was wrong and why two audits missed it.

```bash
npm pack @angular/forms@21 && npm pack @angular/forms@22
tar -xzf angular-forms-21.*.tgz -C /tmp/f21 --strip-components=1
tar -xzf angular-forms-22.*.tgz -C /tmp/f22 --strip-components=1
diff <(grep -A6 'function isEmpty' /tmp/f21/fesm2022/signals.mjs) \
     <(grep -A6 'function isEmpty' /tmp/f22/fesm2022/signals.mjs)
```

Substitute the symbol you are checking. Rules:

- A **type-level** claim (does this symbol exist, what arity, what option shape) is settled
  by `types/*.d.ts`. Note whether an old overload was **removed** or merely marked
  `@deprecated` — the second still compiles, and saying "it will not compile" is the more
  dangerous error.
- A **behavioural** claim is settled by the body in `fesm2022/`. Read the function.
- A sentence present in one version's guide and absent from the other's is **not evidence of
  anything**. Absence is not a behaviour. If you cannot show the difference in the shipped
  bytes, there is no difference to document.

`verify/` currently vendors only v22, so the harness can compile-check v22 claims and nothing
about v21. Until it vendors both, every v21 claim in this repo is unfalsifiable by its own
tooling — which is exactly the condition the retracted claim survived in.

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
