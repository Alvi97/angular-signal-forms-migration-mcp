/**
 * Docs provenance. Read before editing any recipe.
 *
 * Target: Angular 22 (Signal Forms needs v21+). Entry point `@angular/forms/signals`
 * (interop `@angular/forms/signals/compat`). Not labelled experimental in v22, but the
 * overview still steers production-stability needs to reactive forms, so call it neither
 * experimental nor stable. Verified 2026-07-21 via the Angular CLI MCP (searchedVersion 22),
 * cross-checked on angular.dev.
 *
 * Names memory gets wrong: the binding directive is `FormField` / `[formField]` (not
 * `Control` / `[control]`); the form directive is `FormRoot` / `[formRoot]`; the schema
 * callback receives a `SchemaPathTree`, named `path`.
 *
 * Per CLAUDE.md rule 2, every `after` snippet is transcribed from the docs; anything
 * unconfirmed carries an `UNVERIFIED` caveat. Docs win over memory.
 */
import type { Recipe, RecipeLookup } from './types.js';
import { VERIFIED_ANGULAR_VERSION } from './version.js';

/** The date the docs below were retrieved. Bump whenever a recipe is re-verified. */
const RETRIEVED_ISO = '2026-07-21';

/** Every angular.dev page these recipes were derived from, named so sources read clearly. */
export const DOCS = {
  essentials: 'https://angular.dev/essentials/signal-forms',
  overview: 'https://angular.dev/guide/forms/signals/overview',
  models: 'https://angular.dev/guide/forms/signals/models',
  modelDesign: 'https://angular.dev/guide/forms/signals/model-design',
  testing: 'https://angular.dev/guide/forms/signals/testing',
  crossField: 'https://angular.dev/guide/forms/signals/cross-field-logic',
  validation: 'https://angular.dev/guide/forms/signals/validation',
  fieldState: 'https://angular.dev/guide/forms/signals/field-state-management',
  formLogic: 'https://angular.dev/guide/forms/signals/form-logic',
  asyncOperations: 'https://angular.dev/guide/forms/signals/async-operations',
  dynamicJson: 'https://angular.dev/guide/forms/signals/dynamic-forms-with-json',
  customControls: 'https://angular.dev/guide/forms/signals/custom-controls',
  migration: 'https://angular.dev/guide/forms/signals/migration',
  formSubmission: 'https://angular.dev/guide/forms/signals/form-submission',
  fieldStateApi: 'https://angular.dev/api/forms/signals/FieldState',
  formFieldApi: 'https://angular.dev/api/forms/signals/FormField',
  formRootApi: 'https://angular.dev/api/forms/signals/FormRoot',
  validatorsApi: 'https://angular.dev/api/forms/Validators',
  templateExpressions: 'https://angular.dev/guide/templates/expression-syntax',
  rxjsInterop: 'https://angular.dev/ecosystem/rxjs-interop',
  schemas: 'https://angular.dev/guide/forms/signals/schemas',
  formBuilderApi: 'https://angular.dev/api/forms/FormBuilder',
} as const;

/** Pages that establish the core model/form()/schema shape every recipe rests on. */
const CORE_SOURCES: readonly string[] = [DOCS.essentials, DOCS.validation];

/** A recipe as authored; `withProvenance` fills in the version, date and sources. */
type RecipeDraft = Omit<Recipe, 'provenance'> & {
  /** Doc URLs this specific recipe came from. Defaults to CORE_SOURCES. */
  readonly sources?: readonly string[];
  /** Set when behaviour differs across Angular versions; caveats must explain how. */
  readonly versionSensitive?: boolean;
};

/** Pages a shared caveat quotes from, added to a recipe's sources when it carries the caveat. */
const SHARED_CAVEAT_SOURCES: readonly (readonly [string, string])[] = [
  ['STABILITY:', DOCS.overview],
  ['MODEL SHAPE', DOCS.models],
  ['INCREMENTAL IS SUPPORTED', DOCS.migration],
];

function withProvenance(draft: RecipeDraft): Recipe {
  const { sources, versionSensitive, ...recipe } = draft;
  const cited = new Set(sources ?? CORE_SOURCES);
  for (const [marker, url] of SHARED_CAVEAT_SOURCES) {
    if (recipe.caveats.some((caveat) => caveat.includes(marker))) cited.add(url);
  }

  return {
    ...recipe,
    provenance: {
      verifiedAgainstVersion: VERIFIED_ANGULAR_VERSION,
      retrievedISO: RETRIEVED_ISO,
      sources: [...cited],
      versionSensitive: versionSensitive ?? false,
    },
  };
}

/** Stability caveat on every recipe: v22 dropped the experimental banner but promises nothing. */
const STABILITY =
  'STABILITY: verified against Angular v22 docs. v22 no longer labels Signal Forms ' +
  'experimental (v21 carried "Signal Forms are experimental. The API may change in future ' +
  'releases."), but the overview still advises that "if you need production stability ' +
  'guarantees, reactive forms remain a solid choice". Some SIGNATURES changed between v21 ' +
  'and v22 — `disabled(path, cb)` became `disabled(path, { when: cb })` — so check your ' +
  'actual Angular version. Recipes flagged VERSION-SENSITIVE name the specific difference.';

/**
 * The `error.kind` string a built-in rule emits. Each is compile-pinned in
 * verify/src/submission-and-error-kinds.ts and published on the per-class API page; two
 * (minLength/maxLength) are renamed from the Reactive keys, and a stale key fails silently.
 */
function errorKind(kind: string, errorClass: string, reactiveKey = kind): string {
  const rename =
    reactiveKey === kind
      ? 'Same spelling as the Reactive Forms error key.'
      : `RENAMED — Reactive Forms reported \`{ ${reactiveKey}: ... }\`. A template still ` +
        `matching '${reactiveKey}' compiles and silently never fires. (Angular publishes no ` +
        'Reactive-to-Signal error-key table; this pairing is derived, though both halves ' +
        'are documented separately.)';
  return (
    `ERROR KIND: reports \`{ kind: '${kind}' }\` — documented at ` +
    `https://angular.dev/api/forms/signals/${errorClass}. A template that read ` +
    `\`control.errors?.['${reactiveKey}']\` can use \`field().getError('${kind}')\`, which ` +
    'avoids a computed() index and the `errors().some(...)` that templates cannot express ' +
    '(arrow functions are banned in template expressions). INFERRED, not documented: no ' +
    'Angular guide shows getError() in a template — its API page scopes the reactivity ' +
    'claim to "a reactive context (e.g. computed or effect)". Every guide example iterates ' +
    `\`errors()\` instead. ${rename}`
  );
}

/**
 * The five rules that write their own native HTML attribute (required/min/max/minLength/
 * maxLength; pattern() excepted). The mirroring is documented; the NG8022 consequence is not.
 */
function nativeAttribute(attribute: string): string {
  return (
    `NATIVE ATTRIBUTE: on a bound native element this rule sets \`${attribute}\` itself. ` +
    'Angular documents the mirroring (required/min/max/minlength/maxlength; pattern() is the ' +
    'documented exception) but NOT what happens if you also write the attribute by hand. ' +
    `UNVERIFIED — observed in a real v22 AOT build, not on angular.dev: a literal ` +
    `\`${attribute}="..."\` left on the same element fails the build with NG8022, "Setting ` +
    `the '${attribute}' attribute is not allowed on nodes using the '[formField]' directive". ` +
    'There is no angular.dev/errors/NG8022 page to cite; the message was read out of ' +
    '@angular/compiler-cli 22.0.7 (FORM_FIELD_UNSUPPORTED_BINDING = 8022). Delete the ' +
    'hand-written attribute ONLY IF a matching schema rule exists or you add one — the rule ' +
    'emits the attribute, but if the attribute was the ONLY statement of the constraint ' +
    'then deleting it drops the validation silently. The template cannot tell which case ' +
    'you are in; check the component. VERSION-SENSITIVE ' +
    "wording: v21's compiler names the directive '[field]' in the same message, because the " +
    'directive was renamed to [formField] in v22.'
  );
}

/**
 * The single structural fact behind most of these recipes, repeated because agents
 * apply recipes one at a time and will otherwise miss it.
 */
/**
 * What may and may not go in a model signal. All four rules fail quietly. Compiled in
 * verify/src/model-and-context.ts.
 */
const MODEL_SHAPE =
  "MODEL SHAPE — four documented rules, all of which fail SILENTLY. (1) Use `''`, not " +
  '`null`, for text fields: "native text controls like <input type=text> and <textarea> ' +
  "don't support null, use '' to represent an empty value\". `new FormControl()` and " +
  '`fb.control(null)` both give you `null`, so the literal translation breaks the input. ' +
  '(2) NO optional or undefined properties: "fields set to `undefined` are excluded from ' +
  'the field tree", so reusing a DTO with `email?: string` drops the field and every rule ' +
  'targeting it, with no error. Give every field an initial value. (3) NO class instances, ' +
  'Map or Set in the structure — "not supported in the structural layer, even though ' +
  'TypeScript will accept them"; a class instance "loses its prototype on the first write". ' +
  '(4) Frozen or non-extensible objects inside arrays THROW, because Signal Forms assigns a ' +
  'tracking symbol to preserve item identity — relevant to any codebase using Object.freeze ' +
  'or NgRx strict immutability.';

const MODEL_FIRST =
  'MODEL-FIRST: state lives in one model signal and form() derives a field tree from it, so ' +
  'a plain `form()` migration converts a whole form at once rather than one control at a ' +
  'time. That is a property of `form()`, NOT a limit of Signal Forms — see INCREMENTAL below ' +
  'before committing to a big-bang rewrite.';

/** Incremental migration is documented and supported; both directions compile in verify/. */
const INCREMENTAL =
  'INCREMENTAL IS SUPPORTED, and is usually the safer plan for a large form. Bottom-up: ' +
  '`new SignalFormControl(value, schemaFn)` from `@angular/forms/signals/compat` IS a ' +
  'standalone signal-forms control, and it slots straight into an existing FormGroup — the ' +
  'migration guide describes this as migrating "leaf nodes of a form to Signals while ' +
  'keeping the parent FormGroup structure", with values synchronised bi-directionally. ' +
  'Top-down: `compatForm(model, schema)` reads a model whose LEAVES are reactive controls ' +
  'as a field tree (`f.city().value()` yields the value, not the FormControl). Reach for ' +
  'these when a form is too big, or too load-bearing, to convert in one change.';

const IMPORT_FORMFIELD =
  "Add `FormField` to the component's `imports` array — `[formField]` is a directive, " +
  'not a built-in binding.';

/** Verified recipes, keyed by the canonical construct names `detectInSource` emits. */
const RECIPE_DRAFTS: ReadonlyArray<readonly [string, RecipeDraft]> = [
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
        MODEL_SHAPE,
        INCREMENTAL,
        IMPORT_FORMFIELD,
        'Template binding changes from `[formControl]="email"` to `[formField]="f.email"`.',
        'BLOCKER TO CHECK BEFORE YOU START: "multiple select (`<select multiple>`) is not ' +
          'supported by the `[formField]` directive at this time". Reactive Forms handles it ' +
          'fine, so this is a control that cannot complete the migration — find them first ' +
          '(`grep -rn "select multiple\\|<select[^>]*multiple" --include=*.html`) and decide ' +
          'whether to keep those forms on Reactive Forms or write a custom ' +
          'FormValueControl. Discovering it halfway through is much worse.',
        'Some conversions the directive now does for you, so delete the workarounds rather ' +
          'than porting them: number inputs convert between string and number themselves ' +
          '(drop the `+value` / `parseFloat` / `map(Number)` plumbing), and radio buttons ' +
          'sharing a `[formField]` get a matching `name` bound automatically.',
        'Read the value with `f.email().value()` and write it with `f.email().value.set(v)`; ' +
          'writing through the field also updates the model signal.',
        'The `nonNullable` option has no counterpart — the model signal’s TypeScript type ' +
          'is what decides whether a field can hold null.',
        'If the control depends on logic you cannot port yet (a third-party validator, an ' +
          'intricate RxJS pipeline), keep it and bridge it with `compatForm()` from ' +
          "'@angular/forms/signals/compat' rather than rewriting it.",
      ],
      sources: [DOCS.essentials, DOCS.validation, DOCS.migration, DOCS.models],
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
        MODEL_SHAPE,
        INCREMENTAL,
        IMPORT_FORMFIELD,
        'Bind nested fields directly: `[formField]="f.address.street"`. There is no ' +
          '`formGroupName` / `formControlName` indirection.',
        'For a group nesting an ARRAY, see the `FormArray` recipe — per-item rules go ' +
          'through applyEach(), and the nested shapes are worked through there.',
        'State propagates upward: if `f.address.street().invalid()` is true then ' +
          '`f.address().invalid()` and `f().invalid()` are true as well.',
        'The root form is itself a field — `f().valid()` gives whole-form validity, which is ' +
          'what a submit button should bind to.',
        'Hidden, disabled and readonly fields are non-interactive and do NOT contribute to ' +
          'parent validity — a required-but-hidden field will not block submission.',
      ],
      sources: [DOCS.essentials, DOCS.models, DOCS.fieldState],
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
        MODEL_SHAPE,
        INCREMENTAL,
        'INFERRED, not documented: delete the injection only after every `fb.group()` / ' +
          '`fb.control()` / `fb.array()` call in the class is migrated, or it will not ' +
          'compile. FormBuilder is not mentioned anywhere in the v22 Signal Forms guides — ' +
          'this follows from TypeScript, not from Angular guidance.',
      ],
      sources: [DOCS.essentials, DOCS.overview],
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
        MODEL_SHAPE,
        INCREMENTAL,
        IMPORT_FORMFIELD,
        'The `[value, validators]` array form splits in two: the value goes into the model ' +
          'signal, the validators become rules in the schema function.',
        'A group that NESTS another group or an array is judgment, not a rename. See the ' +
          '`FormArray` recipe for the composed shapes (group-inside-array, array-inside-group, ' +
          'array-inside-array) and for how to update a nested array immutably.',
      ],
      sources: [DOCS.essentials, DOCS.validation, DOCS.models],
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
        MODEL_SHAPE,
        INCREMENTAL,
        IMPORT_FORMFIELD,
        'A control that existed on its own now needs a model object to live in. Prefer folding ' +
          'it into the surrounding form’s model over creating a one-property model.',
      ],
      sources: [DOCS.essentials, DOCS.validation],
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
        errorKind('required', 'RequiredValidationError'),
        nativeAttribute('required'),
        'EMPTINESS: `null`, `undefined` and the empty string are missing (invalid), and ' +
          '`false` is ALSO missing, matching `<input type="checkbox" required>`. NaN counts ' +
          'as missing for number fields. This is NOT version-sensitive: `isEmpty` is ' +
          'byte-identical in @angular/forms 21.0.0 and 22.0.7 (both test `value === false`). ' +
          'Only the docs differ — v21 simply omitted the sentence about `false`.',
        'required() PASSES for an empty array. Use `minLength(path.items, 1)` to require at ' +
          'least one element.',
        'For a conditionally required field use the `when` option instead of swapping validators: ' +
          '`required(path.promoCode, { when: ({ valueOf }) => valueOf(path.applyDiscount) })`.',
        'The `message` option is optional; without it the error carries only `kind: "required"` ' +
          'and your template must map kinds to text itself.',
      ],
      sources: [DOCS.validation, DOCS.formLogic],
    },
  ],
  [
    'Validators.requiredTrue',
    {
      construct: 'Validators.requiredTrue',
      description:
        'Validators.requiredTrue becomes plain required(). The v22 docs state that required() ' +
        '"treats false as missing (invalid), matching <input type=checkbox required>", which ' +
        'is exactly requiredTrue’s semantics — and the same is true on v21, whose docs merely ' +
        'did not say so.',
      before: `import { FormControl, Validators } from '@angular/forms';

readonly acceptedTerms = new FormControl(false, [Validators.requiredTrue]);`,
      after: `import { form, required } from '@angular/forms/signals';

readonly model = signal({ acceptedTerms: false });

readonly f = form(this.model, (path) => {
  // required() reports \`false\` as missing, so this covers requiredTrue.
  required(path.acceptedTerms, { message: 'You must accept the terms' });
});`,
      caveats: [
        STABILITY,
        // Reactive requiredTrue already reported `{ required: true }`, so this is NOT a rename.
        errorKind('required', 'RequiredValidationError'),
        'THE ERROR KEY DOES NOT CHANGE. Reactive `Validators.requiredTrue` already reported ' +
          '`{ required: true }` — its API page says the error map "contains the required ' +
          'property set to true" — and Signal Forms reports `kind: "required"`. So a template ' +
          "matching 'required' keeps working. There was never a 'requiredTrue' error key.",
        'NOT version-sensitive, despite appearances. `isEmpty` is byte-identical in ' +
          '@angular/forms 21.0.0 and 22.0.7 and both test `value === false`, so this ' +
          'substitution is safe on v21 too. Only the v22 DOCS added the sentence saying so; ' +
          'the v21 doc gap was a documentation omission, not different behaviour.',
        'The v22 validation page is internally inconsistent here: its "empty" table still lists ' +
          'only null and the empty string, while the prose note below it says `false` is ' +
          'missing. This recipe follows the prose note, which the shipped source confirms.',
      ],
      sources: [DOCS.validation, DOCS.validatorsApi],
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
        errorKind('email', 'EmailValidationError'),
        'email() checks format only. Pair it with required() if the field is also mandatory — ' +
          'both rules run, and both can produce errors at once.',
        'Validation does not short-circuit: every rule on a field runs on every change, so ' +
          '`errors()` can hold more than one entry.',
      ],
      sources: [DOCS.validation],
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
        errorKind('min', 'MinValidationError'),
        nativeAttribute('min'),
        'min() is for numeric values — its API page says it "can only be called on number ' +
          'paths". For string or array length use minLength(); for a DATE bound use ' +
          'minDate(), which reports a DIFFERENT kind (`minDate`, not `min`). A Reactive ' +
          'Validators.min on a date field therefore does not map to min() at all.',
      ],
      sources: [DOCS.validation, DOCS.formLogic],
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
        errorKind('max', 'MaxValidationError'),
        nativeAttribute('max'),
        'max() is for numeric values only. For string or array length use maxLength(); for a ' +
          'DATE bound use maxDate(), which reports kind `maxDate` rather than `max`.',
      ],
      sources: [DOCS.validation, DOCS.formLogic],
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
        errorKind('minLength', 'MinLengthValidationError', 'minlength'),
        nativeAttribute('minlength'),
        'minLength() also works on arrays, which makes `minLength(path.items, 1)` the correct ' +
          'way to demand a non-empty list — required() passes for an empty array.',
      ],
      sources: [DOCS.validation, DOCS.formLogic],
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
      caveats: [
        STABILITY,
        errorKind('maxLength', 'MaxLengthValidationError', 'maxlength'),
        nativeAttribute('maxlength'),
        'Counts characters for strings and elements for arrays.',
      ],
      sources: [DOCS.validation, DOCS.formLogic],
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
        errorKind('pattern', 'PatternValidationError'),
        'Reactive Forms accepted a string pattern and wrapped it in `^...$`. Pass a RegExp here ' +
          'and anchor it yourself, or the match semantics will differ.',
        'pattern() is the one built-in rule that does NOT mirror to a native attribute. ' +
          'required(), min(), max(), minLength() and maxLength() do set their native ' +
          'equivalents on supported elements; pattern() leaves `pattern` unset.',
      ],
      sources: [DOCS.validation, DOCS.formLogic],
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
      sources: [DOCS.validation],
    },
  ],
  [
    'FormArray',
    {
      construct: 'FormArray',
      description:
        'A FormArray becomes a plain array inside the model signal. Per-item validation is ' +
        'applied with applyEach(), and items are added or removed by updating the model ' +
        'signal — there is no array control object to push to.',
      before: `import { FormArray, FormControl, FormGroup, Validators } from '@angular/forms';

export class Order {
  readonly form = new FormGroup({
    title: new FormControl('', Validators.required),
    items: new FormArray([
      new FormGroup({
        name: new FormControl('', Validators.required),
        quantity: new FormControl(1, Validators.min(1)),
      }),
    ]),
  });

  addItem() {
    this.form.controls.items.push(
      new FormGroup({ name: new FormControl(''), quantity: new FormControl(1) }),
    );
  }

  removeItem(index: number) {
    this.form.controls.items.removeAt(index);
  }
}`,
      after: `// order.ts
import { Component, signal } from '@angular/core';
import { applyEach, form, FormField, min, required } from '@angular/forms/signals';
import type { SchemaPathTree } from '@angular/forms/signals';

interface Item {
  name: string;
  quantity: number;
}

// A reusable per-item schema keeps the rules readable.
function ItemSchema(item: SchemaPathTree<Item>) {
  required(item.name, { message: 'Item name is required' });
  min(item.quantity, 1, { message: 'Quantity must be at least 1' });
}

@Component({
  selector: 'app-order',
  templateUrl: './order.html',
  imports: [FormField],
})
export class Order {
  readonly model = signal({
    title: '',
    items: [{ name: '', quantity: 1 }] as Item[],
  });

  readonly f = form(this.model, (path) => {
    required(path.title);
    applyEach(path.items, ItemSchema);
  });

  // Add and remove by updating the MODEL, not the form.
  addItem() {
    this.model.update((current) => ({
      ...current,
      items: [...current.items, { name: '', quantity: 1 }],
    }));
  }

  removeItem(index: number) {
    this.model.update((current) => ({
      ...current,
      items: current.items.filter((_, i) => i !== index),
    }));
  }
}

// ===========================================================================
// NESTED SHAPES — the common real-world cases. schema(), apply() and
// applyEach() are each documented individually; the COMPOSITIONS below are
// not shown in the v22 docs. See the caveats.
// ===========================================================================
import { apply, schema } from '@angular/forms/signals';
import type { SchemaPathTree } from '@angular/forms/signals';

// --- 1. GROUP INSIDE AN ARRAY -------------------------------------------
// Model: { items: [{ name, quantity, address: { street, city } }] }
// Reactive Forms: fb.array([ fb.group({ ..., address: fb.group({...}) }) ])

const addressSchema = schema<Address>((address) => {
  required(address.street);
  required(address.city);
});

const lineItemSchema = schema<LineItem>((item) => {
  required(item.name);
  min(item.quantity, 1);
  apply(item.address, addressSchema);
});

readonly orderForm = form(this.orderModel, (path) => {
  applyEach(path.items, lineItemSchema);
});

// --- 2. ARRAY INSIDE A GROUP --------------------------------------------
// Model: { section: { title, rows: [{ label }] } }
// Reactive Forms: fb.group({ section: fb.group({ rows: fb.array([...]) }) })

const sectionSchema = schema<Section>((section) => {
  required(section.title);
  applyEach(section.rows, (row) => required(row.label));
});

readonly configForm = form(this.configModel, (path) => {
  apply(path.section, sectionSchema);
});

// --- 3. ARRAY INSIDE AN ARRAY ITEM --------------------------------------
// Model: { groups: [{ label, rules: [{ field, op }] }] }
// This is the risk-rating / document-config shape: fb.array of fb.group
// each containing another fb.array.

readonly rulesForm = form(this.rulesModel, (path) => {
  applyEach(path.groups, (group: SchemaPathTree<RuleGroup>) => {
    required(group.label);
    applyEach(group.rules, (rule) => {
      required(rule.field);
      required(rule.op);
    });
  });
});

// --- Mutating a NESTED array: rebuild every level, top down --------------
addRule(groupIndex: number): void {
  this.rulesModel.update((current) => ({
    ...current,
    groups: current.groups.map((group, i) =>
      i === groupIndex ? { ...group, rules: [...group.rules, blankRule()] } : group,
    ),
  }));
}

removeRule(groupIndex: number, ruleIndex: number): void {
  this.rulesModel.update((current) => ({
    ...current,
    groups: current.groups.map((group, i) =>
      i === groupIndex
        ? { ...group, rules: group.rules.filter((_, j) => j !== ruleIndex) }
        : group,
    ),
  }));
}

// Reading a deeply nested field:  this.rulesForm.groups[0].rules[1].field().value()
// Template:  @for (group of rulesForm.groups; track group) {
//              @for (rule of group.rules; track rule) {
//                <input [formField]="rule.field" />`,
      caveats: [
        STABILITY,
        MODEL_FIRST,
        MODEL_SHAPE,
        INCREMENTAL,
        'Mutation moves from the form to the model. `push()` / `removeAt()` become ' +
          '`model.update(...)` producing a NEW array — do not mutate the existing one in place, ' +
          'or the signal will not notify.',
        'Iterate with `@for (item of f.items; track item)` and bind `[formField]="item"`. ' +
          'Track by FIELD IDENTITY, not by index or by a value: the forms system already keeps ' +
          'stable identities for array items, and tracking wrongly makes inputs share state.',
        'Reach a single item in code by index: `f.items[0].name` — the field tree mirrors the ' +
          'model, so array access is real indexing.',
        'required() PASSES for an empty array. To demand at least one item use ' +
          '`minLength(path.items, 1)`.',
        'Objects in an array automatically receive tracking identities, so field state ' +
          '(touched, dirty, validation) survives reordering.',
        'PARTIALLY UNVERIFIED — only the DEEPER nesting. The docs DO show schema() combined ' +
          'with applyEach() (schemas guide, "Combining applyEach() with reusable schemas"), ' +
          'and an array of objects inside a group with per-item rules (validation guide). ' +
          'What no published example shows is apply() INSIDE applyEach(), or applyEach() ' +
          'inside applyEach() — both of which appear below. They follow from the documented ' +
          'signatures and they compile, but they are composed here, not copied.',
        'Nested arrays are JUDGMENT work, not a rename. Reactive Forms let you build a ' +
          'ragged structure at runtime; the model signal has to describe that shape as a ' +
          'type up front. Decide the model before touching code.',
        'Mutating a nested array means rebuilding EVERY level above it — `.map()` the outer ' +
          'array, spread the item, replace the inner array. Mutating in place at any level ' +
          'leaves the signal unnotified and the UI stale.',
        'The docs\' criterion for `schema<Item>(...)` is REUSE, not depth: "If rules only ' +
          'appear in one place, an inline schema function works just as well. Use schema() ' +
          'when you want to reuse the same schema across multiple forms or apply the same ' +
          'schema to multiple paths." Naming a schema for readability at depth is a ' +
          'reasonable extra reason, but it is not the documented one.',
      ],
      sources: [DOCS.validation, DOCS.dynamicJson, DOCS.models, DOCS.fieldState, DOCS.schemas],
    },
  ],
  [
    'dynamicControls',
    {
      construct: 'dynamicControls',
      description:
        'addControl / removeControl / setControl / registerControl have NO Signal Forms ' +
        'equivalent. The field tree is derived from the model signal’s type, so a form whose ' +
        'shape changes at runtime must express that shape as data or as conditional rules.',
      before: `import { FormControl, FormGroup, Validators } from '@angular/forms';

export class Shipping {
  readonly form = new FormGroup({
    requiresShipping: new FormControl(false),
  });

  toggleShipping(enabled: boolean) {
    if (enabled) {
      this.form.addControl('address', new FormControl('', Validators.required));
    } else {
      this.form.removeControl('address');
    }
  }
}`,
      after: `import { Component, signal } from '@angular/core';
import { form, FormField, hidden, required } from '@angular/forms/signals';

@Component({
  selector: 'app-shipping',
  templateUrl: './shipping.html',
  imports: [FormField],
})
export class Shipping {
  // The field always EXISTS in the model; its relevance is what varies.
  readonly model = signal({
    requiresShipping: false,
    address: '',
  });

  readonly f = form(this.model, (path) => {
    hidden(path.address, { when: ({ valueOf }) => !valueOf(path.requiresShipping) });
    required(path.address);
  });
}

// Template — a hidden field does not participate in validation, so the
// required() rule above cannot block submission while shipping is off:
//   @if (!f.address().hidden()) {
//     <input [formField]="f.address" />
//   }`,
      caveats: [
        STABILITY,
        'This is a DESIGN CHANGE, not a rename. Do not look for an addControl() equivalent — ' +
          'there is none, and inventing one will not typecheck.',
        'Choose by intent: a field that comes and goes is a permanent model field gated with ' +
          '`hidden()`; a group of rules that applies conditionally is `applyWhen()`; a ' +
          'genuinely variable-length list is an array in the model (see the FormArray recipe).',
        'Hidden, disabled and readonly fields all SKIP VALIDATION and do not contribute to ' +
          'parent validity — which is what lets hidden() stand in for removing a control. ' +
          'Note readonly is not fully inert: the docs say it prevents editing while still ' +
          'allowing focus and text selection.',
        'BOTH REACTIVE BEHAVIOURS INVERT HERE, so check what the old code was relying on. ' +
          'Reactive: a DISABLED control was excluded from `form.value` (hence getRawValue()) ' +
          'but a control merely hidden by *ngIf KEPT VALIDATING and kept the form invalid — ' +
          'the classic "invalid and I cannot see why", usually worked around with ' +
          'removeControl() or setValidators(null). Signal Forms: the VALUE is preserved and ' +
          'the VALIDATION is skipped, for all three states. Code ported from either ' +
          'workaround now does the opposite of what it did.',
        'hidden() does NOT hide anything by itself: "unlike disabled and readonly, there is ' +
          'no native DOM property for hidden state. The [formField] directive does not apply ' +
          'a hidden attribute to elements." Keep the @if in the template — the rule governs ' +
          'validation and state, not rendering.',
        'Non-interactive fields also never become touched or dirty from user interaction or ' +
          'from markAsTouched(), so a form that reveals errors on touched() will skip them.',
        'VERSION-SENSITIVE rule signature. On v22 the condition is an options object: ' +
          '`hidden(path.x, { when: ctx => ... })`. On v21 it was a bare callback: ' +
          '`hidden(path.x, ctx => ...)`. v22 still DECLARES the bare-callback overload and ' +
          'marks it @deprecated, so v21-shaped code compiles with a warning rather than ' +
          'failing the build — prefer the options object on v22, but do not expect the ' +
          'compiler to catch the older form for you.',
        'The imperative validator APIs are gone too: `addValidators()` / `setValidators()` ' +
          'become `applyWhen(path, condition, p => { required(p); })`.',
        'THE SCHEMA FUNCTION RUNS ONCE. This is the single most expensive habit to carry ' +
          'over. "When you pass a schema function to form(), that function runs once during ' +
          'form creation" — only the RULE CALLBACKS are reactive. So an imperative-looking ' +
          '`if (this.isPremium) { required(path.vatNumber); }` in the schema BODY compiles, ' +
          'evaluates once at construction, and never updates. The condition belongs inside ' +
          'the rule — `required(path.vatNumber, { when: () => this.isPremium() })` — or ' +
          'inside applyWhen(). Nothing warns you; the form is just permanently wrong.',
        'Model the shape STATICALLY. A model whose shape changes with its value "can cause ' +
          'data loss"; the documented approach is one model containing every branch, with ' +
          'the inactive branches hidden or disabled. For a discriminated union, ' +
          'applyWhenValue() narrows the type as well as gating the rules.',
      ],
      sources: [DOCS.formLogic, DOCS.fieldState, DOCS.migration, DOCS.modelDesign, DOCS.schemas],
      versionSensitive: true,
    },
  ],
  [
    'deadValidatorOption',
    {
      construct: 'deadValidatorOption',
      description:
        'NOT a migration step — a possible live bug. `validator` / `asyncValidator` ' +
        '(singular) are not AbstractControlOptions keys. Passed to `new FormGroup(...)` ' +
        'the validator is silently dropped. Passed to `fb.group(...)` it is NOT — ' +
        'FormBuilder maps the legacy key. Confirm which form you have, and confirm at ' +
        'runtime, before changing anything.',
      before: `// DROPPED — the constructor form reads options.validators, which is undefined:
this.form = new FormGroup(
  {
    password: new FormControl('', [Validators.required]),
    confirmPassword: new FormControl(''),
  },
  { validator: this.checkPasswords },
);

// NOT dropped — FormBuilder maps the legacy singular key to validators:
this.form = this.fb.group(
  { password: [''], confirmPassword: [''] },
  { validator: this.checkPasswords },
);`,
      after: `// 1. FIRST prove which case you have. A static scan cannot see Angular's
//    runtime fallback, so assert the behaviour before changing anything:
//
//      it('rejects mismatched passwords', () => {
//        component.form.setValue({ password: 'a', confirmPassword: 'b' });
//        expect(component.form.hasError('notMatching')).toBe(true);
//      });
//
//    Passing on the CURRENT code means the validator already runs (FormBuilder), and
//    there is no bug — only an implicit reliance on a legacy path.

// 2. Either way, prefer the explicit plural key in the code you have today:
import { Validators } from '@angular/forms';

this.form = this.fb.group(
  {
    password: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', [Validators.required]],
  },
  { validators: this.checkPasswords },
);

// 3. THEN migrate, attaching the rule to the field that should show the error:
import { form, minLength, required, validate } from '@angular/forms/signals';

readonly f = form(this.model, (path) => {
  required(path.password);
  minLength(path.password, 8);
  validate(path.confirmPassword, ({ value, valueOf }) =>
    value() === valueOf(path.password)
      ? null
      : { kind: 'passwordMismatch', message: 'Passwords do not match' },
  );
});`,
      caveats: [
        STABILITY,
        'VERIFY BEFORE YOU ACT. Angular treats the two construction paths differently, and ' +
          'this is DOCUMENTED: the FormBuilder API page describes a deprecated `group()` ' +
          'overload taking a "legacy configuration object" whose keys are the SINGULAR ' +
          '`validator` / `asyncValidator` — so fb.group still honours them. `new FormGroup` ' +
          'takes AbstractControlOptions, which documents only the plural `validators` / ' +
          '`asyncValidators`, so the singular key is ignored there. Only the second is a bug. ' +
          'See https://angular.dev/api/forms/FormBuilder',
        'Write the failing test first. If it passes on unmodified code, the validator is ' +
          'already running and there is nothing to fix — only an implicit dependency on a ' +
          'legacy path worth making explicit.',
        'If it genuinely never ran, enabling it is a BEHAVIOUR CHANGE, not a no-op. Data ' +
          'and flows that depended on the check being absent will start failing validation.',
        'Check the templates either way: they may branch on an error kind that has never ' +
          'been produced.',
        'Fix this in the current code first, as its own change. Rolling a behaviour fix ' +
          'into a migration diff makes a regression impossible to attribute.',
        'Signal Forms removes the whole class: schema rules are function calls, so a ' +
          'misspelled rule is a compile error rather than a silently ignored key.',
      ],
      sources: [DOCS.validation, DOCS.essentials, DOCS.formBuilderApi],
    },
  ],
  [
    'asyncValidator',
    {
      construct: 'asyncValidator',
      description:
        'An AsyncValidatorFn becomes validateHttp() (for HTTP checks) or validateAsync() ' +
        '(for anything else) declared inside the schema. Async rules run only after every ' +
        'synchronous rule passes, and in-flight requests cancel automatically on change.',
      before: `import { AbstractControl, AsyncValidatorFn, ValidationErrors } from '@angular/forms';
import { map } from 'rxjs/operators';

export function uniqueUsername(api: Api): AsyncValidatorFn {
  return (control: AbstractControl) =>
    api.checkUsername(control.value).pipe(
      map((available) => (available ? null : { usernameTaken: true })),
    );
}

readonly username = new FormControl('', {
  validators: [Validators.required],
  asyncValidators: [uniqueUsername(this.api)],
});`,
      after: `import { Component, signal } from '@angular/core';
import { form, FormField, minLength, required, validateHttp } from '@angular/forms/signals';

@Component({
  selector: 'app-registration',
  templateUrl: './registration.html',
  imports: [FormField],
})
export class Registration {
  readonly model = signal({ username: '' });

  readonly f = form(this.model, (path) => {
    // Synchronous rules run first; the request only fires once they pass.
    required(path.username);
    minLength(path.username, 3);

    validateHttp(path.username, {
      // Throttle just this request; other rules still react immediately.
      debounce: 300,
      request: ({ value }) => {
        const username = value();
        // Returning undefined skips the request entirely.
        return username ? \`/api/users/check?username=\${username}\` : undefined;
      },
      onSuccess: (response) =>
        response.available
          ? null
          : { kind: 'usernameTaken', message: 'Username is already taken' },
      onError: () => ({
        kind: 'serverError',
        message: 'Could not verify username availability',
      }),
    });
  });
}

// Template — pending() covers the in-flight window:
//   @if (f.username().pending()) { <span>Checking availability...</span> }`,
      caveats: [
        STABILITY,
        'Execution order changed and it matters: async rules run ONLY after every ' +
          'synchronous rule passes, so a request that used to fire on invalid input no ' +
          'longer does. It still evaluates on every value change otherwise — the params ' +
          'function runs per change unless you add a debounce.',
        'While a request is in flight, `pending()` is true and BOTH `valid()` and `invalid()` ' +
          'are false, and `errors()` is empty. Use `invalid()` rather than `!valid()`, or ' +
          'pending states will read as failures.',
        'Cancellation is automatic — a value change aborts the in-flight request. Delete any ' +
          'switchMap/takeUntil plumbing that existed to do this by hand.',
        'Prefer validateHttp() for REST checks — the docs call it "the most common form of ' +
          'async validation", and describe validateAsync() as "a lower-level API that ' +
          'exposes Angular\'s resource primitive directly". Reach for validateAsync() when ' +
          'the source is not a plain HTTP request. (Which non-HTTP sources is INFERRED — the ' +
          'docs name no examples, so do not repeat any as though they were listed.)',
        'An Observable-returning service still works: use rxResource() from ' +
          "'@angular/core/rxjs-interop' as the validateAsync() factory. Subscriptions are " +
          'cleaned up for you.',
        'A pending async validator does NOT block submission. `submit()` gates on ' +
          '`shouldRunAction`, which is synchronous: by default it tests `!invalid()`, and ' +
          'invalid() is false while a request is in flight, so the action runs. Nothing ' +
          'awaits validation. If the server answer must land first, await it inside the ' +
          "action, or guard on `pending()` before calling submit(). Passing " +
          "`ignoreValidators: 'none'` tests `valid()` instead, which REFUSES to submit " +
          'while pending (calling onInvalid) rather than waiting for it.',
      ],
      sources: [DOCS.asyncOperations, DOCS.validation],
    },
  ],
  [
    'formStateRead',
    {
      construct: 'formStateRead',
      description:
        'Reading state off a form object (`form.invalid`, `form.value`, `form.controls`) ' +
        'becomes a signal call on the field tree: call the field, then call the signal — ' +
        '`f().invalid()`. The whole-form value is simply the model signal.',
      before: `import { FormGroup } from '@angular/forms';

readonly form: FormGroup;

onSubmit(): void {
  if (this.form.invalid) return;
  this.api.save(this.form.value);
}

get emailErrors() {
  return this.form.controls['email'].errors;
}

readonly showWarning = this.form.dirty && this.form.touched;`,
      after: `import { computed, signal } from '@angular/core';
import { form, submit } from '@angular/forms/signals';

readonly model = signal({ email: '', name: '' });
readonly f = form(this.model);

onSubmit(): void {
  // form.invalid  -> f().invalid()
  if (this.f().invalid()) return;
  // form.value    -> the model signal itself
  this.api.save(this.model());
}

// form.controls['email'].errors -> dot notation, then the signal
readonly emailErrors = computed(() => this.f.email().errors());

// Reads compose inside computed() and update automatically.
readonly showWarning = computed(() => this.f().dirty() && this.f().touched());`,
      caveats: [
        STABILITY,
        'Two calls, not one: the field is a function AND its state members are signals, so ' +
          '`form.invalid` becomes `f().invalid()` — a common slip is writing `f.invalid()`.',
        'The root form is itself a field, so `f().valid()` is whole-form validity and ' +
          '`f.email().valid()` is one field.',
        'For the whole value prefer the model signal (`this.model()`) over `f().value()` — ' +
          'it is the source of truth and is already typed.',
        'Use `invalid()` rather than `!valid()`. While async validation is pending BOTH are ' +
          'false, so `!valid()` reports a pending field as broken.',
        '`form.controls[x]` becomes real property access on the field tree (`f.email`), and ' +
          'array items are reached by index (`f.items[0].name`).',
        'Hidden, disabled and readonly fields do not contribute to parent validity, so a ' +
          'whole-form `valid()` can be true while such a field would fail its rules.',
        '`status` (the string union VALID / INVALID / PENDING / DISABLED) has no documented ' +
          'counterpart — Signal Forms exposes separate boolean signals. Rewrite comparisons ' +
          'against the string as valid() / invalid() / pending() checks.',
        'To ask for ONE error, `f.email().getError(kind)` narrows (a `minLength` error carries ' +
          '`.minLength`) and avoids filtering `errors()` by hand. INFERRED, not documented: ' +
          'calling it from a TEMPLATE. Its API page documents reactivity only "within a ' +
          'reactive context (e.g. computed or effect)", and no Angular guide mentions ' +
          'getError() at all — every documented example iterates `errors()`. Templates cannot ' +
          'contain arrow functions, so the documented alternative is a computed() index.',
        '`control.hasError(key)` becomes `f.field().getError(kind) !== undefined`. It is a ' +
          'READ, not a write — do not migrate it with setValue/patchValue. The argument is ' +
          'an error KIND, not the old key: `minlength` became `minLength` and `maxlength` ' +
          'became `maxLength`, so a transliterated `hasError("minlength")` compiles and ' +
          'silently never matches.',
      ],
      sources: [
        DOCS.essentials,
        DOCS.fieldState,
        DOCS.models,
        DOCS.fieldStateApi,
        DOCS.templateExpressions,
      ],
    },
  ],
  [
    'formStateWrite',
    {
      construct: 'formStateWrite',
      description:
        'Writing to a form splits in two. Value writes (setValue / patchValue) go through the ' +
        'model signal, and reset() exists on field state. The markAs* / setErrors / enable / ' +
        'setValidators family has NO counterpart — that state is derived from schema rules.',
      before: `import { FormGroup, Validators } from '@angular/forms';

readonly form: FormGroup;

load(user: User): void {
  this.form.patchValue({ name: user.name });
  this.form.get('email')!.setValue(user.email);
}

submit(): void {
  if (this.form.invalid) {
    this.form.markAllAsTouched();   // reveal the errors
    return;
  }
  this.form.reset();
}

lock(): void {
  this.form.disable();
  this.form.get('code')!.setValidators([Validators.required]);
  this.form.get('code')!.updateValueAndValidity();
}`,
      after: `import { signal } from '@angular/core';
import { applyWhen, disabled, form, required, submit } from '@angular/forms/signals';

private readonly INITIAL = { name: '', email: '', code: '' };
readonly model = signal({ ...this.INITIAL });
readonly isLocked = signal(false);

readonly f = form(
  this.model,
  (path) => {
    // disable() -> a rule. The state is derived, never assigned.
    disabled(path.code, { when: () => this.isLocked() });

    // setValidators() -> applyWhen(). Validators are declared, not attached.
    applyWhen(
      path,
      () => this.isLocked(),
      (p) => {
        required(p.code);
      },
    );
  },
  {
    submission: {
      action: async (f) => {
        await this.api.save(this.model());
        // reset() clears touched/dirty. It does NOT clear the value unless you
        // pass one, which reactive forms' reset() did for you.
        f().reset({ ...this.INITIAL });
      },
    },
  },
);

load(user: User): void {
  // patchValue -> a partial model update.
  this.model.update((current) => ({ ...current, name: user.name }));
  // setValue on one control -> write through that field.
  this.f.email().value.set(user.email);
}

// markAllAsTouched() is usually deletable: submit() marks every interactive
// field touched itself, which is the only reason that call existed. Where you
// do still want it, f().markAsTouched() covers descendants by default.
onSubmit(): void {
  submit(this.f);
}`,
      caveats: [
        STABILITY,
        'MECHANICAL: setValue / patchValue / reset / getRawValue. patchValue becomes a partial ' +
          '`model.update(...)`; a single-field setValue becomes `f.field().value.set(v)`; ' +
          'getRawValue becomes `this.model()`.',
        'Always produce a NEW object in model.update(...). Mutating the existing one will not ' +
          'notify the signal.',
        'THESE DO EXIST on field state, contrary to a common assumption: `markAsTouched()` ' +
          '(which takes a `skipDescendants` option, defaulting to false so descendants are ' +
          'marked too) and `markAsDirty()`. Both compile against @angular/forms v22.',
        'NO COUNTERPART: markAsUntouched / markAsPristine / markAsPending / setErrors / ' +
          'updateValueAndValidity / enable / disable / setValidators / addValidators / ' +
          'removeValidators. Verified absent by compiling each against v22 field state.',
        '`markAllAsTouched()` IS covered — the field-state guide states that "the default ' +
          'value of `skipDescendants` is `false`, so the call marks the section field and ' +
          'each descendant field as touched". So an ' +
          '`Object.keys(form.controls).forEach(k => ...markAsTouched())` loop collapses to a ' +
          'single `f().markAsTouched()`, and often can go entirely: submit() (and the ' +
          'FormRoot directive) marks every interactive field touched itself.',
        'Touched has a documented exception that Reactive Forms did not: "only interactive ' +
          'fields can become touched; hidden, disabled, and readonly fields do not become ' +
          'touched from user interactions or markAsTouched()". A form relying on touched to ' +
          'reveal errors will skip those fields.',
        'RESET TAKES AN ARGUMENT NOW. The FieldState API page documents reset() as "Resets ' +
          'the touched and dirty state of the field and its descendants", and its value ' +
          'parameter as "Optional value to set to the form. If not passed, the value will ' +
          'NOT be changed." So `f().reset()` clears interaction state and leaves the data; ' +
          '`f().reset({ ...INITIAL })` clears both, which is the form the field-state guide ' +
          'shows under "Resetting forms after submission". A bare `form.reset()` translated ' +
          'literally therefore leaves the old values on screen — pass the initial value.',
        'INFERRED, not documented: that this DIFFERS from Reactive Forms, whose reset() ' +
          'restored the initial value as well. angular.dev never contrasts the two — the ' +
          'migration guide does not mention reset() at all — so treat the comparison as this ' +
          "tool's reading of both APIs, and confirm against your own behaviour.",
        '`updateValueAndValidity()` has nothing to replace it — validation reruns ' +
          'automatically whenever a value a rule reads changes.',
        'enable()/disable() become the `disabled()` rule; setValidators()/addValidators()/' +
          'removeValidators() become `applyWhen()`. On the SignalFormControl compat class the ' +
          'migration guide says outright that "attempting to call disable/enable would throw ' +
          'an error" and the same for the validator methods — a clear signal of intent.',
        'Do NOT extend that to setErrors()/markAsPending(). The same guide files those under ' +
          '"not supported" and never says they throw, so predicting a throw for them would be ' +
          'inventing behaviour. Errors are derived from rules; see the formSubmission recipe.',
        'setErrors() has a direct replacement, and it is NOT an async validator: ' +
          'return the error from the submit() action and Angular routes it to the field. See ' +
          'the `formSubmission` recipe — this is the single most common reason setErrors() ' +
          'exists (a rejected sign-in, a duplicate email) and hand-rolling it is a mistake.',
        'VERSION-SENSITIVE rule signature: v22 takes `disabled(path, { when: cb })` where v21 ' +
          'took a bare callback `disabled(path, cb)`. v22 still declares the bare-callback ' +
          'overload as @deprecated, so the older form compiles with a warning — the build ' +
          'will not catch it for you.',
      ],
      sources: [DOCS.essentials, DOCS.fieldState, DOCS.formLogic, DOCS.migration],
      versionSensitive: true,
    },
  ],
  [
    'formSubmission',
    {
      construct: 'formSubmission',
      description:
        'The submit-and-show-the-server-error cycle. Reactive Forms had no support for it, ' +
        'so components hand-built the whole thing: an isSubmitting flag, markAllAsTouched() ' +
        'on invalid, and setErrors() to push the rejection onto a control. Signal Forms owns ' +
        'all three — the submit() action returns the errors and Angular routes them to the ' +
        'fields named in each one.',
      before: `import { FormBuilder, FormGroup } from '@angular/forms';

export class LoginComponent {
  loginForm: FormGroup;
  isSubmitting = false;

  onSubmit(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }
    this.isSubmitting = true;

    this.auth.login(this.loginForm.value).subscribe({
      next: () => { this.isSubmitting = false; },
      error: (err) => {
        this.isSubmitting = false;
        // The rejection has to be pushed onto the control by hand, and it stays
        // there until something happens to revalidate that control.
        this.loginForm.get('password')?.setErrors({ invalidCredentials: true });
      },
    });
  }
}`,
      after: `import { signal } from '@angular/core';
import { form, required, email, minLength, submit } from '@angular/forms/signals';

export class LoginComponent {
  readonly model = signal({ email: '', password: '' });

  readonly f = form(
    this.model,
    (path) => {
      required(path.email);
      email(path.email);
      required(path.password);
      minLength(path.password, 8);
    },
    {
      submission: {
        // Return nothing on success. Return an error (or an array of them) to fail,
        // with fieldTree naming the field it belongs to.
        action: async (f) => {
          const result = await this.auth.login(f().value());
          if (result.ok) return;
          return {
            kind: 'invalidCredentials',
            message: 'Incorrect email or password.',
            fieldTree: f.password,
          };
        },
        // Replaces the markAllAsTouched()-and-bail branch: submit() has already
        // marked every interactive field touched by the time this runs.
        onInvalid: (f) => {
          f().errorSummary()[0]?.fieldTree().focusBoundControl();
        },
      },
    },
  );

  async onSubmit(): Promise<void> {
    await submit(this.f);
  }
}

// Template: submitting() replaces the isSubmitting flag entirely.
// <button type="submit" [disabled]="f().submitting()">Sign in</button>`,
      caveats: [
        STABILITY,
        'THE ERROR CLEARS ITSELF. "Submission errors clear automatically when the user edits ' +
          'the field." Do not reproduce the reactive-forms dance of tracking which value was ' +
          "rejected so you can clear the error later — that is the framework's job now.",
        'A submission error is NOT a validation rule: it does not recompute. The docs are ' +
          'explicit that "once cleared, they do not reappear unless the form is submitted ' +
          'again". Validation rules, by contrast, re-run on every change.',
        'DO NOT reach for validateHttp() / validateAsync() here. Those validate a value as it ' +
          'changes (is this username taken?) and would call your endpoint on every keystroke. ' +
          'A credential rejection is a submission result.',
        '`fieldTree` takes the FIELD ITSELF (`f.password`), not a path string. Omit it and the ' +
          'error lands on the submitted field — which for `submit(f)` is the whole form.',
        'Success is signalled by returning nothing: `null`, `undefined`, or a bare `return`.',
        '`f().submitting()` is true while the action runs and resets itself when it settles, ' +
          'so a hand-maintained isSubmitting flag is dead code after the migration.',
        'submit() returns Promise<boolean> — false when validation failed OR the action ' +
          'returned errors. Concurrent submits are refused: a second call while one is in ' +
          'flight returns false immediately without running the action.',
        'By default a pending async validator does NOT block submission: shouldRunAction ' +
          "tests `!invalid()`, and pending is neither valid nor invalid. Passing " +
          "`ignoreValidators: 'none'` switches it to `valid()`, which refuses the submit " +
          'while a check is in flight and calls onInvalid — it does not wait for the answer.',
        'The FormRoot directive on the <form> element calls submit() for you, sets novalidate ' +
          'and prevents the default navigation. Use it instead of (ngSubmit) plumbing.',
      ],
      sources: [DOCS.formSubmission, DOCS.fieldState],
    },
  ],
  [
    'templateBindings',
    {
      construct: 'templateBindings',
      description:
        'The template half of a migration, which the .ts scan never sees. The whole ' +
        '`[formGroup]` / `formControlName` / `formGroupName` directive family is replaced by ' +
        'one directive, `[formField]`, bound to a dotted path on the field tree — and the ' +
        'error-display block changes shape with it.',
      before: `<!-- component.ts: imports: [ReactiveFormsModule] -->
<form [formGroup]="loginForm" (ngSubmit)="onSubmit()">
  <input formControlName="email" />
  @if (loginForm.get('email')?.errors?.['required']) {
    <span>Email is required</span>
  }
  @if (loginForm.get('email')?.errors?.['minlength']) {
    <span>Too short</span>
  }

  <div formGroupName="address">
    <input formControlName="street" />
  </div>

  <input formControlName="code" [disabled]="isLocked" maxlength="6" />
</form>`,
      after: `<!-- component.ts: imports: [FormField, FormRoot]  (from '@angular/forms/signals') -->
<!-- [formRoot] is OPTIONAL: it wires up submit() and novalidate for you. A bare
     <form novalidate> that calls submit(this.f) by hand is equally valid. -->
<form [formRoot]="f">
  <input [formField]="f.email" />
  <!-- Errors are an array of { kind, message }, read from the field. Match on kind;
       the reactive-forms key 'minlength' is now 'minLength'. -->
  @if (f.email().touched() && f.email().invalid()) {
    @for (error of f.email().errors(); track error) {
      <span>{{ error.message }}</span>
    }
  }

  <!-- formGroupName disappears: nesting is just a longer dotted path. -->
  <input [formField]="f.address.street" />

  <!-- Drop [disabled] and the hardcoded maxlength: [formField] binds disabled/readonly
       from the field's own state, and the maxLength() rule emits the native attribute
       (a hand-written one fails a v22 AOT build, NG8022). -->
  <input [formField]="f.code" />
</form>`,
      caveats: [
        STABILITY,
        'IMPORTS: swap `ReactiveFormsModule` for the standalone `FormField` directive in the ' +
          "component's `imports: []` (and `FormRoot` if you use `[formRoot]`), both from " +
          "'@angular/forms/signals'. This is a `.ts` edit the template change depends on.",
        '`[formField]` binds a DOTTED PATH on the field tree, not a name: `formControlName=' +
          '"email"` becomes `[formField]="f.email"`, and `formGroupName="a"` + ' +
          '`formControlName="b"` collapse to `[formField]="f.a.b"`. No `.value`, no `.fieldTree` ' +
          '(that suffix is only for a compat SignalFormControl).',
        'ERROR DISPLAY CHANGES SHAPE. Reactive Forms exposed a keyed object ' +
          "(`errors?.['required']`); Signal Forms exposes an array of `{ kind, message }` on " +
          '`field().errors()`. The documented idiom gates on `touched() && invalid()` and ' +
          'either shows `errors()[0].message` or iterates `@for (error of field().errors(); ' +
          'track error)`. `message` is optional, so supply your own text when it is absent.',
        'The error KEY is also renamed for two rules: `minlength`/`maxlength` become ' +
          '`minLength`/`maxLength`. A template still matching the old key compiles and ' +
          'silently never fires — this is the one template change with no visible symptom.',
        'DELETE hand-written `[disabled]` and `[readonly]` on a bound control: "the ' +
          '`[formField]` directive automatically binds the `disabled`/`readonly` attribute ' +
          "based on the field's state, so you don't need to manually add it.\" Drive them " +
          'from `disabled()` / `readonly()` rules in the schema instead.',
        'DELETE hardcoded `required`/`min`/`max`/`minlength`/`maxlength` attributes on a bound ' +
          'control — the matching rule emits the native attribute itself, and a hand-written ' +
          'copy fails a v22 AOT build with NG8022 (UNVERIFIED wording — NG8022 has no ' +
          'angular.dev page; observed in a real build).',
        'This tool does not parse templates as an AST — it flags the bindings and leaves the ' +
          'surrounding structure to you. Re-run your AOT build after editing: the compiler is ' +
          'the real check on a template, not this scan.',
      ],
      sources: [DOCS.fieldState, DOCS.formFieldApi, DOCS.formRootApi, DOCS.essentials],
    },
  ],
  [
    'Template.formArrayName',
    {
      construct: 'Template.formArrayName',
      description:
        'A `formArrayName` block with a `*ngFor`/`@for` inside iterates the field array ' +
        'directly, and the tracking expression is the part that has to change carefully.',
      before: `<div formArrayName="emails">
  @for (ctrl of emails.controls; track i; let i = $index) {
    <input [formControlName]="i" />
  }
</div>`,
      after: `<!-- No array wrapper directive. Iterate the field array and bind each field. -->
@for (field of f.emails; track field) {
  <input [formField]="field" />
}`,
      caveats: [
        STABILITY,
        'TRACK BY FIELD IDENTITY, not by index. The docs are explicit: "a `@for` block over a ' +
          'set of fields should be tracked by field identity" — `track field`, because "the ' +
          'forms system is already… maintaining a stable identity of the fields it creates ' +
          'automatically". `track $index` or `track i` misbinds inputs after an insert, ' +
          'remove or reorder.',
        'The array itself is a plain array in the model signal (see the FormArray recipe); ' +
          'this recipe is only the template half.',
      ],
      sources: [DOCS.fieldState],
    },
  ],
  [
    'Template.selectMultiple',
    {
      construct: 'Template.selectMultiple',
      description:
        'A `<select multiple>` bound to a form control is a documented dead end: the ' +
        '[formField] directive does not support it, so this control cannot be migrated as-is.',
      before: `<select multiple formControlName="tags">
  @for (tag of allTags; track tag) { <option [value]="tag">{{ tag }}</option> }
</select>`,
      after: `<!-- No mechanical conversion exists. Options, in order of preference:
     1. Keep this ONE control on Reactive Forms (interop), migrating the rest.
     2. Write a custom FormValueControl<string[]> that wraps a multi-select.
     3. Redesign as a list of checkboxes, one boolean field each.
     Decide before starting — a half-migrated form with a stuck control is worse. -->`,
      caveats: [
        STABILITY,
        'DOCUMENTED BLOCKER, quoted from the essentials guide: "Multiple select ' +
          '(`<select multiple>`) is not supported by the `[formField]` directive at this ' +
          'time." A single `<select>` is fine; only the `multiple` variant is blocked.',
        'Find them before you begin: `grep -rn "select" --include=*.html | grep multiple`. ' +
          'Discovering this half-way through a migration is the expensive path.',
        'A single-value `<select>` migrates normally — `formControlName` becomes `[formField]`; ' +
          'the essentials guide shows a bound `<select>` with `@for` options.',
      ],
      sources: [DOCS.essentials, DOCS.customControls],
    },
  ],
  [
    'Template.ngModel',
    {
      construct: 'Template.ngModel',
      description:
        'ngModel is TEMPLATE-DRIVEN forms, not Reactive Forms. angular.dev documents no ' +
        'migration path from ngModel to Signal Forms, so this is out of scope for a Reactive ' +
        'Forms migration.',
      before: `<input [(ngModel)]="user.email" name="email" required />`,
      after: `<!-- NOT_STATED: the Signal Forms migration guide covers Reactive Forms interop only
     (compatForm / SignalFormControl) and gives no ngModel path. This is a rewrite, not a
     mechanical migration: model the field in a signal and bind [formField], the same as any
     new Signal Forms control — but that is a design decision, so do not treat it as
     in-scope for a Reactive-to-Signal pass. -->`,
      caveats: [
        STABILITY,
        'NOT_STATED — no documented ngModel → Signal Forms migration. The migration guide is ' +
          'entirely about Reactive Forms interop. If a file mixes ngModel and Reactive Forms, ' +
          'migrate the Reactive Forms parts and leave the template-driven controls, or treat ' +
          'their rewrite as separate net-new work.',
        'The Comparison guide still lists template-driven forms as a supported choice, so ' +
          'staying on ngModel for those controls is legitimate, not technical debt.',
      ],
      sources: [DOCS.migration, DOCS.overview],
    },
  ],
  [
    'testing',
    {
      construct: 'testing',
      description:
        'Specs need migrating too, and under different rules than production code. A ' +
        'Reactive Forms spec builds a form with `new FormGroup({...})` and zero DI; a signal ' +
        'form needs an injection context to construct at all, so every ported spec either ' +
        'gets one or throws on the first line.',
      before: `import { FormControl, FormGroup, Validators } from '@angular/forms';

describe('LoginComponent', () => {
  it('is invalid with a short password', () => {
    const form = new FormGroup({
      email: new FormControl('', [Validators.required, Validators.email]),
      password: new FormControl('', [Validators.minLength(8)]),
    });

    form.setValue({ email: 'a@b.com', password: 'short' });

    expect(form.invalid).toBe(true);
    expect(form.get('password')?.hasError('minlength')).toBe(true);
  });
});`,
      after: `import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form, required, email, minLength } from '@angular/forms/signals';

describe('LoginComponent', () => {
  it('is invalid with a short password', () => {
    const model = signal({ email: '', password: '' });

    // The form needs an injection context. Either pass an injector...
    const f = form(
      model,
      (path) => {
        required(path.email);
        email(path.email);
        minLength(path.password, 8);
      },
      { injector: TestBed.inject(Injector) },
    );
    // ...or wrap the construction: TestBed.runInInjectionContext(() => form(...)).

    model.set({ email: 'a@b.com', password: 'short' });

    expect(f().invalid()).toBe(true);
    // Note the kind: 'minLength', not the reactive 'minlength'.
    expect(f.password().getError('minLength')).toBeDefined();
  });
});`,
      caveats: [
        STABILITY,
        'THE INJECTION CONTEXT IS THE BLOCKER. "Signal Forms needs an injection context ' +
          'during form creation." Pass `{ injector: TestBed.inject(Injector) }` to form(), or ' +
          'build it inside `TestBed.runInInjectionContext(() => ...)`. A Reactive spec needed ' +
          'neither, so this is the line that breaks first in every ported file.',
        'Most specs no longer need a component fixture at all: "most forms only need isolated ' +
          'tests… schemas do not need a template to run". If the old spec called ' +
          'TestBed.createComponent purely to exercise validators, drop the fixture.',
        'Writes in tests go through the signal: `f.name().value.set("Ada")`, or set the model ' +
          'directly. `setValue`/`patchValue` on a control have no counterpart here.',
        'For component-bound tests, `await fixture.whenStable()` replaces the ' +
          'detectChanges()/tick()/fakeAsync dance, "including async validators or server ' +
          'calls" — await it after the async work resolves.',
        'Assertions move to signal calls and error KINDS: `form.invalid` becomes ' +
          '`f().invalid()`, and `hasError("minlength")` becomes a match on kind `minLength`. ' +
          'The casing change is silent — see the Validators.minLength recipe.',
        'UNVERIFIED — the testing guide documents no test harness, no way to mark a field ' +
          'touched in an isolated test, and no submit() recipe. If a spec depends on touched ' +
          'state, drive it through a component fixture rather than inventing an API.',
        'These files are deliberately EXCLUDED from the migration counts, because a spec ' +
          'cannot be migrated before the code it tests. The report lists them separately.',
      ],
      sources: [DOCS.testing, DOCS.fieldState],
    },
  ],
  [
    'statusClasses',
    {
      construct: 'statusClasses',
      description:
        'Reactive Forms stamped ng-valid / ng-invalid / ng-touched / ng-dirty / ng-pristine ' +
        'onto every bound element, and stylesheets everywhere key off them. Signal Forms does ' +
        'NOT emit those classes. Nothing warns you: it compiles, it type-checks, the tests ' +
        'pass, and the error styling silently disappears across the whole app.',
      before: `/* styles.scss — works because Reactive Forms adds the classes for you */
.form-input.ng-invalid.ng-touched {
  border-color: var(--error);
}
.form-input.ng-valid.ng-dirty {
  border-color: var(--success);
}`,
      after: `// app.config.ts — one provider restores the classes app-wide.
import { provideSignalFormsConfig } from '@angular/forms/signals';
import { NG_STATUS_CLASSES } from '@angular/forms/signals/compat';

// Add to the providers array you already bootstrap with:
//   bootstrapApplication(App, { providers: [ ...appConfig.providers ] })
export const appConfig = {
  providers: [provideSignalFormsConfig({ classes: NG_STATUS_CLASSES })],
};

// Or map only the classes you actually style:
provideSignalFormsConfig({
  classes: {
    'ng-valid': ({ state }) => state().valid(),
    'ng-invalid': ({ state }) => state().invalid(),
    'ng-touched': ({ state }) => state().touched(),
    'ng-dirty': ({ state }) => state().dirty(),
  },
});

// The per-element alternative, if you would rather not reinstate globals:
// <input [formField]="f.email"
//        [class.is-invalid]="f.email().touched() && f.email().invalid()">`,
      caveats: [
        STABILITY,
        'CHECK THIS BEFORE MIGRATING ANYTHING, not after. Grep the stylesheets for `ng-` ' +
          'first: `grep -rn "ng-invalid\\|ng-touched\\|ng-dirty\\|ng-valid\\|ng-pristine" ' +
          '--include=*.css --include=*.scss`. A hit means every migrated form loses that ' +
          'styling the moment it converts, and no test or type-check will tell you.',
        'The migration guide is explicit: "Reactive/Template Forms automatically adds class ' +
          'attributes (such as `.ng-valid` or `.ng-dirty`) to facilitate styling control ' +
          'states. Signal Forms does not do that."',
        'NG_STATUS_CLASSES comes from `@angular/forms/signals/compat`, NOT from ' +
          '`@angular/forms/signals` — provideSignalFormsConfig lives in the latter, so the ' +
          'two imports come from different entry points.',
        'UNVERIFIED — which exact classes NG_STATUS_CLASSES covers. Its API page describes it ' +
          'only as adding "the ng-* status classes from reactive forms" and does not ' +
          "enumerate them; the guide's hand-rolled example shows just four (valid, invalid, " +
          'touched, dirty). If you style ng-pristine, ng-untouched or ng-pending, confirm ' +
          'those specifically rather than assuming parity.',
        'Angular also warns off the native CSS pseudo-classes as a substitute: "Do not rely ' +
          'on native validity features such as the `:valid` and `:invalid` CSS ' +
          'pseudo-classes" — Signal Forms deliberately does not use browser constraint ' +
          'validation, since any component can be a control.',
        'The documented per-element idiom is manual class binding on `touched() && invalid()`, ' +
          'which is also the documented way to keep errors hidden until the user has ' +
          'interacted with a field.',
      ],
      sources: [DOCS.migration, DOCS.fieldState, DOCS.validation],
    },
  ],
  [
    'ControlValueAccessor',
    {
      construct: 'ControlValueAccessor',
      description:
        'ControlValueAccessor is replaced by the FormValueControl interface (or ' +
        'FormCheckboxControl for on/off controls). The four-method callback protocol ' +
        'collapses into a `value` model signal, with optional inputs for the state the ' +
        'control wants to render.',
      before: `import { Component, forwardRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Component({
  selector: 'app-rating',
  template: '<div (click)="rate(1)">{{ value }}</div>',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => RatingInput), multi: true },
  ],
})
export class RatingInput implements ControlValueAccessor {
  value = 0;
  disabled = false;
  private onChange: (value: number) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(value: number): void { this.value = value; }
  registerOnChange(fn: (value: number) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(isDisabled: boolean): void { this.disabled = isDisabled; }

  rate(value: number): void {
    this.value = value;
    this.onChange(value);
    this.onTouched();
  }
}`,
      after: `import { Component, input, model, output } from '@angular/core';
import type { FormValueControl, ValidationError } from '@angular/forms/signals';

@Component({
  selector: 'app-rating',
  template: \`
    <div (click)="rate(1)" (blur)="touch.emit()">{{ value() }}</div>
    @if (invalid()) {
      @for (error of errors(); track error) {
        <span>{{ error.message }}</span>
      }
    }
  \`,
})
export class RatingInput implements FormValueControl<number> {
  // The ONLY required member: a model signal called \`value\`.
  value = model<number>(0);

  // Optional — declare just the state this control actually renders.
  disabled = input<boolean>(false);
  readonly = input<boolean>(false);
  invalid = input<boolean>(false);
  errors = input<readonly ValidationError[]>([]);
  touched = input<boolean>(false);
  touch = output<void>();

  rate(value: number): void {
    // Writing to the model signal is what registerOnChange used to do.
    this.value.set(value);
  }
}

// Usage is unchanged in shape:
//   <app-rating [formField]="f.rating" />`,
      caveats: [
        STABILITY,
        'NEVER implement both ControlValueAccessor and FormValueControl on the same ' +
          'component — the docs call this out explicitly. Pick one.',
        'Use `FormCheckboxControl` instead for boolean on/off controls: its required member ' +
          'is a `checked` model signal rather than `value`.',
        'Migration can be incremental in this direction: a FormValueControl component works ' +
          'as-is with Reactive and Template-Driven forms, so you can convert the control ' +
          'first and leave its consumers on FormGroup until later.',
        'INFERRED, not documented: drop `NG_VALUE_ACCESSOR`, the `forwardRef` and all four ' +
          'callback methods. The v22 docs never mention any of those identifiers, and every ' +
          'published custom-control example has no `providers` array — but the docs do not ' +
          'state the removal, so confirm against your own build.',
        'Optional state PROPERTIES (the docs\' term, not "inputs") a control may declare: ' +
          'touched, dirty, errors, invalid, pending, disabled, disabledReasons, readonly, ' +
          'hidden, required, min, max, minLength, maxLength, pattern, name. All optional — ' +
          'implement only what your control needs.',
        'TRUST THE TYPES OVER THE GUIDE ON TWO POINTS HERE, both checked against the ' +
          'declarations in @angular/forms 22.0.7. (1) The guide says "the `touched` property ' +
          'uniquely supports `input()`, or `OutputRef`". It does not: `touched` is an ' +
          '`InputSignal<boolean>` only, and the OutputRef is a SEPARATE member named `touch`. ' +
          "Declaring `touched = output<void>()` will not report blur. (2) The guide's " +
          'property table lists `valid`, but `FormUiControl` has no `valid` member — read ' +
          'validity through `invalid`, `pending` and `errors`. A `valid` input is simply ' +
          'never bound.',
        'Report blur with the `touch` output rather than the old registerOnTouched callback.',
      ],
      sources: [DOCS.customControls, DOCS.migration],
    },
  ],
  [
    'valueChanges',
    {
      construct: 'valueChanges',
      description:
        'TRIVIAL TIER — a form stream with no operator chain. The stream itself disappears: ' +
        'a field’s value is already a signal, so derived state becomes computed() and only ' +
        'genuine side effects become effect().',
      before: `this.form.valueChanges.subscribe((value) => {
  this.total = value.quantity * value.price;
});

this.form.controls.email.valueChanges.subscribe((email) => {
  this.analytics.track('email_changed', email);
});`,
      after: `import { computed, effect, signal } from '@angular/core';
import { form } from '@angular/forms/signals';

readonly model = signal({ quantity: 1, price: 0, email: '' });
readonly f = form(this.model);

// Derived state -> computed(). No subscription, no teardown.
readonly total = computed(() => this.f.quantity().value() * this.f.price().value());

// A genuine side effect -> effect().
constructor() {
  effect(() => {
    this.analytics.track('email_changed', this.f.email().value());
  });
}`,
      caveats: [
        STABILITY,
        "UNVERIFIED — tool-authored guidance. The v22 docs describe no migration path from valueChanges pipelines to signals: they never discuss operator equivalents, combineLatest, filter, or when to keep RxJS. The primitives used below (computed, effect, the debounce rule, toObservable/toSignal, rxResource) ARE documented and compile; the strategy for choosing between them is this tool's, not Angular's. Confirm on https://angular.dev/ecosystem/rxjs-interop before relying on it.",
        'Reach for computed() FIRST. If the subscribe body only assigned to a component ' +
          'field, that field was derived state and should be a computed() — using effect() ' +
          'to write state back into signals is an anti-pattern Angular explicitly warns about.',
        'Timing differs, so code that COUNTED emissions will behave differently. The only ' +
          'documented form of this is about toObservable: "even if you update a signal\'s ' +
          'value multiple times, toObservable will only emit the value after the signal ' +
          'stabilizes". INFERRED, not documented: that the same coalescing applies to signal ' +
          'reads generally. Do not rely on a specific notification count either way.',
        'No teardown needed. computed() is lazy and holds no subscription, so there is ' +
          'nothing to unsubscribe; a component effect() is destroyed with the component. ' +
          'Either way the takeUntil / unsubscribe / OnDestroy plumbing goes. (toSignal() is ' +
          'the one that needs an injection context — computed() does not.)',
        'INFERRED, not documented: that valueChanges did not emit an initial value. The ' +
          'AbstractControl API page says only that it "emits an event every time the value ' +
          'of the control changes". A computed() always has a current value, so a ' +
          '`startWith(...)` added to compensate is redundant — verify against your own code.',
      ],
      sources: [DOCS.essentials, DOCS.fieldState, DOCS.rxjsInterop],
    },
  ],
  [
    'valueChangesPipeline',
    {
      construct: 'valueChangesPipeline',
      description:
        'MODERATE TIER — a form stream piped through value transforms (map, filter, ' +
        'debounceTime, distinctUntilChanged, startWith, tap). Each has a signal-world ' +
        'equivalent, but the result is a redesign, not an operator-for-operator swap.',
      before: `import { debounceTime, distinctUntilChanged, map } from 'rxjs/operators';

this.form.valueChanges
  .pipe(
    debounceTime(300),
    map((value) => value.query.trim()),
    distinctUntilChanged(),
  )
  .subscribe((query) => this.runSearch(query));`,
      after: `import { computed, effect, signal } from '@angular/core';
import { debounce, form } from '@angular/forms/signals';

readonly model = signal({ query: '' });

readonly f = form(this.model, (path) => {
  // debounceTime -> the debounce() SCHEMA RULE. It holds UI changes back from the
  // model, so every downstream rule and computed sees the settled value.
  debounce(path.query, 300);
});

// map -> computed()
readonly query = computed(() => this.f.query().value().trim());

// distinctUntilChanged -> implicit: a computed only notifies when its value
// actually changes under the signal equality function.
constructor() {
  effect(() => this.runSearch(this.query()));
}`,
      caveats: [
        STABILITY,
        "UNVERIFIED — tool-authored guidance. The v22 docs describe no migration path from valueChanges pipelines to signals: they never discuss operator equivalents, combineLatest, filter, or when to keep RxJS. The primitives used below (computed, effect, the debounce rule, toObservable/toSignal, rxResource) ARE documented and compile; the strategy for choosing between them is this tool's, not Angular's. Confirm on https://angular.dev/ecosystem/rxjs-interop before relying on it.",
        'Operator-by-operator mapping: `map` -> computed(); `filter` -> a computed that ' +
          'returns the previous or empty value, or a guard inside the effect; `debounceTime` -> ' +
          'the debounce() schema rule; `distinctUntilChanged` -> implicit in signal equality; ' +
          '`startWith` -> the model’s initial value; `tap` -> effect().',
        'debounce() is a SCHEMA RULE, not an operator — it delays the commit to the model, so ' +
          'it throttles validation and every derived signal at once. If you only want to ' +
          'throttle one async check, use the validator’s own `debounce` option instead.',
        'debounce() also accepts the literal string "blur" to defer the commit until the ' +
          'field is touched, and touching a field flushes any pending debounce immediately.',
        '`filter` has no clean equivalent — signals always have a current value, so there is ' +
          'no way to "not emit". Move the condition into the consumer.',
        'Timing differs, so emission counts will not match the observable version. Angular ' +
          'documents this coalescing for toObservable specifically ("will only emit the ' +
          'value after the signal stabilizes"); extending it to signal reads generally is ' +
          'INFERRED, not documented. Either way, do not port logic that counts emissions.',
      ],
      sources: [DOCS.asyncOperations, DOCS.formLogic, DOCS.rxjsInterop, DOCS.essentials],
    },
  ],
  [
    'valueChangesAsyncPipeline',
    {
      construct: 'valueChangesAsyncPipeline',
      description:
        'HARD TIER — a form stream piped through switchMap / mergeMap / concatMap / ' +
        'combineLatest / withLatestFrom / forkJoin. These coordinate OTHER async sources and ' +
        'have no direct signal equivalent. There is no mechanical rewrite; pick a strategy.',
      before: `import { debounceTime, switchMap } from 'rxjs/operators';

this.results$ = this.form.valueChanges.pipe(
  debounceTime(300),
  switchMap((value) => this.http.get<Result[]>('/search?q=' + value.query)),
);`,
      after: `// THREE STRATEGIES — choose deliberately; none is a drop-in replacement.

// (A) The pipeline IS validation -> use the async validation rules. Cancellation,
//     pending state and error reporting are handled for you.
import { form, validateHttp } from '@angular/forms/signals';

readonly f = form(this.model, (path) => {
  validateHttp(path.username, {
    debounce: 300,
    request: ({ value }) => (value() ? \`/api/check?u=\${value()}\` : undefined),
    onSuccess: (r) => (r.available ? null : { kind: 'taken', message: 'Already taken' }),
    onError: () => ({ kind: 'serverError', message: 'Could not verify' }),
  });
});

// (B) The pipeline FETCHES DATA -> use a resource. rxResource keeps your existing
//     Observable-returning service.
import { rxResource } from '@angular/core/rxjs-interop';

readonly results = rxResource({
  params: () => this.f.query().value(),
  stream: ({ params }) => this.api.search(params),
});
// results.value() / results.isLoading() / results.error()

// (C) Genuinely need the operators -> keep RxJS at the edge. Bridge the signal out,
//     pipe as before, and bridge the result back in.
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { debounceTime, switchMap } from 'rxjs/operators';

private readonly query$ = toObservable(computed(() => this.f.query().value()));
readonly results = toSignal(
  this.query$.pipe(
    debounceTime(300),
    switchMap((q) => this.http.get<Result[]>('/search?q=' + q)),
  ),
  { initialValue: [] as Result[] },
);`,
      caveats: [
        STABILITY,
        "UNVERIFIED — tool-authored guidance. The v22 docs describe no migration path from valueChanges pipelines to signals: they never discuss operator equivalents, combineLatest, filter, or when to keep RxJS. The primitives used below (computed, effect, the debounce rule, toObservable/toSignal, rxResource) ARE documented and compile; the strategy for choosing between them is this tool's, not Angular's. Confirm on https://angular.dev/ecosystem/rxjs-interop before relying on it.",
        'DO NOT expect a mechanical rewrite. switchMap-style cancellation, ordering and ' +
          'multi-stream joins are exactly what signals do not model; anything claiming a ' +
          'one-liner equivalent is wrong.',
        'Pick by intent: (A) if the result decides validity, (B) if it fetches data to ' +
          'display, (C) if the operator semantics themselves are load-bearing.',
        'Strategy (C) is a legitimate destination, not a failure. toObservable/toSignal exist ' +
          'precisely so RxJS can stay where it is genuinely better.',
        'toObservable only emits after the signal STABILISES — set(1);set(2);set(3) emits just ' +
          '3. A pipeline that relied on seeing every intermediate value will not.',
        'toSignal subscribes immediately and unsubscribes automatically. `initialValue` is ' +
          'OPTIONAL, not required: without it the signal returns `undefined` until the ' +
          'Observable first emits, so the type includes undefined. Use `requireSync: true` ' +
          'only for sources guaranteed to emit synchronously, such as a BehaviorSubject.',
        'combineLatest over several form fields is usually just a computed() reading each ' +
          'field — check that before reaching for interop.',
      ],
      sources: [DOCS.rxjsInterop, DOCS.asyncOperations, DOCS.validation],
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
        MODEL_SHAPE,
        INCREMENTAL,
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
      sources: [DOCS.essentials, DOCS.models, DOCS.fieldState],
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
        'THE CONTEXT HAS THREE ACCESSORS, not one, and a group-level Reactive validator ' +
          'usually needs more than the first. `valueOf(path.other)` is another field’s VALUE; ' +
          '`stateOf(path.other)` is its STATE (so a rule can wait until a sibling is touched, ' +
          'or read its validity); `fieldTreeOf(path.other)` is the field itself, which is how ' +
          'you attach the error to a DIFFERENT field than the rule sits on. All three work ' +
          'across the whole form, not just the scoped path.',
        'To validate a whole subtree, or to report an error against a DIFFERENT field than the ' +
          'one the rule is attached to, use `validateTree()` and set the error’s `fieldTree`.',
        'WARNING, quoted: "be careful not to read state which depends on your field’s ' +
          'validation, as that creates a circular loop. For example, a validator which checks ' +
          'whether the parent field is valid will create an infinite loop." Reactive Forms ' +
          'tolerated `group.valid` inside a validator because the pass was imperative; ported ' +
          'literally, the same line hangs.',
        'Decide WHERE the error goes — the docs make this an explicit judgment call: "place ' +
          'the error where the user would most likely go to fix the problem". A Reactive ' +
          'group-level validator had no choice and dumped it on the group; you now do.',
        'An ASYNC validator is not covered by this recipe — `validateHttp()` / `validateAsync()` ' +
          'land in M2. Do not force an AsyncValidatorFn through validate().',
      ],
      sources: [DOCS.validation, DOCS.crossField],
    },
  ],
];

const RECIPES: ReadonlyMap<string, Recipe> = new Map(
  RECIPE_DRAFTS.map(([construct, draft]) => [construct, withProvenance(draft)]),
);

/** Spellings a caller might type, mapped to a canonical RECIPES key. */
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
  ['formarray', 'FormArray'],
  ['fb.array', 'FormArray'],
  ['formbuilder.array', 'FormArray'],
  // Every shape-mutating method resolves to the one design-change recipe.
  ['formgroup.addcontrol', 'dynamicControls'],
  ['formgroup.removecontrol', 'dynamicControls'],
  ['formgroup.setcontrol', 'dynamicControls'],
  ['formgroup.registercontrol', 'dynamicControls'],
  ['addcontrol', 'dynamicControls'],
  ['removecontrol', 'dynamicControls'],
  ['setcontrol', 'dynamicControls'],
  ['registercontrol', 'dynamicControls'],
  ['dynamiccontrols', 'dynamicControls'],
  ['formarray.push', 'FormArray'],
  ['formarray.removeat', 'FormArray'],
  ['formarray.insert', 'FormArray'],
  ['formarray.clear', 'FormArray'],
  ['formarray.setcontrol', 'FormArray'],
  // Reading state off a form -> signal calls on the field tree.
  ['abstractcontrol.value', 'formStateRead'],
  ['abstractcontrol.length', 'formStateRead'],
  ['abstractcontrol.valid', 'formStateRead'],
  ['abstractcontrol.invalid', 'formStateRead'],
  ['abstractcontrol.errors', 'formStateRead'],
  ['abstractcontrol.touched', 'formStateRead'],
  ['abstractcontrol.dirty', 'formStateRead'],
  ['abstractcontrol.pristine', 'formStateRead'],
  ['abstractcontrol.pending', 'formStateRead'],
  ['abstractcontrol.controls', 'formStateRead'],
  ['abstractcontrol.status', 'formStateRead'],
  ['formstateread', 'formStateRead'],
  // Writing to a form -> the model signal, or a schema rule.
  ['abstractcontrol.setvalue', 'formStateWrite'],
  ['abstractcontrol.patchvalue', 'formStateWrite'],
  ['abstractcontrol.reset', 'formStateWrite'],
  ['abstractcontrol.defaultvalue', 'formStateWrite'],
  ['abstractcontrol.getrawvalue', 'formStateWrite'],
  ['abstractcontrol.haserror', 'formStateRead'],
  ['abstractcontrol.markastouched', 'formStateWrite'],
  ['abstractcontrol.markallastouched', 'formStateWrite'],
  ['abstractcontrol.markasuntouched', 'formStateWrite'],
  ['abstractcontrol.markasdirty', 'formStateWrite'],
  ['abstractcontrol.markaspristine', 'formStateWrite'],
  ['abstractcontrol.markaspending', 'formStateWrite'],
  // setErrors() is almost always a server rejection, and that has its own documented home.
  ['abstractcontrol.seterrors', 'formSubmission'],
  ['seterrors', 'formSubmission'],
  ['formsubmission', 'formSubmission'],
  // The ng-* class loss has no Reactive Forms *construct* to detect — it lives in CSS —
  // so these spellings are how an agent or a human reaches it.
  ['testing', 'testing'],
  ['spec', 'testing'],
  ['specs', 'testing'],
  ['test', 'testing'],
  ['tests', 'testing'],
  ['unittest', 'testing'],
  // Template bindings. The directive family collapses to [formField], so they share the
  // flagship recipe; the array, select-multiple and ngModel cases have their own.
  ['template.formcontrolname', 'templateBindings'],
  ['template.formcontrol', 'templateBindings'],
  ['template.formgroup', 'templateBindings'],
  ['template.formgroupname', 'templateBindings'],
  ['template.nativeattribute', 'templateBindings'],
  ['template.errorkeyrename', 'templateBindings'],
  ['formcontrolname', 'templateBindings'],
  ['formgroupname', 'templateBindings'],
  ['formroot', 'templateBindings'],
  ['formfield', 'templateBindings'],
  ['template', 'templateBindings'],
  ['templatebindings', 'templateBindings'],
  ['template.formarrayname', 'Template.formArrayName'],
  ['formarrayname', 'Template.formArrayName'],
  ['template.selectmultiple', 'Template.selectMultiple'],
  ['selectmultiple', 'Template.selectMultiple'],
  ['select', 'Template.selectMultiple'],
  ['template.ngmodel', 'Template.ngModel'],
  ['ngmodel', 'Template.ngModel'],
  ['statusclasses', 'statusClasses'],
  ['ng-invalid', 'statusClasses'],
  ['ng-valid', 'statusClasses'],
  ['ng-touched', 'statusClasses'],
  ['ng-dirty', 'statusClasses'],
  ['ng-pristine', 'statusClasses'],
  ['cssclasses', 'statusClasses'],
  ['styling', 'statusClasses'],
  ['submit', 'formSubmission'],
  ['submission', 'formSubmission'],
  ['onsubmit', 'formSubmission'],
  ['abstractcontrol.updatevalueandvalidity', 'formStateWrite'],
  ['abstractcontrol.enable', 'formStateWrite'],
  ['abstractcontrol.disable', 'formStateWrite'],
  ['abstractcontrol.setvalidators', 'formStateWrite'],
  ['abstractcontrol.addvalidators', 'formStateWrite'],
  ['abstractcontrol.removevalidators', 'formStateWrite'],
  ['abstractcontrol.clearvalidators', 'formStateWrite'],
  ['abstractcontrol.setasyncvalidators', 'formStateWrite'],
  ['formstatewrite', 'formStateWrite'],
  ['patchvalue', 'formStateWrite'],
  ['setvalue', 'formStateWrite'],
  ['markalltastouched', 'formStateWrite'],
  ['controlvalueaccessor', 'ControlValueAccessor'],
  ['cva', 'ControlValueAccessor'],
  ['ng_value_accessor', 'ControlValueAccessor'],
  ['formvaluecontrol', 'ControlValueAccessor'],
  ['formcheckboxcontrol', 'ControlValueAccessor'],
  ['valuechanges', 'valueChanges'],
  ['statuschanges', 'valueChanges'],
  ['valuechangespipeline', 'valueChangesPipeline'],
  ['statuschangespipeline', 'valueChangesPipeline'],
  ['valuechangesasyncpipeline', 'valueChangesAsyncPipeline'],
  ['statuschangesasyncpipeline', 'valueChangesAsyncPipeline'],
  ['tosignal', 'valueChangesAsyncPipeline'],
  ['toobservable', 'valueChangesAsyncPipeline'],
  ['deadvalidatoroption', 'deadValidatorOption'],
  ['validator', 'deadValidatorOption'],
  ['asyncvalidatorfn', 'asyncValidator'],
  ['asyncvalidators', 'asyncValidator'],
  ['validatehttp', 'asyncValidator'],
  ['validateasync', 'asyncValidator'],
  ['get', 'AbstractControl.get'],
  ['.get', 'AbstractControl.get'],
  ['abstractcontrol.get', 'AbstractControl.get'],
  // at()/contains() are the same problem as get(): a keyed lookup into what is now a typed
  // object. at() goes to the FormArray recipe because index access is an array concern.
  ['abstractcontrol.at', 'FormArray'],
  ['abstractcontrol.contains', 'AbstractControl.get'],
  ['formarray.at', 'FormArray'],
  ['formgroup.contains', 'AbstractControl.get'],
  ['formgroup.get', 'AbstractControl.get'],
  ['customvalidator', 'customValidator'],
  ['validatorfn', 'customValidator'],
  ['custom validator', 'customValidator'],
]);

/** Folds case, whitespace and a trailing `()` so equivalent spellings match. */
function normalise(construct: string): string {
  return construct
    .trim()
    .replace(/\(\s*\)$/, '')
    .trim()
    .toLowerCase();
}

/** Every recipe, for auditing. Order follows `availableConstructs()`. */
export function allRecipes(): readonly Recipe[] {
  return availableConstructs().map((construct) => {
    const recipe = RECIPES.get(construct);
    // Unreachable: availableConstructs() is derived from RECIPES' own keys.
    if (recipe === undefined) throw new Error(`missing recipe for ${construct}`);
    return recipe;
  });
}

/** Canonical construct names this server has a recipe for, sorted for stable output. */
export function availableConstructs(): readonly string[] {
  return [...RECIPES.keys()].sort((a, b) => a.localeCompare(b));
}

/** Looks up a recipe. Never throws; an unknown construct returns `{ found: false }` with the keys. */
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
