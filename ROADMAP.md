# ROADMAP

Milestones are defined in [SPEC.md](./SPEC.md). This file tracks what each milestone
deliberately **defers**, so nothing silently falls through the gap.

## M1 — shipped scope

`find_form_candidates` + `get_signalforms_recipe`, basic constructs only.

Detected: `FormControl`, `FormGroup`, `FormBuilder`, `FormBuilder.group`,
`FormBuilder.control`, `Validators.*`, custom `ValidatorFn`, `valueChanges`,
`statusChanges`.

### Deferred out of M1

| Item | Target | Note |
| --- | --- | --- |
| `FormArray` / `fb.array()` reported as its own construct | M2 | Currently used **only** as a classification guard: a group containing one is downgraded to `judgment`, but no `FormArray` finding is emitted. A codebase using `FormArray` will therefore under-report. |
| Dynamic / conditional `addControl` / `removeControl` detection | M2 | |
| Async validators (`AsyncValidatorFn`, `validateAsync`, `validateHttp`) | M2 | |
| `analyze_migration_complexity` tool | M2 | |
| `ControlValueAccessor` detection + guidance | M3 | |
| RxJS interop recipes for `valueChanges` pipelines | M3 | `valueChanges` is *detected* in M1 and classified `judgment`, but has no recipe yet. |
| `get_migration_report` tool | M4 | |

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
- **Templates are not parsed.** `[formGroup]`, `formControlName` and friends live in
  `.html` files, which this server does not read. The agent must update templates
  using the recipe guidance.

## Beyond M4

- Optional `ts.Program`-backed "deep" mode for projects that supply a tsconfig path.
- Template (`.html`) scanning for `formControlName` / `[formGroup]` bindings.
- Recipe coverage for `FormRecord`, `AbstractControl` subclassing, and cross-field
  validators.
