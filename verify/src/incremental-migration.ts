/**
 * Compile fixture for the documented INCREMENTAL migration paths.
 *
 * The recipes carried one sentence, repeated in seven of them: "Signal Forms has no
 * standalone control objects. Migrate a whole form at once, not control by control."
 *
 * Both halves are wrong. `SignalFormControl` is a standalone signal-forms control object,
 * stable in v22, and the migration guide's "Bottom-up migration" section exists precisely to
 * migrate leaf nodes one at a time while the parent FormGroup stays reactive. Telling an
 * agent to convert a 47-field form in one commit, when Angular ships a field-at-a-time path,
 * is the most expensive kind of wrong advice.
 *
 * Both directions are compiled here so the claim cannot regress into prose again.
 */
import { signal } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { required, email, provideSignalFormsConfig, type FieldTree } from '@angular/forms/signals';
import {
  compatForm,
  extractValue,
  NG_STATUS_CLASSES,
  SignalFormControl,
} from '@angular/forms/signals/compat';

/* ---- Bottom-up: a signal-driven leaf inside a reactive FormGroup ---------- */

/** One field migrated. The parent group, and everything else in it, stays reactive. */
export const emailControl = new SignalFormControl('', (path) => {
  required(path, { message: 'Email is required' });
  email(path, { message: 'Enter a valid email address' });
});

export const partiallyMigrated = new FormGroup({
  // Migrated to Signal Forms...
  email: emailControl,
  // ...while these are untouched.
  password: new FormControl(''),
});

/** The signal-forms side of the same control is reachable as a field tree. */
export const emailField: FieldTree<string> = emailControl.fieldTree;

/* ---- Top-down: a reactive control read through the signal-forms API ------- */

/**
 * compatForm takes a model whose LEAVES may be reactive controls — it does not wrap a
 * FormGroup. Getting this wrong is easy: the first attempt here passed `signal(formGroup)`
 * and produced a `FieldTree<FormGroup<...>>` with no `street` member. The compiler caught
 * it; prose would not have.
 */
const legacyCity = new FormControl('');

const addressModel = signal({
  street: '',
  // A reactive control living inside a signal-forms model.
  city: legacyCity,
});

export const wrapped = compatForm(addressModel, (path) => {
  required(path.street);
});

/** The field yields the control's VALUE, not the FormControl itself. */
export function readThroughCompat(): string | null {
  return wrapped.city().value();
}

/* -------------------------------------------------------------------------- */
/* CSS status classes — the silent, app-wide regression                        */
/* -------------------------------------------------------------------------- */

/**
 * "Reactive/Template Forms automatically adds class attributes (such as `.ng-valid` or
 * `.ng-dirty`) to facilitate styling control states. Signal Forms does not do that."
 *
 * Nothing catches this: it type-checks, it compiles, the tests pass, and every stylesheet
 * rule targeting .ng-invalid / .ng-touched simply stops matching. The whole app loses its
 * error styling the moment a form is migrated.
 *
 * The documented opt-in is one provider, compiled here.
 */
export const RESTORE_STATUS_CLASSES = provideSignalFormsConfig({ classes: NG_STATUS_CLASSES });

/** Or a hand-rolled map, when only some classes are wanted. */
export const CUSTOM_STATUS_CLASSES = provideSignalFormsConfig({
  classes: {
    'ng-valid': ({ state }) => state().valid(),
    'ng-invalid': ({ state }) => state().invalid(),
    'ng-touched': ({ state }) => state().touched(),
    'ng-dirty': ({ state }) => state().dirty(),
  },
});

/** extractValue() unwraps a field tree — the replacement for getRawValue(). */
export function rawValue(): { street: string; city: string | null } {
  return extractValue(wrapped);
}

/** With a filter, it returns only the fields matching a state — "submit just the dirty ones". */
export function dirtyOnly(): unknown {
  return extractValue(wrapped, { dirty: true });
}
