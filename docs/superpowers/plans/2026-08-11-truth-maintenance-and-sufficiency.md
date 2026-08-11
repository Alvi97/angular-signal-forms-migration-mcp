# Truth Maintenance & Sufficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop shipping false claims, then make the tool's own classification provably *sufficient* — not merely syntactically correct.

**Architecture:** Three shippable milestones, one in flight at a time per `CLAUDE.md` rule 3. **M8** removes every surviving false claim and adds a repo-wide guard so a retraction can never again propagate to code but not prose. **M9** introduces the missing invariant — a finding whose correct action depends on another file cannot be labelled `mechanical` — and fixes the two constructs that violate it. **M10** fixes two detection defects that produce wrong output regardless of recipes. Each milestone ends green on `npm run check` and is committed before the next begins.

**Tech Stack:** TypeScript 5.9 (strict, NodeNext), vitest 4, zod 4, `@modelcontextprotocol/sdk` 1.29, real `@angular/forms@22.0.7` in `verify/`.

## Global Constraints

Copied from `CLAUDE.md` and `SPEC.md`. Every task's requirements implicitly include these.

- **THIS SERVER NEVER EDITS USER CODE.** No task may add a write path to user source files.
- **A DOC GAP IS NOT A BEHAVIOUR.** Any claim of a version difference must be backed by diffing shipped source (`npm pack @angular/forms@N` / the vendored tree in `verify/node_modules`), never by comparing two doc pages. Absence of a statement is not evidence.
- **Docs are for citations and idiom, not for deciding truth.** Verified this session: `search_documentation({query:'getError', version:22})` returns zero Signal Forms results for an API that ships (`verify/node_modules/@angular/forms/types/_structure-chunk.d.ts:471`). Always pass an explicit `version:` and check `searchedVersion` in the reply.
- **Strict TS:** no `any`, no non-null `!`, explicit return types on exported functions, discriminated-union results, nothing thrown across a tool boundary.
- **No `console.log` in library code.** stdout is the MCP stdio channel; diagnostics go to stderr.
- **Definition of done per milestone:** `npm run check` green (typecheck + lint + test), `npm run docs:audit` exits 0, `npm run verify:recipes` green, README/ROADMAP updated, commit made.
- **Verified source facts this plan depends on** (re-derive if Angular is bumped):
  - `FieldState.getError(kind)` exists — `_structure-chunk.d.ts:471-474`, interface at `:430`.
  - `ValidationError.kind: string` — `_structure-chunk.d.ts:1556-1558`.
  - `disabled` / `hidden` each declare a `{ when }` overload (`@publicApi 22.0`) **and** a `@deprecated` bare-callback overload — `signals.d.ts:32-40`, `:66-74`. v21 code compiles on v22; it warns.
  - `isEmpty` treats `false` as missing identically in `@angular/forms` 21.0.0 and 22.0.7.

## File Structure

| File | Responsibility | Milestone |
|---|---|---|
| `test/no-retracted-claims.test.ts` | **new** — guards every tracked `*.md` against retracted claims | M8 |
| `README.md`, `SPEC.md`, `ROADMAP.md` | remove the fabricated `required()` divergence | M8 |
| `REVERIFICATION.md` | fix the worked-example pointer and the phantom checklist item | M8 |
| `src/core/recipes.ts` | correct the `submit()` caveat and the "will not compile" overstatement | M8 |
| `test/recipes.test.ts` | pin the corrected `submit()` semantics | M8 |
| `src/core/types.ts` | **new export** — `CROSS_FILE_CONSTRUCTS` | M9 |
| `test/sufficiency.test.ts` | **new** — the cross-file invariant | M9 |
| `src/core/detect-template.ts` | reclassify `Template.nativeAttribute` | M9 |
| `src/core/detect.ts` | move `hasError` out of the writes table; add negative name binding | M9, M10 |
| `src/core/angular-version.ts`, `src/core/coverage.ts` | Windows-safe `parentOf` | M10 |
| `test/angular-version.test.ts`, `test/coverage.test.ts` | backslash-path coverage | M10 |

---

# M8 — Stop shipping false claims

Highest severity, lowest effort. The retracted `required()` claim survives verbatim in three shipped documents including the one every session is ordered to read first, and one recipe caveat states the opposite of the shipped `submit()` implementation.

### Task 1: Guard every tracked document against retracted claims

The existing guard (`test/shared-caveat-sources.test.ts:56-70`) greps **recipe caveats only**. That is the smaller half of the surface; the prose is what ships to npm and what governs future sessions. This task widens the corpus.

**Files:**
- Create: `test/no-retracted-claims.test.ts`

**Interfaces:**
- Consumes: nothing — reads tracked markdown directly from disk.
- Produces: nothing importable. This is a guard test.

- [ ] **Step 1: Write the failing test**

Create `test/no-retracted-claims.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Every tracked `*.md`. Keep in sync with `git ls-files '*.md'`. */
const TRACKED_MARKDOWN = [
  'CLAUDE.md',
  'README.md',
  'REVERIFICATION.md',
  'ROADMAP.md',
  'SPEC.md',
] as const;

/**
 * Claims this project asserted, then disproved against shipped source.
 *
 * The v21/v22 `required()` divergence never existed: `isEmpty` is byte-identical in
 * @angular/forms 21.0.0 and 22.0.7, so v21 rejected `false` exactly as v22 does. Only the
 * docs changed. CLAUDE.md rule 2 retracts it; src/ and test/ were corrected; the prose was
 * not, and shipped for two releases. This guards the prose.
 *
 * Patterns match the ASSERTION form only. CLAUDE.md quotes the claim in order to retract it
 * ("v22 made `required()` reject `false`; v21 accepted it"), which is deliberately different
 * wording and must keep passing.
 */
const RETRACTED_CLAIMS: ReadonlyArray<{ readonly name: string; readonly pattern: RegExp }> = [
  {
    name: 'required() treats false differently on v21 vs v22',
    pattern:
      /as (?:missing|present) on \*{0,2}v2[12]\*{0,2},? but as (?:missing|present) on \*{0,2}v2[12]/i,
  },
  {
    name: 'requiredTrue is version-sensitive',
    pattern: /requiredTrue`? (?:between|is) a (?:one-line |mechanical )?rename and a (?:judgment )?rewrite/i,
  },
];

function read(file: string): string {
  return readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
}

describe('no tracked document asserts a retracted claim', () => {
  it.each(TRACKED_MARKDOWN)('%s is free of retracted claims', (file) => {
    const text = read(file);
    for (const claim of RETRACTED_CLAIMS) {
      expect(claim.pattern.test(text), `${file} asserts: ${claim.name}`).toBe(false);
    }
  });

  it('CLAUDE.md still records the source-level evidence for the retraction', () => {
    expect(read('CLAUDE.md')).toMatch(
      /byte-identical in\s+`?@angular\/forms`? 21\.0\.0 and 22\.0\.7/,
    );
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails for the right reason**

```bash
npx vitest run test/no-retracted-claims.test.ts
```

Expected: **3 failures** — `README.md`, `SPEC.md`, `ROADMAP.md`. `CLAUDE.md` and `REVERIFICATION.md` must PASS. If `CLAUDE.md` fails, the pattern is too broad — narrow it, do not exempt the file.

- [ ] **Step 3: Do not commit yet**

The test is red by design. Task 2 turns it green.

### Task 2: Delete the fabricated claim from the three documents

**Files:**
- Modify: `README.md:65-66`
- Modify: `SPEC.md:31-33`
- Modify: `ROADMAP.md:100-105`

- [ ] **Step 1: Replace the README bullet**

`README.md:65-66` currently reads:

```markdown
- `required()` treats `false` as missing on **v22** but as present on **v21**. That flips
  `Validators.requiredTrue` between a one-line rename and a rewrite.
```

Replace with a difference that is backed by shipped declarations:

```markdown
- `disabled()` / `hidden()` gained an options-object form in **v22** (`{ when: … }`) and
  marked the bare-callback form `@deprecated` — it still compiles, so a v21-shaped rule
  fails as a warning, not an error. Verified against the shipped overloads, not the guides.
```

- [ ] **Step 2: Replace the SPEC.md worked example**

`SPEC.md:31-33` sits inside the MANDATORY rule 6 ("Flag version-sensitive behaviour") and is the mechanism by which the error entered the recipes. Replace:

```markdown
   in its `caveats` and give the version-independent fallback. Known example: `disabled()`
   took a bare callback on v21; v22 added `disabled(path, { when: cb })` and marked the bare
   callback `@deprecated` rather than removing it. Confirm any such claim by diffing the
   shipped `.d.ts` across both versions — never by comparing the two documentation pages.
```

- [ ] **Step 3: Rewrite the ROADMAP version-sensitivity section**

`ROADMAP.md:100-105`. Replace the paragraph asserting the `required()` divergence with:

```markdown
Recipes are verified against **Angular v22**. Where behaviour differs across releases the
recipe says so in its `caveats` and names the version each form applies to. Version claims
are established by diffing the shipped package, not the docs — see `CLAUDE.md` rule 2 for
why that distinction is load-bearing here.
```

- [ ] **Step 4: Run the guard and confirm green**

```bash
npx vitest run test/no-retracted-claims.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Run the full check**

```bash
npm run check
```

Expected: typecheck clean, lint clean, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add test/no-retracted-claims.test.ts README.md SPEC.md ROADMAP.md
git commit -m "Guard every document against the retracted claim, not just recipe caveats

The required()/v21 retraction reached src/ and test/ but not the prose, which
is what ships to npm and what governs future sessions. The existing guard only
scanned recipe caveats. This widens the corpus to every tracked *.md and
replaces the fabricated example with the disabled() deprecation, which is
backed by the shipped overloads."
```

### Task 3: Correct the `submit()` caveat

`src/core/recipes.ts:1140-1141` claims `submit()` waits for pending async validation. The shipped implementation does not: `shouldRunAction` is synchronous and returns `!untracked(node.invalid)`, and `invalid()` is false while status is `'unknown'`. The corpus already contradicts itself — `recipes.ts:1446-1447` states the correct behaviour.

**Files:**
- Modify: `src/core/recipes.ts:1140-1141`
- Modify: `test/recipes.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `getSignalFormsRecipe(construct: string)` from `src/core/recipes.js`.
- Produces: no new exports.

- [ ] **Step 1: Confirm the behaviour against shipped source before changing a word**

```bash
grep -n -A14 "function shouldRunAction" verify/node_modules/@angular/forms/fesm2022/_validation_errors-chunk.mjs
```

Expected: a synchronous function returning `!untracked(...invalid())`, with no `await` on validation. If this does **not** match, stop — the premise of the task is wrong and must be re-derived.

- [ ] **Step 2: Write the failing test**

Append to `test/recipes.test.ts`:

```ts
describe('asyncValidator: submission semantics match the shipped implementation', () => {
  const caveats = (): string => {
    const recipe = getSignalFormsRecipe('asyncValidator');
    if (!recipe.found) throw new Error('missing recipe: asyncValidator');
    return recipe.caveats.join('\n');
  };

  it('never claims submit() waits for pending async validation', () => {
    expect(caveats()).not.toMatch(/submit\(\)`? waits for pending/i);
  });

  it('states that a pending async validator does not block submission', () => {
    expect(caveats()).toMatch(/does NOT block submission/);
  });
});

describe('the recipe corpus does not contradict itself on submission', () => {
  it('no two recipes disagree about whether submit() awaits validation', () => {
    const all = allRecipes().flatMap((r) => r.caveats);
    const waits = all.filter((c) => /submit\(\)`? waits for pending/i.test(c));
    expect(waits).toHaveLength(0);
  });
});
```

Ensure `allRecipes` is imported at the top of the file alongside `getSignalFormsRecipe`.

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run test/recipes.test.ts -t 'submission'
```

Expected: FAIL — the caveat at `recipes.ts:1140-1141` still asserts the waiting behaviour.

- [ ] **Step 4: Replace the caveat**

At `src/core/recipes.ts:1140-1141`, replace:

```ts
        '`submit()` waits for pending async validation, so a submit handler does not need to ' +
          'poll for completion itself.',
```

with:

```ts
        'A pending async validator does NOT block submission. `submit()` gates on ' +
          '`invalid()`, which is false while validation is still pending, so the action ' +
          'runs. If the server check must complete first, await it inside the action or ' +
          'guard on `pending()` before calling submit(). Verified against the shipped ' +
          'shouldRunAction in @angular/forms 22.0.7, which is synchronous.',
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run test/recipes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Soften the "will not compile" overstatement**

At `src/core/recipes.ts:959-960` (and the matching `disabled` caveat near `:1343`), replace `'Check your Angular version, or the rule will not compile.'` with:

```ts
          'Check your Angular version. The bare-callback overload is still declared on v22 ' +
          'and marked @deprecated, so a v21-shaped rule compiles with a warning rather ' +
          'than failing the build.',
```

- [ ] **Step 7: Run the full check and the compile harness**

```bash
npm run check && npm run docs:audit
```

Expected: both green.

- [ ] **Step 8: Commit**

```bash
git add src/core/recipes.ts test/recipes.test.ts
git commit -m "Fix the one caveat that states the opposite of the shipped submit()

shouldRunAction is synchronous and gates on invalid(), which is false while
validation is pending — so submit() runs the action without waiting. The
corpus already said this correctly elsewhere; the async recipe did not, and
an agent following it ships a form that submits before the server answers.
Also downgrades the disabled()/hidden() 'will not compile' claim: v22 still
declares the bare-callback overload, deprecated."
```

### Task 4: Fix REVERIFICATION.md's broken pointers

`REVERIFICATION.md:92` names `Validators.requiredTrue` as the worked example of a version-sensitive recipe — but `test/provenance.test.ts:80` now asserts that construct is **not** flagged version-sensitive. `:107` instructs the reader to update a "BEHAVIOUR THAT CHANGED" list that does not exist in `recipes.ts` (verified: `grep` finds it only in `REVERIFICATION.md`).

**Files:**
- Modify: `REVERIFICATION.md:92`, `REVERIFICATION.md:107`

- [ ] **Step 1: Repoint the worked example**

Replace line 92:

```markdown
`hidden` / `disabled` are the worked example of all four — copy their shape.
```

- [ ] **Step 2: Remove the phantom checklist item**

Replace line 107:

```markdown
- any new divergence you found, as a `VERSION-SENSITIVE` caveat on the affected recipe,
```

- [ ] **Step 3: Add the source-diff step the procedure is missing**

`CLAUDE.md` rule 2 requires diffing shipped source for version claims, but this procedure never says to. Insert before the "Verify" section:

```markdown
### 5b. Establish version claims from source, not from doc pages

Before writing any `VERSION-SENSITIVE` caveat:

```bash
npm pack @angular/forms@21 && npm pack @angular/forms@22
```

Diff the relevant symbol in the extracted `types/` and `fesm2022/` trees. A sentence present
in one version's guide and absent from the other's is **not** evidence of a behaviour change
— that is exactly how the retracted `required()` claim was manufactured and how it survived
two audits.
```

- [ ] **Step 4: Run the guard and full check**

```bash
npx vitest run test/no-retracted-claims.test.ts && npm run check
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add REVERIFICATION.md
git commit -m "Point reverification at a real divergence, and add the source-diff step

requiredTrue is no longer version-sensitive, so it could not be the worked
example; the 'BEHAVIOUR THAT CHANGED' list it told you to update does not
exist. Adds the npm pack diff that CLAUDE.md rule 2 requires and this
procedure omitted — the omission is why doc-to-doc comparison stayed the
de facto method."
```

- [ ] **Step 6: Ship M8**

```bash
npm run check && npm run docs:audit && npm run verify:recipes
git log --oneline -4
```

Expected: all green, four commits. **Stop here for review before starting M9** (`CLAUDE.md` rule 3).

---

# M9 — Sufficiency: mechanical must mean *complete*

The structural defect. Every recipe symbol is correct and the compile harness is green, and the tool still emits advice that silently deletes a validator. The missing invariant: **a finding whose correct action depends on a fact in another file cannot be `mechanical`**, because the agent applying it sees only this file.

### Task 5: Introduce the cross-file invariant

**Files:**
- Modify: `src/core/types.ts` (add export)
- Create: `test/sufficiency.test.ts`
- Modify: `src/core/detect-template.ts:204-213`

**Interfaces:**
- Produces: `export const CROSS_FILE_CONSTRUCTS: ReadonlySet<string>` from `src/core/types.js`.
- Consumes: `findFormCandidates(path, fs)` from `src/core/detect.js`, `memoryFs` from `test/helpers/memory-fs.js`.

- [ ] **Step 1: Add the constant**

Append to `src/core/types.ts`:

```ts
/**
 * Constructs whose correct action cannot be decided from the file they appear in.
 *
 * The agent applying a finding sees only that file, so advice that depends on a fact
 * elsewhere is not something it can apply confidently — that is the definition of a
 * judgment call, regardless of how simple the edit looks.
 *
 * `Template.nativeAttribute` is the motivating case: `minlength="8"` on a form-bound input
 * must be deleted when the component declares a matching rule, and must NOT be deleted when
 * the attribute is the only place the constraint is stated. Nothing in the template says
 * which.
 */
export const CROSS_FILE_CONSTRUCTS: ReadonlySet<string> = new Set(['Template.nativeAttribute']);
```

- [ ] **Step 2: Write the failing test**

Create `test/sufficiency.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findFormCandidates } from '../src/core/detect.js';
import { CROSS_FILE_CONSTRUCTS } from '../src/core/types.js';
import { memoryFs } from './helpers/memory-fs.js';

const ROOT = '/app';

/** A template whose native attributes are the only statement of their constraint. */
const TEMPLATE = `<form [formGroup]="form">
  <input formControlName="coupon" minlength="8" maxlength="16" />
  <input formControlName="email" required />
</form>`;

const COMPONENT = `import { FormGroup, FormControl } from '@angular/forms';
export class C {
  form = new FormGroup({
    coupon: new FormControl(''),
    email: new FormControl(''),
  });
}`;

describe('a cross-file construct is never labelled mechanical', () => {
  const fs = memoryFs({
    [`${ROOT}/c.html`]: TEMPLATE,
    [`${ROOT}/c.ts`]: COMPONENT,
  });
  const result = findFormCandidates(ROOT, fs);
  if (!result.ok) throw new Error('scan failed');
  const findings = result.data.flatMap((f) => f.findings);

  it('produced the cross-file findings the fixture contains', () => {
    const crossFile = findings.filter((f) => CROSS_FILE_CONSTRUCTS.has(f.construct));
    expect(crossFile.length).toBeGreaterThanOrEqual(3);
  });

  it.each([...CROSS_FILE_CONSTRUCTS])('%s is always judgment', (construct) => {
    const matching = findings.filter((f) => f.construct === construct);
    for (const finding of matching) {
      expect(finding.classification, `${construct} at line ${String(finding.line)}`).toBe(
        'judgment',
      );
    }
  });

  it('states the precondition rather than an unconditional delete', () => {
    const attr = findings.find((f) => f.construct === 'Template.nativeAttribute');
    expect(attr?.reason).toMatch(/only if|check the/i);
    expect(attr?.reason).not.toMatch(/^Delete the attribute\b/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run test/sufficiency.test.ts
```

Expected: FAIL — `Template.nativeAttribute` is currently `mechanical` and its reason ends "Delete the attribute — the rule emits it."

- [ ] **Step 4: Reclassify and rewrite the advice**

In `src/core/detect-template.ts`, at the `out.push({...})` block starting line 204, change `classification` and `reason`:

```ts
      classification: 'judgment',
      reason:
        `A hardcoded \`${name}\` on a form-bound element. Once this converts to ` +
        '`[formField]`, the directive sets that attribute itself and a v22 AOT build ' +
        'rejects the hand-written copy (NG8022). Delete it ONLY IF the component declares ' +
        `a matching rule — if this attribute is the only place the \`${name}\` constraint ` +
        "is stated, deleting it silently drops the validation. Check the control's " +
        'validators in the component first.',
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run test/sufficiency.test.ts
```

Expected: PASS.

- [ ] **Step 6: Fix the fallout in existing tests**

```bash
npx vitest run
```

`test/detect-template.test.ts` and `test/report-consistency.test.ts` likely assert the old `mechanical` classification and counts. Update those expectations to `judgment` — do **not** weaken the new test. Re-run until green.

- [ ] **Step 7: Update the matching recipe**

`src/core/recipes.ts` around `:1521-1524` carries the same unconditional "delete the attribute" advice in the `templateBindings` recipe. Bring it in line with the new reason text, adding the same precondition.

- [ ] **Step 8: Run the full check**

```bash
npm run check && npm run docs:audit
```

- [ ] **Step 9: Commit**

```bash
git add src/core/types.ts src/core/detect-template.ts src/core/recipes.ts test/
git commit -m "A finding that needs another file to decide it is not mechanical

Template.nativeAttribute told the agent to delete a hardcoded minlength.
That is right when the component declares a matching rule and wrong when the
attribute IS the constraint — and the template cannot tell which. Every
symbol in that advice was correct and the compile harness was green, which
is precisely the failure the harness cannot see. Encodes the invariant so
the next construct of this shape fails a test instead of a migration."
```

### Task 6: Move `hasError` out of the mechanical writes table

`hasError` is a **read**, misfiled in `CONTROL_WRITES_MECHANICAL` (`src/core/detect.ts:167-181`), and its translation is not a rename: it needs `FieldState.getError(kind)` plus the error-key mapping the project already pins in `test/error-kinds.test.ts`.

**Files:**
- Modify: `src/core/detect.ts:167-181`
- Modify: `src/core/recipes.ts` (`formStateRead` caveats)
- Modify: `test/state-write-advice.test.ts`

**Interfaces:**
- Consumes: the existing `CONTROL_READS` / `CONTROL_WRITES_MECHANICAL` sets in `detect.ts`.
- Produces: no new exports; `AbstractControl.hasError` keeps its construct name and continues to resolve to a recipe.

- [ ] **Step 1: Write the failing test**

Append to `test/state-write-advice.test.ts`:

```ts
describe('hasError is advised as a read, with the kind mapping', () => {
  it('does not describe hasError as a value write', () => {
    const recipe = getSignalFormsRecipe('AbstractControl.hasError');
    expect(recipe.found).toBe(true);
    if (!recipe.found) return;
    expect(recipe.construct).toBe('formStateRead');
  });

  it('names getError and the kind mapping', () => {
    const recipe = getSignalFormsRecipe('AbstractControl.hasError');
    if (!recipe.found) throw new Error('missing recipe');
    const caveats = recipe.caveats.join('\n');
    expect(caveats).toMatch(/getError\(/);
    expect(caveats).toMatch(/kind/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run test/state-write-advice.test.ts -t hasError
```

Expected: FAIL — `hasError` currently resolves through the writes path.

- [ ] **Step 3: Move the entry**

In `src/core/detect.ts`, delete `'hasError',` from `CONTROL_WRITES_MECHANICAL` (line ~172) and add it to the reads set alongside `'errors'`, with a comment:

```ts
  // A read, not a write: hasError(key) becomes getError(kind) on field state, and the
  // reactive error KEY is not always the Signal Forms KIND (minlength -> minLength).
  'hasError',
```

- [ ] **Step 4: Add the caveat to the `formStateRead` recipe**

In `src/core/recipes.ts`, add to the `formStateRead` recipe's `caveats`:

```ts
        '`control.hasError(key)` becomes `f.field().getError(kind) !== undefined` on v22 ' +
          '(FieldState.getError, verified against the shipped declarations — the docs search ' +
          'index returns only the Reactive Forms getError). The argument is a KIND, not the ' +
          'old error key: `minlength` became `minLength` and `maxlength` became `maxLength`, ' +
          'so a transliterated string silently never matches.',
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run
```

Expected: PASS. Update any count assertions in `test/detect-m5.test.ts` that assumed `hasError` was a write.

- [ ] **Step 6: Add the property test that generalises this**

Append to `test/sufficiency.test.ts`:

```ts
describe('every write classified mechanical names its replacement', () => {
  const REPLACEMENT = /signal|model\(|\bform\(|field state|f\(\)|getError|set\(|update\(/i;

  it.each([
    'AbstractControl.setValue',
    'AbstractControl.patchValue',
    'AbstractControl.reset',
    'AbstractControl.getRawValue',
    'AbstractControl.markAsTouched',
  ])('%s advice names a Signal Forms replacement', (construct) => {
    const recipe = getSignalFormsRecipe(construct);
    expect(recipe.found).toBe(true);
    if (!recipe.found) return;
    const text = [recipe.description, ...recipe.caveats].join('\n');
    expect(text).toMatch(REPLACEMENT);
  });
});
```

Import `getSignalFormsRecipe` at the top of the file.

- [ ] **Step 7: Run the full check**

```bash
npm run check && npm run docs:audit
```

- [ ] **Step 8: Commit and ship M9**

```bash
git add src/core/detect.ts src/core/recipes.ts test/
git commit -m "hasError is a read, and its argument is a kind not the old key

It sat in CONTROL_WRITES_MECHANICAL, so the tool advised a value-write
migration for a predicate, and said nothing about minlength -> minLength.
A transliterated key silently never matches, which is the same failure mode
as the deleted attribute: correct syntax, wrong outcome. Uses
FieldState.getError, verified from the shipped .d.ts — the docs search index
returns only the Reactive Forms getError for that name."
```

**Stop here for review before starting M10.**

---

# M10 — Detection correctness

Two defects that produce wrong output no matter how good the recipes are.

### Task 7: Make `parentOf` Windows-safe

`src/core/angular-version.ts:59-63` and `src/core/coverage.ts:29-32` both split on `'/'` only, while `toAbsolute` is `path.resolve` (`src/infra/node-fs.ts:39`), which emits backslashes on win32. Consequence: version detection returns `{known:false}` on every Windows project, so the **v21 blocking gate silently disappears** — the one thing `SERVER_INSTRUCTIONS` tells the agent to check first. `src/core/detect.ts:63-66` already does this correctly.

**Files:**
- Modify: `src/core/angular-version.ts:59-63`
- Modify: `src/core/coverage.ts:29-32`
- Modify: `test/angular-version.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature change — `parentOf(path: string): string | undefined` in both files.

- [ ] **Step 1: Write the failing test**

Append to `test/angular-version.test.ts`:

```ts
describe('Windows paths', () => {
  it('finds the manifest when the path uses backslashes', () => {
    const fs = memoryFs({
      'C:\\proj\\package.json': JSON.stringify({ dependencies: { '@angular/core': '^22.0.0' } }),
      'C:\\proj\\libs\\app\\a.ts': '',
    });
    const detected = detectAngularVersion('C:\\proj\\libs\\app', fs);
    expect(detected.known).toBe(true);
    if (detected.known) expect(detected.major).toBe(22);
  });
});
```

Note: `memoryFs` splits on `/` when deriving directories, so add backslash support to the helper in the same step — in `test/helpers/memory-fs.ts` change `path.split('/')` to `path.split(/[\\/]/)` and join with the separator the key used. If that proves fiddly, assert against a `\\server\share`-style POSIX-mixed path instead; the production fix is what matters.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/angular-version.test.ts -t Windows
```

Expected: FAIL — `known` is `false`.

- [ ] **Step 3: Fix both copies**

`src/core/angular-version.ts:59-63`:

```ts
function parentOf(path: string): string | undefined {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (index <= 0) return undefined;
  return path.slice(0, index);
}
```

`src/core/coverage.ts:29-32`:

```ts
function parentOf(path: string): string | undefined {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return index <= 0 ? undefined : path.slice(0, index);
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run test/angular-version.test.ts
```

- [ ] **Step 5: Run the full check and commit**

```bash
npm run check
git add src/core/angular-version.ts src/core/coverage.ts test/
git commit -m "Windows paths: version detection was dead, taking the v21 gate with it

toAbsolute is path.resolve, which emits backslashes on win32, but parentOf
split on '/' only — so every Windows project reported an unknown Angular
version and analyze_migration_complexity returned blockingPrerequisite:null.
The gate SERVER_INSTRUCTIONS names as the first thing to check vanished on
exactly the platform types.ts:365 ships a 'windows' option for. detect.ts:63
already handled both separators."
```

### Task 8: Stop binding form names across unrelated scopes

`src/core/detect.ts` builds one flat file-wide `Set<string>` of form names, so a local `const form = new FormData()` inherits the binding from an unrelated `form: FormGroup` field — including across class boundaries. Reproduced this session: `form.get('receipt')` on a `FormData` reported as `AbstractControl.get` "becomes dot notation on the field tree", and `form.reset()` on an `HTMLFormElement` in a **different class** reported as `AbstractControl.reset`. `ROADMAP.md:126` names `formData.get()` as a case the design excludes.

Full scope analysis is out of proportion. This task adds **negative binding**: a local declaration initialising a name to a known non-form value suppresses that name within the declaration's enclosing function.

**Files:**
- Modify: `src/core/detect.ts` (name-binding pass, ~`:313-325`)
- Create: `test/detect-shadowing.test.ts`

**Interfaces:**
- Consumes: `ts.SourceFile` walk already present in `collectNames`.
- Produces: internal only — a `suppressedRanges: Map<string, Array<[number, number]>>` threaded alongside the existing name set, and a helper `isSuppressed(name: string, pos: number): boolean`.

- [ ] **Step 1: Write the failing test**

Create `test/detect-shadowing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findFormCandidates } from '../src/core/detect.js';
import { memoryFs } from './helpers/memory-fs.js';

const SOURCE = `import { FormGroup, FormControl } from '@angular/forms';

export class Shadow {
  form = new FormGroup({ email: new FormControl('') });

  upload(file: File): string | null {
    const form = new FormData();
    form.append('receipt', file);
    return form.get('receipt') as string | null;
  }
}

export class Unrelated {
  submitNative(): void {
    const form = document.querySelector('form') as HTMLFormElement;
    form.reset();
  }
}`;

describe('a local non-form shadowing a form name is not reported', () => {
  const result = findFormCandidates('/app/shadow.ts', memoryFs({ '/app/shadow.ts': SOURCE }));
  if (!result.ok) throw new Error('scan failed');
  const findings = result.data.flatMap((f) => f.findings);

  it('still reports the real form', () => {
    expect(findings.some((f) => f.construct === 'FormGroup')).toBe(true);
  });

  it('does not report FormData.get as AbstractControl.get', () => {
    expect(findings.filter((f) => f.construct === 'AbstractControl.get')).toHaveLength(0);
  });

  it('does not report HTMLFormElement.reset in an unrelated class', () => {
    expect(findings.filter((f) => f.construct === 'AbstractControl.reset')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/detect-shadowing.test.ts
```

Expected: the two negative assertions FAIL (1 finding each).

- [ ] **Step 3: Add the non-form constructor table**

In `src/core/detect.ts`, near the other classification tables:

```ts
/**
 * Constructors and calls that produce something which is emphatically NOT a form, but whose
 * result is commonly held in a variable named `form`, `control` or `group`. A local binding
 * to one of these suppresses the file-wide form-name binding for that name within the
 * enclosing function.
 */
const NON_FORM_INITIALIZERS: ReadonlySet<string> = new Set([
  'FormData',
  'URLSearchParams',
  'Map',
  'Set',
  'Headers',
]);
```

- [ ] **Step 4: Record suppressed ranges during the name pass**

In the walk that populates the form-name set, when a `VariableDeclaration` binds an identifier already in `names.forms` and its initializer is a `NewExpression` whose callee is in `NON_FORM_INITIALIZERS`, or a call to `document.querySelector`, record the enclosing function's `[pos, end]` against that name. Add:

```ts
function enclosingFunctionRange(node: ts.Node): readonly [number, number] {
  let current: ts.Node | undefined = node;
  while (current !== undefined) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isConstructorDeclaration(current)
    ) {
      return [current.pos, current.end];
    }
    current = current.parent;
  }
  return [node.pos, node.end];
}
```

- [ ] **Step 5: Gate `isFormDerivedReceiver` on the suppressed ranges**

Where an identifier receiver is matched against `formNames`, first check suppression:

```ts
function isSuppressed(
  name: string,
  pos: number,
  suppressed: ReadonlyMap<string, readonly (readonly [number, number])[]>,
): boolean {
  const ranges = suppressed.get(name);
  if (ranges === undefined) return false;
  return ranges.some(([start, end]) => pos >= start && pos <= end);
}
```

- [ ] **Step 6: Run to verify it passes**

```bash
npx vitest run test/detect-shadowing.test.ts && npx vitest run
```

Expected: the new file passes and no existing test regresses. If a corpus test regresses, the suppression is too broad — narrow the initializer table, do not weaken the test.

- [ ] **Step 7: Update ROADMAP's falsified claim**

`ROADMAP.md:126-127` currently asserts the import gate "keeps `params.get()`, `formData.get()` and `map.get()` out of the report (verified against a real workspace: 38 true positives, 0 false positives)." Rewrite as a dated measurement rather than a property:

```markdown
  out of the report. Measured on a 50-repo corpus (2026-07): 38 true positives, 0 false
  positives on that corpus. A local `const form = new FormData()` shadowing a `FormGroup`
  field DID escape this until M10 added negative binding for known non-form initialisers;
  names bound through an unlisted constructor can still shadow.
```

- [ ] **Step 8: Run the full check and commit**

```bash
npm run check && npm run docs:audit && npm run verify:recipes
git add src/core/detect.ts ROADMAP.md test/
git commit -m "A local FormData named 'form' is no longer a form

Name binding was file-wide and flat, so a FormGroup field bound the name for
every scope in the file — including other classes. form.get('receipt') on a
FormData was reported as AbstractControl.get, and an HTMLFormElement.reset in
an unrelated class as AbstractControl.reset. Adds negative binding for known
non-form initialisers, scoped to the enclosing function, and restates the
ROADMAP's '0 false positives' as the dated corpus measurement it was rather
than a property of the design."
```

---

## Deferred — plan these separately

These are independent subsystems. Each needs its own plan; do not fold them into M8–M10.

**M11 — Output scale and agent ergonomics.** `find_form_candidates` returned 93,922 bytes for a 7-file fixture, and `jsonResult` (`src/server.ts:75`) emits every payload twice (text *and* `structuredContent`). Scope: `limit`/`offset`/`constructs` on the three scanning input schemas, stop double-emitting, group judgment findings by construct so each reason prints once, cap the suggested-order table. Blocked on nothing; highest value per hour after M10.

**M12 — Behavioural verification harness.** The compile harness proves shape, not runtime. Probed this session: `form()` runs headless once `@angular/compiler` is present and `APP_ID` is provided, then requires `DestroyRef` + `ChangeDetectionScheduler` — so the realistic route is vitest + a DOM shim + `TestBed` in `verify/`, roughly half a day. Worth it for the ~6 recipes making runtime claims (`submit`, `validateAsync`, `debounce`, `disabled`, `reset`, submission errors). This is what would have caught Task 3 by observation instead of by reading minified source.

**M13 — Test coverage for the prose layer.** `src/core/upgrade-report.ts` (274 lines) has zero tests and produces the entire `get_angular_upgrade_plan` payload; `src/server.ts` has none because `main()` runs at import with no entrypoint guard. Also add `format:check` to `npm run check` — `npx prettier --check .` currently fails on 6 files and CI never runs it, so a gate the definition of done requires is permanently red and unobserved.

---

## Self-Review

**Spec coverage.** Every CONFIRMED critical and major from the evaluation maps to a task: retracted claim in prose → Tasks 1, 2, 4; `submit()` caveat → Task 3; `nativeAttribute` sufficiency → Task 5; `hasError` misclassification → Task 6; Windows `parentOf` → Task 7; `FormData` false positive → Task 8. Report size, missing tests, and `format:check` are explicitly deferred to M11/M13 with rationale rather than dropped.

**Placeholder scan.** No TBD/TODO. Every code step carries the actual code. Task 7 Step 1 flags a known fiddly point in `memoryFs` and gives a fallback rather than leaving it open. Task 8 Steps 4–5 describe an edit to existing walk code that cannot be quoted verbatim without the surrounding function; the helper functions it needs are given in full and the integration point is named by line.

**Type consistency.** `parentOf(path: string): string | undefined` matches both existing signatures. `CROSS_FILE_CONSTRUCTS` is `ReadonlySet<string>`, matching the other tables in `types.ts`. `getSignalFormsRecipe` returns a discriminated union, so every test narrows on `.found` before touching `.caveats`. `findFormCandidates(path, fs)` returns `{ok:true,data} | {ok:false,error}` and every test narrows before use.

**One risk flagged:** Task 5 changes a classification, which will move counts in `test/detect-template.test.ts`, `test/report-consistency.test.ts` and possibly the corpus tests. That is expected and is why Step 6 exists. Update the expectations; do not weaken the new invariant to keep old numbers.
