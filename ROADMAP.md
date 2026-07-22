# ROADMAP

Milestones are defined in [SPEC.md](./SPEC.md). This file tracks what each milestone
deliberately **defers**, so nothing silently falls through the gap.

## Shipped

**M1** — `find_form_candidates` + `get_signalforms_recipe`. Detects `FormControl`,
`FormGroup`, `FormBuilder`, `FormBuilder.group`, `FormBuilder.control`, `Validators.*`,
custom `ValidatorFn`, `AbstractControl.get`, control types in type position,
`valueChanges`, `statusChanges`.

**M2** — dynamic and async. Adds `FormArray` and `fb.array()` as first-class findings
(static arrays mechanical, runtime-mutated ones judgment), shape mutation
(`addControl` / `removeControl` / `setControl` / `registerControl`, `push` / `removeAt` /
`insert` / `clear`), and async validators (`AsyncValidatorFn`, the `asyncValidators`
option). Recipes: `FormArray`, `dynamicControls`, `asyncValidator`. New tool
`analyze_migration_complexity`.

**M3** — deep judgment. Detects `ControlValueAccessor` (via `implements` **or** the
`NG_VALUE_ACCESSOR` provider, reported once per class) and grades form streams by the RxJS
operators in their `.pipe()` chain:

| Tier | Operators | Construct | Answer |
| --- | --- | --- | --- |
| trivial | none / bare `subscribe` | `valueChanges` | `computed()`, or `effect()` for real side effects |
| moderate | `map`, `filter`, `debounceTime`, `distinctUntilChanged`, `startWith`, `tap`, … | `valueChangesPipeline` | `computed()` + the `debounce()` schema rule |
| hard | `switchMap`, `mergeMap`, `combineLatest`, `withLatestFrom`, `forkJoin`, … | `valueChangesAsyncPipeline` | **no direct equivalent** — pick between async validation rules, `rxResource`, or keeping RxJS behind `toObservable`/`toSignal` |

The hardest operator present decides the tier. Recipes: `ControlValueAccessor`,
`valueChanges`, `valueChangesPipeline`, `valueChangesAsyncPipeline`.

**M4** — reporting. `get_migration_report` composes findings, complexity and recipe
references into a markdown string: totals, suggested order, construct table, every
judgment call with its line and reason, and a version-sensitivity warning that fires only
for constructs actually present. Returns the string; the server never writes files.

**M5** — form state access. Detects state read straight off a form (`.value`, `.invalid`,
`.valid`, `.errors`, `.touched`, `.dirty`, `.pristine`, `.pending`, `.controls`, `.status`)
and the write APIs (`.setValue`, `.patchValue`, `.reset`, `.getRawValue`, `.hasError`, and
the `markAs*` / `setErrors` / `enable` / `setValidators` family). Recipes: `formStateRead`,
`formStateWrite`.

Found by running M4 against a real repo: `forgot-password.component.ts` was reported as
"7 findings, all mechanical" while two further lines (`form.invalid`, `form.value`) also
had to change. On mockio-master this added **39 findings (+33%)**, so the earlier totals
materially understated the work.

Two access modes are split rather than lumped, mirroring the `.get()` treatment:

| Usage | Class | Why |
| --- | --- | --- |
| `form.controls.email`, `form.controls['email']` | mechanical | becomes `f.email` |
| `Object.keys(form.controls)` | judgment | the field tree is a typed object, not a string-keyed map |
| `.setValue` / `.patchValue` / `.reset` / `.getRawValue` | mechanical | value writes go through the model signal |
| `markAs*` / `setErrors` / `enable` / `setValidators` | judgment | state is derived from rules; no imperative equivalent |

**M6a** — correctness hardening: version gate + ordering roles. The server now reads the
TARGET project's Angular version (exact installed version from `node_modules`, falling back
to the declared range) and opens the report with a **blocking prerequisite** when it is
below v21, because `@angular/forms/signals` does not exist there. Version-sensitive recipes
resolve against the detected version instead of handing the agent both variants — including
the awkward case where the project is on *neither* diverging version.

Files are also classified by role, fixing a real ordering defect:

| Role | Meaning | Ordering |
| --- | --- | --- |
| `owner` | constructs a form (`new FormX`, `fb.group/array/control`) | normal |
| `validators` | owns no form but defines reusable validators | normal, flagged as a shared primitive to decide early |
| `reference` | only annotations/casts/state reads on another file's form | sorted **last** — cannot be migrated alone |

The `reference` case is the `roles-section-formio` defect: one finding, ranked first, and
un-migratable in isolation. The `validators` case was a flaw in the first fix — burying a
shared validator module as "cannot be migrated alone" is worse than not classifying at all.

**M6b/M6c** — nested array/group recipe examples, and a **compile harness**. `verify/` is a
separate workspace with a real `@angular/forms@22` installed; `npm run verify:recipes`
generates a reference to every symbol the recipes import and typechecks fixtures covering
the highest-frequency recipes. CI runs it on every push.

What the harness proved that documentation alone could not:

- `disabled(path, { when })` really is the v22 signature.
- The nested `schema()` + `apply()` inside `applyEach()` composition typechecks — the v22
  docs contain no such example, so this had been reasoned from signatures.
- `f().reset(value)`, `f.email().value.set(v)`, `f.items[0].name().value()`,
  `form(model, schema, { submission: { action } })`, `debounce(path, 'blur')` and
  `FormValueControl` all exist and take the arguments the recipes claim.
- Deliberately injecting the historical `Control`-instead-of-`FormField` mistake makes the
  harness fail with `TS2305`, which is what makes a green run mean something.

### Still deferred

| Item | Target | Note |
| --- | --- | --- |
| Classifying arbitrary RxJS outside form streams | post-M4 | Explicitly out of scope. Operator analysis is rooted at `.valueChanges` / `.statusChanges`, so it cannot stray into unrelated observables. A general RxJS-to-signals tool is a different product. |
| Reading the project's installed Angular version | post-M4 | Would let version-sensitive recipes pick the right variant instead of handing the agent both. |

### Version sensitivity

Recipes are verified against **Angular v22**. Signal Forms behaviour has already changed
between v21 and v22 — `required()` treats `false` as missing on v22 but as present on v21,
which flips `Validators.requiredTrue` between a mechanical rename and a judgment rewrite.
Recipes affected by this say so in their `caveats` and give a version-independent fallback.

Deferred: the server does not read the user's installed `@angular/core` version, so it
cannot tailor a recipe to the project automatically. The agent must check. A future
milestone could take an optional `angularVersion` input.

## Known limitations (all milestones)

- **Import gate.** A file is only scanned if it imports from `@angular/forms`.
  This kills false positives (any `.valueChanges` on any observable would otherwise
  match) at the cost of missing forms reached indirectly through a service that
  re-exports them. Revisit if it proves too strict in practice.
- **No TypeChecker.** Detection parses each file in isolation with
  `ts.createSourceFile`, so `fb.group(...)` is matched by binding local identifiers
  to `FormBuilder` (constructor params and `inject(FormBuilder)`) rather than by
  type resolution. A `FormBuilder` obtained in an unusual way will be missed.
  Building a full `ts.Program` would be authoritative but requires resolving the
  user's tsconfig and node_modules on every call.
- **`.get()` detection depends on name binding.** `form.get('k')` is only reported when the
  receiver was bound to a form in pass 1 — annotated `: FormGroup` / `: AbstractControl`,
  initialised from `new FormGroup(...)` / `fb.group(...)`, or built by a factory method that
  returns one of those. This is what keeps `params.get()`, `formData.get()` and `map.get()`
  out of the report (verified against a real workspace: 38 true positives, 0 false positives).
  The cost is that a form arriving through an unannotated intermediate — say
  `getForm().get('email')` — is missed.
- **Forms stored on a domain-model object are missed (cross-object access).** When a
  `FormGroup` lives as a property of a *data model* rather than the component —
  `this.selectedSection.SectionValidator.controls[i].updateValueAndValidity()` — the receiver
  chain (`this.selectedSection.SectionValidator`) cannot be proven to be a form without
  cross-file type resolution, so its usages are invisible. The SAME-object form of this
  (`this.sectionValidator.controls[i]...`, a `FormGroup`-typed field on the component) IS
  detected. Found in a 50-repo + enterprise corpus run, concentrated in one legacy
  (Angular 7) EMR app; it did not appear in any modern codebase. A name/structural heuristic
  (`*.SomethingValidator.controls[...]`) was considered and rejected: it would widen the
  false-positive surface across every codebase to serve one, against this tool's
  precision-first stance. Authoritative handling needs the `ts.Program` deep mode below.
- **Template-driven forms have no documented migration.** `ngModel` bindings are now
  flagged (`Template.ngModel`) but as OUT OF SCOPE: angular.dev documents no ngModel →
  Signal Forms path, so the tool refuses to invent one.

**M7 — template (`.html`) scanning (done).** A quote-aware token scanner (`detect-template.ts`)
now reports the Reactive Forms binding family (`formControlName`, `[formGroup]`,
`formGroupName`, `formArrayName`, `[formControl]`), the `<select multiple>` blocker, the
silent `minlength`/`maxlength` error-key rename, hardcoded native-attribute collisions
(NG8022), and template-driven `ngModel`. `Template.*` findings resolve to the
`templateBindings` recipe (plus focused recipes for arrays, the select blocker and ngModel),
all verified against the v22 docs. It is a token scan, not an Angular AST — it flags binding
sites and leaves structure to the agent, so the AOT build stays the real check. Templates
sort as "reference only" and migrate with their component.

## Beyond M7

- Optional `ts.Program`-backed "deep" mode for projects that supply a tsconfig path.
- Inline `template:` string scanning (currently only external `.html` is read).
- Recipe coverage for `FormRecord`, `AbstractControl` subclassing, and cross-field
  validators.
