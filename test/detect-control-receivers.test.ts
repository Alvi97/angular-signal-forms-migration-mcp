import { describe, expect, it } from 'vitest';
import { detectInSource } from '../src/core/detect.js';
import type { Finding } from '../src/core/types.js';

// Calls on a control fished out of a form, e.g. `form.get('password')?.setErrors(...)`. The
// receiver is a call expression, not a bound form name, so these were once missed entirely.
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

// A per-control getter is not itself typed as a form, so calls through it were invisible.
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

// Two receiver-resolution gaps from a corpus run; both miss judgment-tier calls.
describe('a control reached through an `as` cast', () => {
  // (form.get('items') as FormArray).push(...) is the dominant idiom, since get() returns
  // AbstractControl | null and people cast to reach array/control members.
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

// Form built by a factory method (`readonly form = this.createForm()`), a common pattern
// that hid every use of the form until the factory was recognised.
describe('a form built by a factory method', () => {
  const withFactory = (usages: string, factoryBody: string): string =>
    `import { FormBuilder, FormControl, Validators } from '@angular/forms';
export class C {
  private fb = inject(FormBuilder);
  readonly registerForm = this.createRegisterForm();
  run(): void { ${usages} }
  private createRegisterForm() { return ${factoryBody}; }
}`;

  it.each([
    ['this.registerForm.markAllAsTouched();', 'AbstractControl.markAllAsTouched'],
    ["const v = this.registerForm.get('email');", 'AbstractControl.get'],
    ['const raw = this.registerForm.getRawValue();', 'AbstractControl.getRawValue'],
    ['const bad = this.registerForm.invalid;', 'AbstractControl.invalid'],
  ])('%s is seen on the factory-built form', (usage, construct) => {
    const source = withFactory(usage, "this.fb.group({ email: ['', Validators.required] })");
    expect(detectInSource('/c.ts', source).map((f) => f.construct)).toContain(construct);
  });

  it('follows a factory that delegates to another factory', () => {
    const source = `import { FormBuilder } from '@angular/forms';
export class C {
  private fb = inject(FormBuilder);
  form = this.build();
  run(): void { this.form.disable(); }
  private build() { return this.base(); }
  private base() { return this.fb.group({ a: [''] }); }
}`;
    expect(detectInSource('/c.ts', source).map((f) => f.construct)).toContain(
      'AbstractControl.disable',
    );
  });

  it('does NOT bind a field from a method that returns a non-form', () => {
    // getForm() here returns an HTTP observable, not a form — must stay unbound.
    const source = `import { HttpClient } from '@angular/common/http';
export class C {
  private http = inject(HttpClient);
  data = this.getForm();
  run(): void { this.data.subscribe(); }
  private getForm() { return this.http.get('/x'); }
}`;
    const constructs = detectInSource('/c.ts', source).map((f) => f.construct);
    expect(constructs).not.toContain('AbstractControl.subscribe');
    expect(constructs).toEqual([]);
  });
});

// The boundary: a FormGroup-typed field on the same object is resolved; a form stored on a
// referenced model object (needs cross-file types) is a documented miss. See ROADMAP.
describe('receiver-resolution boundary (documented)', () => {
  it('DETECTS a FormGroup-typed field accessed on the same object', () => {
    const source = `import { FormGroup, FormBuilder } from '@angular/forms';
export class Section {
  public sectionValidator: FormGroup;
  constructor(fb: FormBuilder) { this.sectionValidator = fb.group({ name: [''] }); }
  touch(i: number) { this.sectionValidator.controls[i].updateValueAndValidity(); }
}`;
    expect(detectInSource('/c.ts', source).map((f) => f.construct)).toContain(
      'AbstractControl.updateValueAndValidity',
    );
  });

  it('does NOT resolve a form stored on a referenced model object (known limitation)', () => {
    // Would need to know `selectedSection`'s type carries a `SectionValidator: FormGroup`.
    const source = `import { FormGroup } from '@angular/forms';
export class Comp {
  selectedSection: unknown;
  touch(i: number) {
    (this.selectedSection as any).SectionValidator.controls[i].updateValueAndValidity();
  }
}`;
    expect(detectInSource('/c.ts', source).map((f) => f.construct)).not.toContain(
      'AbstractControl.updateValueAndValidity',
    );
  });
});
