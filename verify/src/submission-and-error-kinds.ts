/**
 * Compile fixture for the two things a live migration needed and the recipes did not state:
 * the error `kind` strings, and how a server rejection reaches a field.
 *
 * Both were found by watching an agent migrate a real login form. It had to read
 * node_modules to discover the kinds, and it hand-rolled a replacement for `setErrors()`
 * because the recipe said only that there was none.
 */
import { signal } from '@angular/core';
import {
  type EmailValidationError,
  type MaxLengthValidationError,
  type MaxValidationError,
  type MinLengthValidationError,
  type MinValidationError,
  type NativeInputParseError,
  type PatternValidationError,
  type RequiredValidationError,
  email,
  form,
  maxLength,
  minLength,
  required,
  submit,
} from '@angular/forms/signals';

/* -------------------------------------------------------------------------- */
/* Error kinds                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The exact string each built-in rule puts in `error.kind`.
 *
 * A template that keeps the Reactive Forms key compiles fine and silently never matches,
 * so the error message just stops appearing. Pinning the kinds here means a rename in a
 * future Angular breaks this fixture instead of breaking users' error messages quietly.
 */
export const REQUIRED_KIND: RequiredValidationError['kind'] = 'required';
export const EMAIL_KIND: EmailValidationError['kind'] = 'email';
export const MIN_KIND: MinValidationError['kind'] = 'min';
export const MAX_KIND: MaxValidationError['kind'] = 'max';
export const MIN_LENGTH_KIND: MinLengthValidationError['kind'] = 'minLength';
export const MAX_LENGTH_KIND: MaxLengthValidationError['kind'] = 'maxLength';
export const PATTERN_KIND: PatternValidationError['kind'] = 'pattern';
/** No Reactive Forms equivalent: a native input whose text cannot be parsed to the model type. */
export const PARSE_KIND: NativeInputParseError['kind'] = 'parse';

/**
 * The casing change, asserted rather than described.
 *
 * `Validators.minLength` reported `{ minlength: … }` — all lowercase; the typings' own
 * example says so. Signal Forms reports `minLength`. If these ever converge, the
 * @ts-expect-error goes unused and the fixture fails, which is the correct outcome: the
 * recipe warning would then be wrong.
 */
// @ts-expect-error Reactive Forms spelled this 'minlength'; Signal Forms does not.
export const NOT_THE_REACTIVE_SPELLING: MinLengthValidationError['kind'] = 'minlength';
// @ts-expect-error Reactive Forms spelled this 'maxlength'; Signal Forms does not.
export const NOT_THE_REACTIVE_SPELLING_MAX: MaxLengthValidationError['kind'] = 'maxlength';

/* -------------------------------------------------------------------------- */
/* Submission errors — the documented replacement for setErrors()              */
/* -------------------------------------------------------------------------- */

interface Credentials {
  email: string;
  password: string;
}

declare function signIn(
  credentials: Credentials,
): Promise<{ ok: true } | { ok: false; message: string }>;

export class LoginFixture {
  readonly model = signal<Credentials>({ email: '', password: '' });

  readonly f = form(
    this.model,
    (path) => {
      required(path.email);
      email(path.email);
      required(path.password);
      minLength(path.password, 8);
      maxLength(path.password, 128);
    },
    {
      submission: {
        // Returning an error object routes it to a field. `fieldTree` takes the field
        // itself, not a path string. Returning nothing means success.
        action: async (f) => {
          const result = await signIn(f().value());
          if (result.ok) return;
          return { kind: 'invalidCredentials', message: result.message, fieldTree: f.password };
        },
        // Runs when submit() is called while the form is invalid — after every interactive
        // field has been marked touched, so the errors are already on screen.
        onInvalid: (f) => {
          const first = f().errorSummary()[0];
          first?.fieldTree().focusBoundControl();
        },
      },
    },
  );

  /** True while the action is running: replaces a hand-maintained isSubmitting flag. */
  readonly submitting = (): boolean => this.f().submitting();

  async signIn(): Promise<boolean> {
    return submit(this.f);
  }
}

/* -------------------------------------------------------------------------- */
/* Reading errors the way a template can                                       */
/* -------------------------------------------------------------------------- */

/**
 * `getError(kind)` — the template-callable replacement for `errors?.['required']`.
 *
 * Worth pinning because the obvious translation, `errors().some(e => e.kind === '…')`,
 * cannot be written in an Angular template at all (no arrow functions), which pushes people
 * into building a `computed` index per field. This needs neither.
 *
 * It also narrows: asking for 'minLength' yields the error carrying the bound.
 */
export function readErrorsWithoutAnArrowFunction(fixture: LoginFixture): {
  missing: boolean;
  requiredLength: number | undefined;
} {
  return {
    missing: fixture.f.email().getError('required') !== undefined,
    requiredLength: fixture.f.password().getError('minLength')?.minLength,
  };
}

/** Errors on several fields at once: return an array. */
export async function multiFieldSubmission(fixture: LoginFixture): Promise<boolean> {
  return submit(fixture.f, async (f) => [
    { kind: 'serverError', message: 'Unknown account', fieldTree: f.email },
    { kind: 'serverError', message: 'Try again', fieldTree: f.password },
  ]);
}
