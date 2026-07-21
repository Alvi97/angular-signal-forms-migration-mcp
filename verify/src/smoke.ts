/**
 * Smoke fixture — the API shape the recipes claim, compiled against real @angular/forms v22.
 *
 * If a recipe names a function that does not exist, or calls it with the wrong argument
 * shape, this file fails to compile and the suite goes red.
 */
import { Component, computed, signal } from '@angular/core';
import {
  apply,
  applyEach,
  disabled,
  email,
  form,
  FormField,
  hidden,
  max,
  maxLength,
  min,
  minLength,
  pattern,
  required,
  schema,
  submit,
  validate,
} from '@angular/forms/signals';

interface Address {
  street: string;
  city: string;
}
interface Item {
  name: string;
  quantity: number;
  address: Address;
}
interface Model {
  title: string;
  items: Item[];
  total: number;
  coupon: string;
  email: string;
  age: number;
  bio: string;
  phone: string;
}

const addressSchema = schema<Address>((a) => {
  required(a.street);
  required(a.city);
});

// Group inside an array item — one of the nested compositions the docs never show.
const itemSchema = schema<Item>((item) => {
  required(item.name);
  min(item.quantity, 1);
  apply(item.address, addressSchema);
});

@Component({ selector: 'app-smoke', template: '', imports: [FormField] })
export class Smoke {
  readonly model = signal<Model>({
    title: '',
    items: [{ name: '', quantity: 1, address: { street: '', city: '' } }],
    total: 0,
    coupon: '',
    email: '',
    age: 0,
    bio: '',
    phone: '',
  });

  readonly f = form(this.model, (path) => {
    required(path.title, { message: 'Title is required' });
    applyEach(path.items, itemSchema);
    disabled(path.coupon, { when: ({ valueOf }) => valueOf(path.total) < 50 });
    hidden(path.coupon, { when: () => false });
    validate(path.title, ({ value }) => (value().length > 2 ? null : { kind: 'tooShort' }));

    // Every built-in validator the recipes reference, called with the arguments they
    // show — so the SIGNATURES are compile-checked, not just the symbols' existence.
    email(path.email, { message: 'Enter a valid email address' });
    min(path.age, 18, { message: 'You must be at least 18 years old' });
    max(path.age, 120, { message: 'Please enter a valid age' });
    minLength(path.bio, 8, { message: 'Too short' });
    maxLength(path.bio, 500, { message: 'Bio cannot exceed 500 characters' });
    pattern(path.phone, /^\d{3}-\d{3}-\d{4}$/, {
      message: 'Phone must be in format: 555-123-4567',
    });
  });

  readonly isInvalid = computed(() => this.f().invalid());
  readonly firstItemName = computed(() => this.f.items[0].name().value());

  submitIt(): void {
    void submit(this.f, { action: async () => Promise.resolve() });
  }
}
