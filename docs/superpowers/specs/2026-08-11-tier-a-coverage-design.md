# M11 — Tier A coverage: close the silent-miss gaps

**Status:** design, approved in conversation 2026-08-11. Implementation plan to follow.

## Problem

Three detection gaps let real Reactive Forms code pass through the scanner under-reported.
All three share the worst property a detector can have: the file **is** scanned, so it
appears in the report looking nearly migrated, rather than being visibly absent.

Measured on this codebase at v0.5.2:

| Gap                   | Behaviour today                                                                                                                                                                                                                                                    | Severity |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Aliased imports       | `import { FormBuilder as FB, FormGroup as FG, Validators as V }` yields **1 finding where the unaliased file yields 5**. The import gate passes because it only reads the module specifier (`detect.ts:256-262`), so the file is scanned and under-reports by 80%. | highest  |
| Inline `template:`    | Total blackout. A component with `[formGroup]`, `formControlName`, `formArrayName` and a hardcoded `required` in an inline template produces **zero** `Template.*` findings.                                                                                       | high     |
| Destructured controls | `const { email, pw } = this.form.controls` reports `AbstractControl.controls` at the destructuring site but **misses every subsequent use** — `email.setValue()`, `pw.markAsTouched()`. You learn the file touches `.controls`, not where the work is.             | medium   |

`ROADMAP.md` currently files aliased imports under "No TypeChecker… building a full
`ts.Program` would be authoritative." That is wrong: the alias map is in the import clause of
the file already being parsed. None of these three needs `ts.Program`.

## Scope

**In:** named import aliases; inline `template:` strings; destructured controls.

**Out, deliberately:**

- Namespace imports (`import * as ng from '@angular/forms'`). Needs a second matching path
  through property access at every site that currently matches an identifier. Rare in Angular
  code. Revisit if a corpus run finds it.
- Local re-binding (`const FG = FormGroup`). Requires dataflow tracking — the beginning of the
  `ts.Program` problem, and each hop widens the false-positive surface against this tool's
  precision-first stance.
- Template literals **with substitutions** (`` template: `<form>${partial}</form>` ``). A
  substituted template is not statically analysable; scanning the raw text would report line
  numbers that drift from the source. Skipped explicitly, and counted so the report can say so.
- `ts.Program` deep mode, `FormRecord` / `AbstractControl` subclassing recipes. Separate specs.

## Verification performed

Per `CLAUDE.md` rule 2 and `SPEC.md` rules 5-7. Angular CLI MCP with explicit `version: 22`,
`searchedVersion: 22` confirmed on every reply; behavioural claims taken from shipped source.

| Claim                                                                                                     | Evidence                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@Component.template` is the current inline-template property                                             | `angular.dev/api/core/Component#template_3` (MCP, v22)                                                                                                                     |
| `FieldTree<TModel>` is destructurable — a callable intersected with `Subfields<TModel>` for record models | `verify/node_modules/@angular/forms/types/_structure-chunk.d.ts:208`, `@publicApi 22.0`                                                                                    |
| A held field whose key vanishes from its parent throws **NG01902 Orphan field**                           | `angular.dev/errors/NG01902` (MCP, v22) + shipped guard at `_validation_errors-chunk.mjs:1121`: `throw new _RuntimeError(-1902, … 'Orphan field, looking for property …')` |
| Array-element equivalent throws `1904`                                                                    | same file, `:1123`                                                                                                                                                         |

The orphan behaviour is the substantive find: destructuring the field tree **typechecks**, so a
purely type-level check would call the migration safe. It is safe for a static model and a
runtime error for a model whose keys come and go. That distinction goes in the recipe.

## Design

### 1. Named import aliases

Pass 1 gains an alias map built from the import clause of every `@angular/forms` import:

```ts
/** `import { FormGroup as FG }` -> Map { 'FG' => 'FormGroup' }. Identity for unaliased names. */
function collectFormsAliases(sourceFile: ts.SourceFile): ReadonlyMap<string, string>;
```

Only `NamedImports` with a `propertyName` produce a non-identity entry. A `canonical(name)`
helper then wraps each of the **15 sites** in `detect.ts` that match a bare Angular Forms
symbol. They come in two styles, and the second is easy to overlook:

- **Set membership (13):** `CONTROL_TYPES.has` (`:410`, `:480`, `:492`, `:902`, `:933`),
  `REPORTED_CONTROL_TYPES.has` (`:1366`), the literal `'FormArray'` / `'FormGroup'`
  comparisons (`:984`, `:1018`, `:1038`, `:1110`), the `Validators` check (`:1253`), and
  `ControlValueAccessor` (`:600`).
- **Suffix match (2):** `isFormBuilderType` (`:527`) and `isInjectFormBuilder` (`:543`) both
  test `.endsWith('FormBuilder')` so that `NonNullableFormBuilder` matches. An alias like `FB`
  does not end with `FormBuilder`, which is exactly why the measured fixture lost
  `FormBuilder` and `FormBuilder.group`. These two do not appear in a grep for
  `CONTROL_TYPES.has` — the first draft of this spec under-counted because of it.

Findings keep the **canonical** construct name, so recipe lookup is unaffected; the `snippet`
naturally shows the alias as written.

**The completeness risk is the whole design problem here.** Fifteen sites in two different
matching styles, and missing one produces a partial fix that looks complete. Enumerating them
by hand already failed once while writing this spec, which is the argument: the risk is
discharged by a differential test, not by careful reading. See Testing.

### 2. Inline templates

`detectInSource` gains a pass over `@Component` decorators:

1. Find the `template` property in the decorator's object literal.
2. Accept `NoSubstitutionTemplateLiteral` and `StringLiteral`. Skip `TemplateExpression`
   (has substitutions) and count the skip.
3. Run the existing `detectInTemplate` from M7 on the string — full reuse, no second scanner.
4. Offset each finding's line: `absolute = templateStartLine + relativeLine - 1`, where
   `templateStartLine` comes from `ts.getLineAndCharacterOfPosition(sourceFile, literal.getStart(sourceFile))`.

Findings carry the same `Template.*` construct names as external templates and resolve to the
same recipes.

**Role classification — decided, not deferred.** An inline template does **not** demote its
file to `reference only`. The file still constructs the form, so it remains an `owner` and
sorts normally. The existing rule ("templates sort last because they cannot be migrated
alone") exists because an external `.html` has no owner; an inline template _is_ in its owner.

### 3. Destructured controls

`collectFormLikeNames` gains a case for `ObjectBindingPattern` whose initializer is
form-derived (reusing `isFormDerivedReceiver`): each bound name joins `names.forms`, so
subsequent `email.setValue(...)` matches as it would through `form.controls.email`.

Interaction with M10's `shadowedByNonForm`: nearest-binding-wins still applies, and a
destructuring binding is a `VariableDeclaration` whose initializer is form-derived, so it
resolves _toward_ form-ness. No conflict; a test pins it.

The `formStateRead` recipe gains the orphan caveat:

> Destructuring the field tree (`const { email } = f`) typechecks — subfields are real
> properties. But the destructured reference is a live view into the parent, not a snapshot:
> if the model's shape changes so that key no longer exists, reading it throws **NG01902
> Orphan field**. Safe for a fixed model; for one whose keys come and go, read through the
> tree at the point of use.

## Error handling

No new failure modes. All three work inside the existing single-file
`ts.createSourceFile` parse with the injected `FileSystemPort`; core stays pure and no I/O is
added. A malformed decorator, a `template` that is not a string, or a template literal with
substitutions is skipped rather than throwing — consistent with the existing scanner, which
never throws across a tool boundary.

## Testing

**The differential test is the load-bearing one.** It converts "did we catch all 13 sites?"
from a claim into a check:

```ts
// Same component twice. An alias must not change what is found.
it.each(ALIAS_FIXTURES)('%s reports identically with aliased imports', (source) => {
  expect(constructsOf(withAliasedImports(source))).toEqual(constructsOf(source));
});
```

Fixtures must exercise every construct family that matches a bare symbol name: `FormGroup`,
`FormControl`, `FormArray`, `FormBuilder` (constructor param **and** `inject()`), `Validators.*`,
`ControlValueAccessor`, and a control type in type position. Miss a site and the test names it.

Additionally:

- **Inline templates:** a fixture whose inline template holds each `Template.*` construct,
  asserting both the constructs and the **absolute line numbers** — the offset arithmetic is
  the part that will be wrong. One fixture with a substituted template asserting it is skipped
  and counted, not silently dropped.
- **Destructured controls:** the uses after the destructuring are found; a destructured
  non-form (`const { get } = new Map()`) is still not reported, pinning the M10 interaction.
- **Regression:** the existing 636 tests stay green. Expect count changes in corpus tests, since
  this is a coverage increase; update expectations, do not relax them.

## Success criteria

1. The aliased fixture reports the **same 5 constructs** as the unaliased one.
2. A component with an inline template reports its `Template.*` findings at correct absolute
   lines, and keeps `owner` role.
3. Uses of destructured controls are reported.
4. `npm run check`, `npm run docs:audit`, `npm run verify:recipes` all green.
5. `ROADMAP.md`'s "No TypeChecker" limitation is corrected to stop attributing these three to
   `ts.Program`, and states what genuinely still needs it.
