import { describe, expect, it } from 'vitest';
import { detectInSource } from '../src/core/detect.js';
import type { Finding } from '../src/core/types.js';

/**
 * Calls made on a CONTROL rather than on the form object.
 *
 * Found by running the server against a real migration: mockio-master's login component
 * ends a failed sign-in with
 *
 *     this.loginForm.get('password')?.setErrors({ invalidCredentials: true });
 *
 * and the file was reported as 100% mechanical. Only the `.get()` matched; the
 * no-counterpart `setErrors()` hanging off it did not, because the receiver was a call
 * expression rather than a bound form name. The migrating agent caught it by eye.
 *
 * Under-reporting difficulty is the worst failure this tool has: "all mechanical" is read
 * as "safe transliteration", and these are the calls that are not.
 */
function constructs(source: string): string[] {
  return detectInSource('login.component.ts', source).map((f) => f.construct);
}

function find(source: string, construct: string): Finding | undefined {
  return detectInSource('login.component.ts', source).find((f) => f.construct === construct);
}

const HEADER = `import { FormBuilder, FormGroup } from '@angular/forms';

export class LoginComponent {
  loginForm: FormGroup;
  constructor(private fb: FormBuilder) {
    this.loginForm = this.fb.group({ email: [''], password: [''] });
  }
`;

const wrap = (body: string): string => `${HEADER}\n  run(): void {\n    ${body}\n  }\n}\n`;

describe('calls on a control reached through the form', () => {
  it.each([
    ["this.loginForm.get('password')?.setErrors({ invalid: true });", 'setErrors'],
    ["this.loginForm.get('password')!.setErrors({ invalid: true });", 'setErrors'],
    ['this.loginForm.controls.password.markAllAsTouched();', 'markAllAsTouched'],
    ["this.loginForm.controls['password'].disable();", 'disable'],
    ["this.loginForm.get('address')?.get('city')?.enable();", 'enable'],
  ])('%s reports %s', (body, method) => {
    expect(constructs(wrap(body))).toContain(`AbstractControl.${method}`);
  });

  it('classifies the no-counterpart call as judgment, not mechanical', () => {
    const source = wrap("this.loginForm.get('password')?.setErrors({ invalid: true });");
    expect(find(source, 'AbstractControl.setErrors')?.classification).toBe('judgment');
  });

  it('still reports the .get() itself, since that is a separate edit', () => {
    const source = wrap("this.loginForm.get('password')?.setErrors({ invalid: true });");
    expect(constructs(source)).toContain('AbstractControl.get');
  });

  it('does not match calls on something that is not a form', () => {
    const source = `import { FormGroup } from '@angular/forms';

export class C {
  private cache = new Map<string, string>();
  run(): void {
    this.cache.get('k')?.trim();
  }
}
`;
    expect(constructs(source)).not.toContain('AbstractControl.get');
  });
});

/**
 * The per-control getter is the standard way to reach a control from a template, so it is
 * also how components reach it from TypeScript. An alias is not itself typed as a form,
 * which made every call through one invisible.
 */
describe('per-control getter aliases', () => {
  const withGetter = (body: string): string =>
    `${HEADER}
  get password() { return this.loginForm.get('password'); }

  run(): void {
    ${body}
  }
}
`;

  it('resolves this.password back to the form', () => {
    expect(constructs(withGetter('this.password?.setErrors({ invalid: true });'))).toContain(
      'AbstractControl.setErrors',
    );
  });

  it('resolves state reads through the alias', () => {
    expect(constructs(withGetter('const v = this.password?.value;'))).toContain(
      'AbstractControl.value',
    );
  });

  it('resolves an alias defined in terms of another alias', () => {
    const source = `${HEADER}
  get password() { return this.loginForm.get('password'); }
  get confirmation() { return this.password; }

  run(): void {
    this.confirmation?.markAsPristine();
  }
}
`;
    expect(constructs(source)).toContain('AbstractControl.markAsPristine');
  });

  it('leaves unrelated getters alone', () => {
    const source = `import { FormGroup } from '@angular/forms';

export class C {
  form = new FormGroup({});
  private map = new Map<string, string>();
  get entry() { return this.map.get('k'); }

  run(): void {
    this.entry?.trim();
  }
}
`;
    expect(constructs(source)).not.toContain('AbstractControl.get');
  });
});

/**
 * Two receiver-resolution gaps found by a corpus run across six real Angular repos.
 *
 * Both under-report DIFFICULTY — they miss judgment-tier calls — which is the worst way for
 * this tool to be wrong: "all mechanical" reads as "safe transliteration".
 */
describe('a control reached through an `as` cast', () => {
  // (form.get('items') as FormArray).push(...) is the dominant idiom, because get() is
  // typed AbstractControl | null and people cast to reach array/control members.
  it.each([
    [`(this.form.get('items') as FormArray).push(this.build());`, 'FormArray.push'],
    [`(this.form.get('items') as FormArray).removeAt(0);`, 'FormArray.removeAt'],
    [`const n = (this.form.get('items') as FormArray).length;`, 'AbstractControl.length'],
    [`(this.form.get('email') as FormControl).setValidators([]);`, 'AbstractControl.setValidators'],
  ])('%s reports %s', (body, construct) => {
    const source = `import { FormGroup, FormArray, FormControl } from '@angular/forms';
export class C {
  form: FormGroup;
  build(): FormGroup { return null as any; }
  run(): void { ${body} }
}`;
    expect(detectInSource('/a.ts', source).map((f) => f.construct)).toContain(construct);
  });
});

describe('a method-local const alias of a control', () => {
  const withLocal = (body: string): string => `${HEADER}
  run(): void {
    const phoneControl = this.loginForm.get('phone');
    ${body}
  }
}
`;

  it.each([
    ['phoneControl?.setValidators([]);', 'AbstractControl.setValidators'],
    ['phoneControl?.clearValidators();', 'AbstractControl.clearValidators'],
    ['phoneControl?.updateValueAndValidity();', 'AbstractControl.updateValueAndValidity'],
    ['const v = phoneControl?.value;', 'AbstractControl.value'],
  ])('%s reports %s on the alias', (body, construct) => {
    expect(constructs(withLocal(body))).toContain(construct);
  });

  it('resolves a chain of local aliases', () => {
    const source = `${HEADER}
  run(): void {
    const group = this.loginForm.get('address');
    const city = group?.get('city');
    city?.setValidators([]);
  }
}
`;
    expect(constructs(source)).toContain('AbstractControl.setValidators');
  });

  it('does NOT bind a local const that is not form-derived', () => {
    // The fixpoint only binds when the initializer is provably form-derived, so an unrelated
    // service call named like a control must not turn into a false positive.
    const source = `${HEADER}
  private svc = { load(): any { return null; } };
  run(): void {
    const phoneControl = this.svc.load();
    phoneControl?.setValidators([]);
  }
}
`;
    expect(constructs(source)).not.toContain('AbstractControl.setValidators');
  });
});
