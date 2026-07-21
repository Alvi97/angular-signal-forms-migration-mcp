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
  form,
  FormField,
  hidden,
  min,
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
  });

  readonly f = form(this.model, (path) => {
    required(path.title, { message: 'Title is required' });
    applyEach(path.items, itemSchema);
    disabled(path.coupon, { when: ({ valueOf }) => valueOf(path.total) < 50 });
    hidden(path.coupon, { when: () => false });
    validate(path.title, ({ value }) => (value().length > 2 ? null : { kind: 'tooShort' }));
  });

  readonly isInvalid = computed(() => this.f().invalid());
  readonly firstItemName = computed(() => this.f.items[0].name().value());

  submitIt(): void {
    void submit(this.f, { action: async () => Promise.resolve() });
  }
}
