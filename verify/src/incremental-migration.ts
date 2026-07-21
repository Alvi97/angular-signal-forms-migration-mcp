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
import { required, email, type FieldTree } from '@angular/forms/signals';
import { compatForm, SignalFormControl } from '@angular/forms/signals/compat';

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
