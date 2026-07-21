/**
 * Compile fixture for the model-shape rules and the full field context.
 *
 * A coverage audit found these documented and completely unmentioned by the recipes. They
 * matter because every one of them fails QUIETLY: the model type-checks, the form builds,
 * and a field is simply missing or a control is simply broken.
 */
import { signal } from '@angular/core';
import {
  applyWhenValue,
  disabled,
  form,
  hidden,
  minLength,
  readonly,
  required,
  schema,
  validate,
  validateTree,
} from '@angular/forms/signals';

/* -------------------------------------------------------------------------- */
/* Model shape                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The empty value for a text field is `''`, not `null`.
 *
 * `new FormControl()` and `fb.control(null)` both produce `null`, so the mechanical
 * translation puts `null` in the model — and the docs say native text controls "don't
 * support null". Typed here so a `null` would be a compile error rather than a broken input.
 */
interface Profile {
  name: string;
  email: string;
  // A `number | null` is fine — number inputs do accept null for "empty".
  age: number | null;
  // Dates are their own decision; a native date input round-trips a YYYY-MM-DD string.
  birthday: string;
  tags: string[];
  address: { street: string; city: string };
}

const EMPTY_PROFILE: Profile = {
  name: '',
  email: '',
  age: null,
  birthday: '',
  tags: [],
  address: { street: '', city: '' },
};

export const profileModel = signal<Profile>({ ...EMPTY_PROFILE });

/**
 * Optional properties are NOT the way to model an empty field.
 *
 * "Fields set to `undefined` are excluded from the field tree" — so a model reusing a DTO
 * with `email?: string` loses the field, and every rule targeting it silently never runs.
 * Proven here: an optional property makes the path unusable.
 */
interface OptionalDto {
  nickname?: string;
}
const optionalModel = signal<OptionalDto>({});
export const optionalForm = form(optionalModel, (path) => {
  // @ts-expect-error a `string | undefined` path is not a valid target for minLength().
  minLength(path.nickname, 2);
});

/* -------------------------------------------------------------------------- */
/* The field context: valueOf / stateOf / fieldTreeOf                          */
/* -------------------------------------------------------------------------- */

/**
 * Cross-field migration needs all three, not just `valueOf`.
 *
 * A Reactive Forms group validator reached siblings through `group.get('x')` and could read
 * their value, their state, and attach an error to them. `valueOf` alone covers only the
 * first of those.
 */
export const profileSchema = schema<Profile>((path) => {
  required(path.name);
  required(path.email);

  // valueOf — another field's raw value.
  validate(path.email, ({ value, valueOf }) =>
    value().includes(valueOf(path.name)) ? { kind: 'emailContainsName' } : null,
  );

  // stateOf — another field's STATE, so a rule can wait until a sibling is touched.
  validate(path.email, ({ stateOf }) =>
    stateOf(path.name).touched() && !stateOf(path.name).valid() ? { kind: 'fixNameFirst' } : null,
  );

  // fieldTreeOf — targets the error at a sibling, which is what a group-level
  // Reactive validator could never do.
  validateTree(path, ({ value, fieldTreeOf }) =>
    value().address.city === ''
      ? [{ kind: 'cityRequired', fieldTree: fieldTreeOf(path.address.city) }]
      : null,
  );

  // Non-interactive states. All three skip validation; the value is preserved.
  disabled(path.birthday, { when: ({ valueOf }) => valueOf(path.age) === null });
  hidden(path.tags, { when: () => false });
  readonly(path.email, { when: () => false });
});

export const profileForm = form(profileModel, profileSchema);

/* -------------------------------------------------------------------------- */
/* Static shape + narrowing, instead of a model that changes shape             */
/* -------------------------------------------------------------------------- */

interface Payment {
  method: 'card' | 'bank';
  cardNumber: string;
  accountNumber: string;
}

const paymentModel = signal<Payment>({ method: 'card', cardNumber: '', accountNumber: '' });

/**
 * The documented answer to `addControl`/`removeControl`: one static model covering every
 * branch, with the inactive branch hidden. A model whose SHAPE changes causes data loss.
 */
export const paymentForm = form(paymentModel, (path) => {
  hidden(path.accountNumber, { when: ({ valueOf }) => valueOf(path.method) !== 'bank' });
  hidden(path.cardNumber, { when: ({ valueOf }) => valueOf(path.method) !== 'card' });

  applyWhenValue(
    path,
    (value): value is Payment & { method: 'card' } => value.method === 'card',
    (cardPath) => {
      required(cardPath.cardNumber);
    },
  );
});
