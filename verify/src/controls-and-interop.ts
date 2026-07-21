/**
 * Compile fixture for the recipes with a distinct API surface: custom controls
 * (ControlValueAccessor -> FormValueControl), async validation, and RxJS interop.
 */
import { Component, computed, input, model, output, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { debounceTime, map, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import {
  debounce,
  form,
  required,
  validateHttp,
  type FormValueControl,
  type ValidationError,
} from '@angular/forms/signals';

/* ---- ControlValueAccessor -> FormValueControl --------------------------- */

@Component({ selector: 'app-rating', template: '' })
export class RatingInput implements FormValueControl<number> {
  // The only required member.
  readonly value = model<number>(0);

  // Optional state inputs the recipe lists.
  readonly disabled = input<boolean>(false);
  readonly readonly = input<boolean>(false);
  readonly invalid = input<boolean>(false);
  readonly errors = input<readonly ValidationError[]>([]);
  readonly touched = input<boolean>(false);
  readonly touch = output<void>();

  rate(next: number): void {
    this.value.set(next);
  }
}

/* ---- async validation + the debounce() schema rule ---------------------- */

interface SearchModel {
  username: string;
  query: string;
}

export class RegistrationFixture {
  readonly model = signal<SearchModel>({ username: '', query: '' });

  readonly f = form(this.model, (path) => {
    required(path.username);
    // The schema-level debounce rule (delays the commit to the model).
    debounce(path.query, 300);
    // Commit only on blur.
    debounce(path.username, 'blur');

    validateHttp(path.username, {
      // The validator's own debounce option — a different layer to the rule above.
      debounce: 300,
      request: ({ value }) => (value() ? `/api/check?u=${value()}` : undefined),
      onSuccess: (response: { available: boolean }) =>
        response.available ? null : { kind: 'usernameTaken', message: 'Taken' },
      onError: () => ({ kind: 'serverError', message: 'Could not verify' }),
    });
  });

  /* ---- RxJS interop: the hard-tier escape hatch ------------------------- */

  private readonly query$ = toObservable(computed(() => this.f.query().value()));

  readonly results = toSignal(
    this.query$.pipe(
      debounceTime(300),
      map((q) => q.trim()),
      switchMap((q) => of([q])),
    ),
    { initialValue: [] as string[] },
  );
}
