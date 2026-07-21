/**
 * Compile fixture for the two highest-risk recipes: `formStateRead` and `formStateWrite`.
 *
 * Together they are ~23% of findings on a real production codebase, and they were the last
 * recipes written — least researched, least reviewed. Everything the recipes claim about
 * reading and writing form state is exercised here against real @angular/forms v22.
 */
// Also referenced by the deadValidatorOption recipe, which shows the pre-migration fix
// in Reactive Forms before the Signal Forms rewrite.
import { Validators } from '@angular/forms';
import { computed, signal } from '@angular/core';
import { applyWhen, disabled, form, required, submit } from '@angular/forms/signals';

interface Model {
  name: string;
  email: string;
  code: string;
  address: { street: string; city: string };
}

const INITIAL: Model = { name: '', email: '', code: '', address: { street: '', city: '' } };

export const legacyValidators = Validators.required;

export class ProfileFixture {
  readonly model = signal<Model>({ ...INITIAL });
  readonly isLocked = signal(false);

  readonly f = form(
    this.model,
    (path) => {
      required(path.name);
      // enable()/disable() -> the disabled() rule. v22 takes an options object.
      disabled(path.code, { when: () => this.isLocked() });
      // setValidators() -> applyWhen().
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
          await Promise.resolve();
          // reset() exists on field state and clears touched/dirty.
          f().reset({ ...INITIAL });
        },
      },
    },
  );

  /* ---- formStateRead: every claimed read ------------------------------- */

  readonly wholeFormInvalid = computed(() => this.f().invalid());
  readonly wholeFormValid = computed(() => this.f().valid());
  readonly fieldErrors = computed(() => this.f.name().errors());
  readonly touched = computed(() => this.f.name().touched());
  readonly dirty = computed(() => this.f().dirty());
  readonly pending = computed(() => this.f.email().pending());
  readonly disabledState = computed(() => this.f.code().disabled());
  // form.controls['x'] -> real property access; nested groups by dot notation.
  readonly street = computed(() => this.f.address.street().value());
  // The whole value is the model signal itself, not f().value().
  readonly whole = computed(() => this.model());

  /* ---- formStateWrite: every claimed write ------------------------------ */

  setOneField(value: string): void {
    this.f.email().value.set(value);
  }

  patchLikeUpdate(name: string): void {
    this.model.update((current) => ({ ...current, name }));
  }

  submitIt(): void {
    // markAllAsTouched() disappears — submit() marks every field touched itself.
    void submit(this.f);
  }
}

/**
 * Imperative field-state APIs, split by what actually exists.
 *
 * An audit found the recipes claiming markAsTouched and markAsDirty had "no counterpart".
 * They do. Compiling them here makes that claim machine-enforced rather than a belief —
 * and if a future Angular removes them, this fixture goes red instead of the docs quietly
 * drifting from the advice.
 */
export function imperativeStateThatExists(fixture: ProfileFixture): void {
  fixture.f().markAsTouched();
  fixture.f().markAsTouched({ skipDescendants: true });
  fixture.f.name().markAsDirty();
  fixture.f().reset();
  fixture.f().reset({ name: '', email: '', code: '', address: { street: '', city: '' } });
}
