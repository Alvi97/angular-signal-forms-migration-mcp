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
  receiver was bound to a form in pass 1 — annotated `: FormGroup` / `: AbstractControl`, or
  initialised from `new FormGroup(...)` / `fb.group(...)`. This is what keeps `params.get()`,
  `formData.get()` and `map.get()` out of the report (verified against a real workspace: 38
  true positives, 0 false positives). The cost is that a form arriving through an unannotated
  intermediate — say `getForm().get('email')` — is missed.
- **Template-driven forms are out of scope.** Files importing only `FormsModule` (`ngModel`)
  produce no findings. That is correct for this tool's Reactive-Forms remit, but such files do
  still need migrating; a workspace scan will under-report the total effort.
- **Templates are not parsed.** `[formGroup]`, `formControlName` and friends live in
  `.html` files, which this server does not read. The agent must update templates
  using the recipe guidance.

## Beyond M4

- Optional `ts.Program`-backed "deep" mode for projects that supply a tsconfig path.
- Template (`.html`) scanning for `formControlName` / `[formGroup]` bindings.
- Recipe coverage for `FormRecord`, `AbstractControl` subclassing, and cross-field
  validators.
