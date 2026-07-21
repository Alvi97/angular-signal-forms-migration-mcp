/**
 * Compile fixture for the recipes with a distinct API surface: custom controls
 * (ControlValueAccessor -> FormValueControl), async validation, and RxJS interop.
 */
import { Component, computed, input, model, output, signal, type OutputRef } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { debounceTime, map, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import {
  debounce,
  form,
  required,
  validateHttp,
  type FormUiControl,
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

/* -------------------------------------------------------------------------- */
/* Custom control member names — where the guide and the API page disagree     */
/* -------------------------------------------------------------------------- */

/**
 * The custom-controls guide says "the `touched` property uniquely supports `input()`, or
 * `OutputRef` depending on your needs", and its property table lists `valid`.
 *
 * The type declarations say otherwise on both counts, and they are what compiles. `touched`
 * is an input only; the OutputRef is a SEPARATE member called `touch`. There is no `valid`
 * member at all — validity is read through `invalid`, `pending` and `errors`.
 *
 * Encoded as type-level assertions rather than prose because a recipe that repeats the
 * guide here produces a component that silently never reports being touched.
 */
type DeclaredOn<K extends string> = K extends keyof FormUiControl<string> ? true : false;

export const TOUCHED_IS_DECLARED: DeclaredOn<'touched'> = true;
export const TOUCH_IS_DECLARED: DeclaredOn<'touch'> = true;
// @ts-expect-error FormUiControl declares no `valid` member, though the guide's table lists one.
export const VALID_IS_DECLARED: DeclaredOn<'valid'> = true;

/** `touched` will not accept an OutputRef — that is what `touch` is for. */
// @ts-expect-error the OutputRef member is `touch`, not `touched`.
export const TOUCHED_TAKES_AN_OUTPUT: FormUiControl<string>['touched'] = {} as OutputRef<void>;
