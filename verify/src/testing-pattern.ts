/**
 * Compile fixture for the `testing` recipe.
 *
 * Specs are the one file class with their own migration rules, and the first of them is a
 * hard blocker: a signal form needs an injection context to construct, where
 * `new FormGroup({...})` needed nothing. Both documented ways of supplying one are compiled
 * here, so the recipe cannot drift from what actually builds.
 */
import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { email, form, minLength, required, schema } from '@angular/forms/signals';

interface Credentials {
  email: string;
  password: string;
}

const credentialsSchema = schema<Credentials>((path) => {
  required(path.email);
  email(path.email);
  minLength(path.password, 8);
});

/** Option 1: hand form() an injector explicitly. */
export function withExplicitInjector(): boolean {
  const model = signal<Credentials>({ email: '', password: '' });
  const f = form(model, credentialsSchema, { injector: TestBed.inject(Injector) });

  model.set({ email: 'a@b.com', password: 'short' });

  // The error kind is 'minLength' — reactive forms spelled it 'minlength'.
  return f().invalid() && f.password().getError('minLength') !== undefined;
}

/** Option 2: build the form inside an injection context. */
export function withRunInInjectionContext(): boolean {
  const model = signal<Credentials>({ email: '', password: '' });
  const f = TestBed.runInInjectionContext(() => form(model, credentialsSchema));

  // Writes in a test go through the signal, not setValue().
  f.email().value.set('someone@example.com');

  return f.email().value() === 'someone@example.com';
}
