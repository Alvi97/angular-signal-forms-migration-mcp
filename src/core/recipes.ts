/**
 * ============================================================================
 * DOCS PROVENANCE — read before editing any recipe below.
 * ============================================================================
 *
 * Angular version targeted : 22 (current release). Signal Forms requires "v21 or higher".
 * Signal Forms entry point : '@angular/forms/signals'
 *                            (interop: '@angular/forms/signals/compat')
 * Stability                : NOT labelled experimental in v22. The v21 essentials page
 *                            carried an "IMPORTANT: Signal Forms are experimental" banner;
 *                            that banner is GONE in v22. The overview page instead hedges,
 *                            verbatim: "If you're working with an existing application that
 *                            uses reactive forms, or if you need production stability
 *                            guarantees, reactive forms remain a solid choice."
 *                            So: do not call it experimental, and do not call it stable.
 * Verified on              : 2026-07-21
 * Verified how             : official Angular CLI MCP server (`npx @angular/cli mcp`)
 *                            `search_documentation` with version: 22 — the tool reported
 *                            `searchedVersion: 22` on every query — cross-checked by
 *                            fetching the same pages on angular.dev.
 *
 * Doc URLs consulted (all v22 / current):
 *   https://angular.dev/essentials/signal-forms
 *   https://angular.dev/guide/forms/signals/overview
 *   https://angular.dev/guide/forms/signals/validation
 *   https://angular.dev/guide/forms/signals/field-state-management
 *   https://angular.dev/guide/forms/signals/async-operations
 *   https://angular.dev/guide/forms/signals/migration
 *
 * Names the docs settled that model memory gets WRONG:
 *   - The binding directive is `FormField` / `[formField]` (NOT `Control` / `[control]`,
 *     which appeared in pre-release v21 material).
 *   - The form-element directive is `FormRoot` / `[formRoot]`.
 *   - The schema callback receives a `SchemaPathTree`, conventionally named `path`.
 *
 * BEHAVIOUR THAT CHANGED BETWEEN v21 AND v22 — do not port recipes across versions blind:
 *   - `required()` and `false`. The v21 validation page defined "empty" as `null` or `''`
 *     only, which made `false` PASS required(). The v22 page adds, verbatim: "it treats
 *     false as missing (invalid), matching <input type="checkbox" required>". That flips
 *     `Validators.requiredTrue` from a judgment rewrite into a mechanical rename.
 *     (The v22 "empty" table still lists only null and '' — the prose note is more
 *     specific and is what the recipe below follows.)
 *
 * Per CLAUDE.md rule 2, every `after` snippet here is transcribed from the pages above.
 * Any snippet that could not be confirmed MUST carry
 * `"UNVERIFIED — confirm on angular.dev"` in its `caveats`.
 * If docs and memory conflict, docs win.
 * ============================================================================
 */
import type { Recipe, RecipeLookup } from './types.js';

/**
 * Attached to every recipe. v22 dropped v21's "experimental" banner but still stops short
 * of promising stability, and an agent must surface that before a bulk migration.
 */
const STABILITY =
  'STABILITY: verified against Angular v22 docs. v22 no longer labels Signal Forms ' +
  'experimental (v21 did), but angular.dev still advises that "if you need production ' +
  'stability guarantees, reactive forms remain a solid choice". Behaviour also changed ' +
  'between v21 and v22 — check your actual Angular version before applying this.';

/**
 * The single structural fact behind most of these recipes, repeated because agents
 * apply recipes one at a time and will otherwise miss it.
 */
const MODEL_FIRST =
  'Signal Forms has no standalone control objects. State lives in one model signal; ' +
  'form() derives a field tree from it. Migrate a whole form at once, not control by control.';

const IMPORT_FORMFIELD =
  "Add `FormField` to the component's `imports` array — `[formField]` is a directive, " +
  'not a built-in binding.';

/**
 * Verified before/after recipes, keyed by canonical construct name.
 *
 * Keys match the `construct` values emitted by `detectInSource`, so the output of
 * `find_form_candidates` can be fed straight into `get_signalforms_recipe`.
 */
const RECIPES: ReadonlyMap<string, Recipe> = new Map<string, Recipe>([
  [
    'FormControl',
    {
      construct: 'FormControl',
      description:
        'A FormControl becomes a property on the model signal. Validators move out of the ' +
        'constructor and into the schema function passed as form()’s second argument.',
      before: `import { FormControl, Validators } from '@angular/forms';

export class Profile {
  readonly email = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.email],
  });
}`,
      after: `// profile.ts
import { Component, signal } from '@angular/core';
import { form, FormField, email, required } from '@angular/forms/signals';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.html',
  imports: [FormField],
})
export class Profile {
  // 1. The value lives in a signal, not in a control object.
  readonly model = signal({ email: '' });

  // 2. form() returns a field tree mirroring the model's shape.
  readonly f = form(this.model, (path) => {
    required(path.email, { message: 'Email is required' });
    email(path.email, { message: 'Enter a valid email address' });
  });
}`,
      caveats: [
        STABILITY,
        MODEL_FIRST,
        IMPORT_FORMFIELD,
        'Template binding changes from `[formControl]="email"` to `[formField]="f.email"`.',
        'Read the value with `f.email().value()` and write it with `f.email().value.set(v)`; ' +
          'writing through the field also updates the model signal.',
        'The `nonNullable` option has no counterpart — the model signal’s TypeScript type ' +
          'is what decides whether a field can hold null.',
        'If the control depends on logic you cannot port yet (a third-party validator, an ' +
          'intricate RxJS pipeline), keep it and bridge it with `compatForm()` from ' +
          "'@angular/forms/signals/compat' rather than rewriting it.",
      ],
    },
  ],
  [
    'FormGroup',
    {
      construct: 'FormGroup',
      description:
        'A FormGroup becomes a plain nested object inside the model signal. Nesting in the ' +
        'model produces nesting in the field tree, reachable by dot notation.',
      before: `import { FormControl, FormGroup, Validators } from '@angular/forms';

export class Checkout {
  readonly form = new FormGroup({
    customerName: new FormControl('', Validators.required),
    address: new FormGroup({
      street: new FormControl('', Validators.required),
      city: new FormControl('', Validators.required),
    }),
  });
}`,
      after: `// checkout.ts
import { Component, signal } from '@angular/core';
import { form, FormField, required } from '@angular/forms/signals';

@Component({
  selector: 'app-checkout',
  templateUrl: './checkout.html',
  imports: [FormField],
})
export class Checkout {
  readonly model = signal({
    customerName: '',
    address: { street: '', city: '' },
  });

  readonly f = form(this.model, (path) => {
    required(path.customerName);
    required(path.address.street);
    required(path.address.city);
  });
}`,
      caveats: [
        STABILITY,
        MODEL_FIRST,
        IMPORT_FORMFIELD,
        'Bind nested fields directly: `[formField]="f.address.street"`. There is no ' +
          '`formGroupName` / `formControlName` indirection.',
        'State propagates upward: if `f.address.street().invalid()` is true then ' +
          '`f.address().invalid()` and `f().invalid()` are true as well.',
        'The root form is itself a field — `f().valid()` gives whole-form validity, which is ' +
          'what a submit button should bind to.',
        'Hidden, disabled and readonly fields are non-interactive and do NOT contribute to ' +
          'parent validity — a required-but-hidden field will not block submission.',
      ],
    },
  ],
  [
    'FormBuilder',
    {
      construct: 'FormBuilder',
      description:
        'FormBuilder has no Signal Forms counterpart and is deleted outright. Once its ' +
        'group()/control() calls become a model signal, the injection has no remaining purpose.',
      before: `import { Component, inject } from '@angular/core';
import { FormBuilder } from '@angular/forms';

export class Signup {
  private readonly fb = inject(FormBuilder);
  readonly form = this.fb.group({ email: [''] });
}`,
      after: `import { Component, signal } from '@angular/core';
import { form } from '@angular/forms/signals';

export class Signup {
  // The FormBuilder injection is removed entirely — nothing replaces it.
  readonly model = signal({ email: '' });
  readonly f = form(this.model);
}`,
      caveats: [
        STABILITY,
        MODEL_FIRST,
        'Delete the injection only after every `fb.group()` / `fb.control()` / `fb.array()` ' +
          'call in the class has been migrated, or the class will not compile.',
      ],
    },
  ],
  [
    'FormBuilder.group',
    {
      construct: 'FormBuilder.group',
      description:
        'fb.group({...}) becomes an object literal inside signal(...), plus a schema function ' +
        'holding the validators that were previously in each control’s array form.',
      before: `import { inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';

export class Signup {
  private readonly fb = inject(FormBuilder);

  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    age: [0, [Validators.min(18)]],
  });
}`,
      after: `import { Component, signal } from '@angular/core';
import { form, FormField, email, min, required } from '@angular/forms/signals';

@Component({
  selector: 'app-signup',
  templateUrl: './signup.html',
  imports: [FormField],
})
export class Signup {
  // Initial values stay in the model; validators move into the schema.
  readonly model = signal({ email: '', age: 0 });

  readonly f = form(this.model, (path) => {
    required(path.email, { message: 'Email is required' });
    email(path.email);
    min(path.age, 18, { message: 'You must be at least 18 years old' });
  });
}`,
      caveats: [
        STABILITY,
        MODEL_FIRST,
        IMPORT_FORMFIELD,
        'The `[value, validators]` array form splits in two: the value goes into the model ' +
          'signal, the validators become rules in the schema function.',
        'A group containing `fb.array(...)` is NOT covered here — array migration lands in M2.',
      ],
    },
  ],
  [
    'FormBuilder.control',
    {
      construct: 'FormBuilder.control',
      description:
        'fb.control(value, validators) becomes one property on the model signal plus the ' +
        'matching rules in the schema — identical in shape to the FormControl recipe.',
      before: `import { inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';

export class Search {
  private readonly fb = inject(FormBuilder);
  readonly query = this.fb.control('', [Validators.required]);
}`,
      after: `import { Component, signal } from '@angular/core';
import { form, FormField, required } from '@angular/forms/signals';

@Component({
  selector: 'app-search',
  templateUrl: './search.html',
  imports: [FormField],
})
export class Search {
  readonly model = signal({ query: '' });

  readonly f = form(this.model, (path) => {
    required(path.query);
  });
}`,
      caveats: [
        STABILITY,
        MODEL_FIRST,
        IMPORT_FORMFIELD,
        'A control that existed on its own now needs a model object to live in. Prefer folding ' +
          'it into the surrounding form’s model over creating a one-property model.',
      ],
    },
  ],
  [
    'Validators.required',
    {
      construct: 'Validators.required',
      description:
        'Validators.required becomes the required() rule, applied to a path inside the schema ' +
        'function rather than attached to a control.',
      before: `import { FormControl, Validators } from '@angular/forms';

readonly name = new FormControl('', [Validators.required]);`,
      after: `import { form, required } from '@angular/forms/signals';

readonly f = form(this.model, (path) => {
  required(path.name, { message: 'Name is required' });
});`,
      caveats: [
        STABILITY,
        'v22 emptiness rules: `null` and the empty string are missing (invalid); `false` is ' +
          'ALSO missing, matching `<input type="checkbox" required>`. This differs from v21, ' +
          'where `false` passed. See the Validators.requiredTrue recipe.',
        'required() PASSES for an empty array. Use `minLength(path.items, 1)` to require at ' +
          'least one element.',
        'For a conditionally required field use the `when` option instead of swapping validators: ' +
          '`required(path.promoCode, { when: ({ valueOf }) => valueOf(path.applyDiscount) })`.',
        'The `message` option is optional; without it the error carries only `kind: "required"` ' +
          'and your template must map kinds to text itself.',
      ],
    },
  ],
  [
    'Validators.requiredTrue',
    {
      construct: 'Validators.requiredTrue',
      description:
        'On Angular v22, Validators.requiredTrue becomes plain required(). The v22 docs state ' +
        'that required() "treats false as missing (invalid), matching <input type=checkbox ' +
        'required>", which is exactly requiredTrue’s semantics. On v21 this was NOT true — see ' +
        'the caveats.',
      before: `import { FormControl, Validators } from '@angular/forms';

readonly acceptedTerms = new FormControl(false, [Validators.requiredTrue]);`,
      after: `import { form, required } from '@angular/forms/signals';

readonly model = signal({ acceptedTerms: false });

readonly f = form(this.model, (path) => {
  // v22: required() reports \`false\` as missing, so this covers requiredTrue.
  required(path.acceptedTerms, { message: 'You must accept the terms' });
});`,
      caveats: [
        STABILITY,
        'VERSION-SENSITIVE. This recipe is correct for v22. The v21 docs defined "empty" as ' +
          'null or the empty string only, so on v21 required() PASSES for `false` and this ' +
          'substitution would silently accept an unchecked box. Confirm the project is on v22+ ' +
          'before applying it.',
        'If you are on v21, or want to stay version-independent, express the check explicitly ' +
          'instead: `validate(path.acceptedTerms, ({ value }) => value() ? null : ' +
          "{ kind: 'requiredTrue', message: '...' })`.",
        'The v22 validation page is internally inconsistent here: its "empty" table still lists ' +
          'only null and the empty string, while the prose note below it says `false` is ' +
          'missing. This recipe follows the prose note, which is the more specific statement. ' +
          'Worth confirming against the behaviour of your installed @angular/forms.',
      ],
    },
  ],
  [
    'Validators.email',
    {
      construct: 'Validators.email',
      description: 'Validators.email becomes the email() rule applied to a path in the schema.',
      before: `import { FormControl, Validators } from '@angular/forms';

readonly email = new FormControl('', [Validators.email]);`,
      after: `import { email, form } from '@angular/forms/signals';

readonly f = form(this.model, (path) => {
  email(path.email, { message: 'Please enter a valid email address' });
});`,
      caveats: [
        STABILITY,
        'email() checks format only. Pair it with required() if the field is also mandatory — ' +
          'both rules run, and both can produce errors at once.',
        'Validation does not short-circuit: every rule on a field runs on every change, so ' +
          '`errors()` can hold more than one entry.',
      ],
    },
  ],
  [
    'Validators.min',
    {
      construct: 'Validators.min',
      description:
        'Validators.min(n) becomes min(path, n). The bound may also be a callback, which makes ' +
        'the constraint reactive.',
      before: `import { FormControl, Validators } from '@angular/forms';

readonly age = new FormControl(0, [Validators.min(18)]);`,
      after: `import { form, min } from '@angular/forms/signals';

readonly f = form(this.model, (path) => {
  min(path.age, 18, { message: 'You must be at least 18 years old' });

  // A callback bound re-evaluates whenever its signals change:
  // min(path.participants, () => this.minimumRequired(), { message: 'Not enough participants' });
});`,
      caveats: [
        STABILITY,
        'min() is for numeric values. For string or array length use minLength().',
      ],
    },
  ],
  [
    'Validators.max',
    {
      construct: 'Validators.max',
      description: 'Validators.max(n) becomes max(path, n), mirroring min().',
      before: `import { FormControl, Validators } from '@angular/forms';

readonly rating = new FormControl(0, [Validators.max(5)]);`,
      after: `import { form, max } from '@angular/forms/signals';

readonly f = form(this.model, (path) => {
  max(path.rating, 5, { message: 'Rating cannot exceed 5' });
});`,
      caveats: [
        STABILITY,
        'max() is for numeric values. For string or array length use maxLength().',
      ],
    },
  ],
  [
    'Validators.minLength',
    {
      construct: 'Validators.minLength',
      description:
        'Validators.minLength(n) becomes minLength(path, n), which measures characters for ' +
        'strings and elements for arrays.',
      before: `import { FormControl, Validators } from '@angular/forms';

readonly password = new FormControl('', [Validators.minLength(8)]);`,
      after: `import { form, minLength } from '@angular/forms/signals';

readonly f = form(this.model, (path) => {
  minLength(path.password, 8, { message: 'Password must be at least 8 characters' });
});`,
      caveats: [
        STABILITY,
        'minLength() also works on arrays, which makes `minLength(path.items, 1)` the correct ' +
          'way to demand a non-empty list — required() passes for an empty array.',
      ],
    },
  ],
  [
    'Validators.maxLength',
    {
      construct: 'Validators.maxLength',
      description: 'Validators.maxLength(n) becomes maxLength(path, n).',
      before: `import { FormControl, Validators } from '@angular/forms';

readonly bio = new FormControl('', [Validators.maxLength(500)]);`,
      after: `import { form, maxLength } from '@angular/forms/signals';

readonly f = form(this.model, (path) => {
  maxLength(path.bio, 500, { message: 'Bio cannot exceed 500 characters' });
});`,
      caveats: [STABILITY, 'Counts characters for strings and elements for arrays.'],
    },
  ],
  [
    'Validators.pattern',
    {
      construct: 'Validators.pattern',
      description:
        'Validators.pattern(re) becomes pattern(path, re), taking the regular expression directly.',
      before: `import { FormControl, Validators } from '@angular/forms';

readonly phone = new FormControl('', [Validators.pattern(/^\\d{3}-\\d{3}-\\d{4}$/)]);`,
      after: `import { form, pattern } from '@angular/forms/signals';

readonly f = form(this.model, (path) => {
  pattern(path.phone, /^\\d{3}-\\d{3}-\\d{4}$/, {
    message: 'Phone must be in format: 555-123-4567',
  });
});`,
      caveats: [
        STABILITY,
        'Reactive Forms accepted a string pattern and wrapped it in `^...$`. Pass a RegExp here ' +
          'and anchor it yourself, or the match semantics will differ.',
        'pattern() is the one built-in rule that does NOT mirror to a native attribute. ' +
          'required(), min(), max(), minLength() and maxLength() do set their native ' +
          'equivalents on supported elements; pattern() leaves `pattern` unset.',
      ],
    },
  ],
  [
    'Validators.compose',
    {
      construct: 'Validators.compose',
      description:
        'Validators.compose has no counterpart and is not needed: a schema function simply calls ' +
        'several rules against the same path.',
      before: `import { FormControl, Validators } from '@angular/forms';

readonly email = new FormControl('', Validators.compose([
  Validators.required,
  Validators.email,
  Validators.maxLength(100),
]));`,
      after: `import { email, form, maxLength, required } from '@angular/forms/signals';

readonly f = form(this.model, (path) => {
  // Listing the rules IS the composition — there is nothing to wrap.
  required(path.email);
  email(path.email);
  maxLength(path.email, 100);
});`,
      caveats: [
        STABILITY,
        'Every rule runs on every change and each can contribute an error, so `errors()` may ' +
          'hold several entries at once. Reactive Forms merged them into one error object.',
      ],
    },
  ],
  [
    'AbstractControl.get',
    {
      construct: 'AbstractControl.get',
      description:
        'form.get("email") becomes dot notation on the field tree: f.email. The field tree ' +
        'mirrors the model’s shape, so nested groups are reached by chaining, and the result ' +
        'is typed instead of being a possibly-null AbstractControl.',
      before: `import { FormGroup } from '@angular/forms';

readonly profileForm: FormGroup;

get firstName() {
  return this.profileForm.get('firstName') as FormControl;
}

get street() {
  return this.profileForm.get('address.street');
}`,
      after: `import { form } from '@angular/forms/signals';

readonly model = signal({
  firstName: '',
  address: { street: '' },
});
readonly f = form(this.model);

// No accessor needed — bind the field directly in the template:
//   <input [formField]="f.firstName" />
//   <input [formField]="f.address.street" />

// In code, reach fields by dot notation and read state by calling them:
//   this.f.firstName().value()
//   this.f.address.street().invalid()`,
      caveats: [
        STABILITY,
        MODEL_FIRST,
        'The dotted string path `get("address.street")` becomes real property access: ' +
          '`f.address.street`. There is no string-path lookup on the field tree.',
        'The `as FormControl` cast that usually follows `.get()` is deleted — the field tree ' +
          'is typed from the model, so no assertion is needed.',
        'Getters that existed only to feed the template are usually removable: bind ' +
          '`[formField]="f.firstName"` instead of exposing an accessor.',
        'A COMPUTED key (`form.get(someVariable)`) has no mechanical rewrite. The field tree ' +
          'is a typed object, not a string-keyed map, so the surrounding code must be ' +
          'redesigned — that is why the detector classifies it as judgment.',
      ],
    },
  ],
  [
    'customValidator',
    {
      construct: 'customValidator',
      description:
        'A custom ValidatorFn is rewritten with validate(). The callback receives a FieldContext ' +
        '({ value, valueOf, state, field, ... }) rather than an AbstractControl, and returns an ' +
        'error object or null.',
      before: `import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export function httpsUrl(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null =>
    control.value?.startsWith('https://') ? null : { https: true };
}

readonly website = new FormControl('', [httpsUrl()]);`,
      after: `import { form, validate, type SchemaPath } from '@angular/forms/signals';

// A reusable rule is a function that calls validate() — it is used exactly
// like a built-in rule inside the schema.
function httpsUrl(path: SchemaPath<string>, options?: { message?: string }): void {
  validate(path, ({ value }) =>
    value().startsWith('https://')
      ? null
      : { kind: 'https', message: options?.message ?? 'URL must start with https://' },
  );
}

readonly f = form(this.model, (path) => {
  httpsUrl(path.website);

  // Cross-field validation reads other fields through valueOf():
  validate(path.confirmPassword, ({ value, valueOf }) =>
    value() === valueOf(path.password)
      ? null
      : { kind: 'passwordMismatch', message: 'Passwords do not match' },
  );
});`,
      caveats: [
        STABILITY,
        'The error shape changes from `{ [key: string]: unknown }` to `{ kind, message? }`. ' +
          'Templates reading `errors.required` must move to `errors()` and match on `kind`.',
        'Return `null` (or `undefined`) for valid. Returning a falsy object still counts as ' +
          'an error.',
        'Cross-field rules attach to a path and pull other values with `valueOf(path.other)`; ' +
          'they re-run reactively when any field they read changes.',
        'To validate a whole subtree, or to report an error against a DIFFERENT field than the ' +
          'one the rule is attached to, use `validateTree()` and set the error’s `fieldTree`.',
        'An ASYNC validator is not covered by this recipe — `validateHttp()` / `validateAsync()` ' +
          'land in M2. Do not force an AsyncValidatorFn through validate().',
      ],
    },
  ],
]);

/**
 * Spellings a caller might reasonably use, mapped to a canonical RECIPES key.
 * The detector emits canonical keys; humans and agents do not.
 */
const ALIASES: ReadonlyMap<string, string> = new Map([
  ['formcontrol', 'FormControl'],
  ['formgroup', 'FormGroup'],
  ['formbuilder', 'FormBuilder'],
  ['fb.group', 'FormBuilder.group'],
  ['fb.control', 'FormBuilder.control'],
  ['formbuilder.group', 'FormBuilder.group'],
  ['formbuilder.control', 'FormBuilder.control'],
  ['required', 'Validators.required'],
  ['requiredtrue', 'Validators.requiredTrue'],
  ['email', 'Validators.email'],
  ['min', 'Validators.min'],
  ['max', 'Validators.max'],
  ['minlength', 'Validators.minLength'],
  ['maxlength', 'Validators.maxLength'],
  ['pattern', 'Validators.pattern'],
  ['compose', 'Validators.compose'],
  ['get', 'AbstractControl.get'],
  ['.get', 'AbstractControl.get'],
  ['abstractcontrol.get', 'AbstractControl.get'],
  ['formgroup.get', 'AbstractControl.get'],
  ['customvalidator', 'customValidator'],
  ['validatorfn', 'customValidator'],
  ['custom validator', 'customValidator'],
]);

/**
 * Folds the spellings that mean the same construct: case, surrounding whitespace,
 * and a trailing call form (`Validators.required()` -> `validators.required`).
 */
function normalise(construct: string): string {
  return construct
    .trim()
    .replace(/\(\s*\)$/, '')
    .trim()
    .toLowerCase();
}

/** Canonical construct names this server has a recipe for, sorted for stable output. */
export function availableConstructs(): readonly string[] {
  return [...RECIPES.keys()].sort((a, b) => a.localeCompare(b));
}

/**
 * Looks up a migration recipe.
 *
 * Never throws. An unknown construct is a value — `{ found: false }` carrying the
 * list of valid keys — so the calling agent can correct itself and retry.
 */
export function getSignalFormsRecipe(construct: string): RecipeLookup {
  const normalised = normalise(construct);

  const canonical =
    ALIASES.get(normalised) ?? [...RECIPES.keys()].find((key) => normalise(key) === normalised);

  const recipe = canonical === undefined ? undefined : RECIPES.get(canonical);
  if (recipe === undefined) {
    return { found: false, construct, availableConstructs: availableConstructs() };
  }

  return { ...recipe, found: true };
}
