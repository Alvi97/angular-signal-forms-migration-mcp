import { describe, expect, it } from 'vitest';
import { detectInSource } from '../src/core/detect.js';
import type { Finding } from '../src/core/types.js';

const IMPORT = `import { FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';`;

function constructs(findings: readonly Finding[]): string[] {
  return findings.map((f) => f.construct);
}
function find(findings: readonly Finding[], construct: string): Finding {
  const match = findings.find((f) => f.construct === construct);
  if (match === undefined) {
    throw new Error(`expected "${construct}", got: ${constructs(findings).join(', ')}`);
  }
  return match;
}
/** Real shape from mockio-master's forgot-password.component.ts. */
const REAL = `${IMPORT}
export class ForgotPassword {
  forgotPasswordForm: FormGroup;
  constructor(private fb: FormBuilder) {
    this.forgotPasswordForm = this.fb.group({ email: ['', [Validators.required]] });
  }
  onSubmit(): void {
    if (this.forgotPasswordForm.invalid) { return; }
    this.auth.forgotPassword(this.forgotPasswordForm.value).subscribe();
  }
}`;

describe('reading form state', () => {
  it('detects .invalid and .value on a bound form', () => {
    const findings = detectInSource('/app/forgot.component.ts', REAL);

    expect(find(findings, 'AbstractControl.invalid').classification).toBe('mechanical');
    expect(find(findings, 'AbstractControl.value').classification).toBe('mechanical');
  });

  it.each(['valid', 'errors', 'touched', 'dirty', 'pristine', 'pending', 'controls'])(
    'detects .%s',
    (member) => {
      const findings = detectInSource(
        '/app/a.ts',
        `${IMPORT}
export class A {
  form: FormGroup;
  read() { return this.form.${member}; }
}`,
      );
      expect(constructs(findings)).toContain(`AbstractControl.${member}`);
    },
  );

  it('treats .status as judgment because the shape changes from string to booleans', () => {
    const findings = detectInSource(
      '/app/a.ts',
      `${IMPORT}
export class A {
  form: FormGroup;
  read() { return this.form.status === 'VALID'; }
}`,
    );

    expect(find(findings, 'AbstractControl.status').classification).toBe('judgment');
  });

  it('ignores state-looking members on anything not bound to a form', () => {
    const findings = detectInSource(
      '/app/a.ts',
      `${IMPORT}
export class A {
  onInput(event: Event) {
    const v = (event.target as HTMLInputElement).value;
    return this.config.errors ?? this.response.value;
  }
}`,
    );

    expect(constructs(findings).filter((c) => c.startsWith('AbstractControl.'))).toEqual([]);
  });

  it('does not report a method call as a property read', () => {
    const findings = detectInSource(
      '/app/a.ts',
      `${IMPORT}
export class A {
  form: FormGroup;
  clear() { this.form.reset(); }
}`,
    );

    // `.reset()` is the method, not a read of a `reset` property.
    expect(constructs(findings)).toContain('AbstractControl.reset');
    expect(constructs(findings).filter((c) => c === 'AbstractControl.reset')).toHaveLength(1);
  });
});

describe('writing form state', () => {
  it.each([
    ['setValue', 'mechanical'],
    ['patchValue', 'mechanical'],
    ['reset', 'mechanical'],
    ['getRawValue', 'mechanical'],
    // These two exist on Signal Forms field state — proven by compiling them against
    // @angular/forms v22 in verify/src/form-state.ts. They were misclassified as
    // judgment on the assumption that every imperative state API had been removed.
    ['markAsTouched', 'mechanical'],
    ['markAsDirty', 'mechanical'],
  ])('classifies .%s() as %s', (method, expected) => {
    const findings = detectInSource(
      '/app/a.ts',
      `${IMPORT}
export class A {
  form: FormGroup;
  go() { this.form.${method}({ a: 1 }); }
}`,
    );

    expect(find(findings, `AbstractControl.${method}`).classification).toBe(expected);
  });

  it.each([
    'markAllAsTouched',
    'setErrors',
    'updateValueAndValidity',
    'enable',
    'disable',
    'setValidators',
  ])('classifies .%s() as judgment — these have no imperative equivalent', (method) => {
    const findings = detectInSource(
      '/app/a.ts',
      `${IMPORT}
export class A {
  form: FormGroup;
  go() { this.form.${method}(); }
}`,
    );

    expect(find(findings, `AbstractControl.${method}`).classification).toBe('judgment');
  });

  it('ignores those method names on non-form receivers', () => {
    const findings = detectInSource(
      '/app/a.ts',
      `${IMPORT}
const store = new Store();
store.reset();
store.patchValue({ a: 1 });`,
    );

    expect(constructs(findings).filter((c) => c.startsWith('AbstractControl.'))).toEqual([]);
  });
});

describe('.controls access mode', () => {
  const wrap = (body: string) => `import { FormGroup } from '@angular/forms';
export class A {
  form: FormGroup;
  go() { ${body} }
}`;

  it('treats a named control access as mechanical', () => {
    for (const body of [
      `return this.form.controls['email'];`,
      `return this.form.controls.email;`,
    ]) {
      const findings = detectInSource('/app/a.ts', wrap(body));
      expect(find(findings, 'AbstractControl.controls').classification, body).toBe('mechanical');
    }
  });

  it('treats iterating the control map as judgment', () => {
    // Real shape from mockio-master's register.component.ts. The field tree is a typed
    // object, so there is no string-keyed map to enumerate.
    const findings = detectInSource(
      '/app/a.ts',
      wrap(`Object.keys(this.form.controls).forEach((key) => this.touch(key));`),
    );

    expect(find(findings, 'AbstractControl.controls').classification).toBe('judgment');
  });
});
