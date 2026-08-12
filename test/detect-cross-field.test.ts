import { describe, expect, it } from 'vitest';
import { detectInSource } from '../src/core/detect.js';

/**
 * A group-level `validators:` option is the shape of every cross-field rule
 * (password === confirm, dateFrom < dateTo), and nothing detected it. `customValidator`
 * fires at the validator's DECLARATION, so it cannot know what the validator was attached
 * to — and it does not fire at all when the validator is imported.
 *
 * Measured before this existed: the same form reported 5 findings / 1 judgment with a local
 * validator, and 2 findings / ZERO judgment with an imported one. A form whose entire
 * difficulty is a cross-field rule read as fully mechanical.
 */
const withValidator = (importIt: boolean): string =>
  importIt
    ? `import { FormBuilder } from '@angular/forms';
import { passwordsMatch } from './validators';
export class B {
  constructor(private fb: FormBuilder) {}
  form = this.fb.group({ password: [''], confirm: [''] }, { validators: [passwordsMatch] });
}`
    : `import { FormBuilder, AbstractControl, ValidationErrors } from '@angular/forms';
export function passwordsMatch(g: AbstractControl): ValidationErrors | null {
  return g.get('password')?.value === g.get('confirm')?.value ? null : { mismatch: true };
}
export class A {
  constructor(private fb: FormBuilder) {}
  form = this.fb.group({ password: [''], confirm: [''] }, { validators: [passwordsMatch] });
}`;

const constructs = (source: string): string[] =>
  detectInSource('/a.ts', source).map((finding) => finding.construct);

describe('a group-level validators option is detected wherever the validator lives', () => {
  it.each([
    ['local', false],
    ['imported', true],
  ])('reports groupValidator with a %s validator', (_name, importIt) => {
    expect(constructs(withValidator(importIt))).toContain('groupValidator');
  });

  /** The differential property, in the M11 spirit: where the validator lives cannot matter. */
  it('reports the same judgment count either way', () => {
    const judgments = (source: string): number =>
      detectInSource('/a.ts', source).filter((f) => f.construct === 'groupValidator').length;
    expect(judgments(withValidator(true))).toBe(judgments(withValidator(false)));
  });

  it('is a judgment call — where the error lands is a design decision', () => {
    const finding = detectInSource('/a.ts', withValidator(true)).find(
      (f) => f.construct === 'groupValidator',
    );
    expect(finding?.classification).toBe('judgment');
    expect(finding?.reason).toMatch(/where the error/i);
  });

  it('detects the same option on new FormGroup', () => {
    const source = `import { FormGroup, FormControl } from '@angular/forms';
import { passwordsMatch } from './validators';
export class C {
  form = new FormGroup({ a: new FormControl('') }, { validators: [passwordsMatch] });
}`;
    expect(constructs(source)).toContain('groupValidator');
  });

  it('detects the legacy positional form', () => {
    const source = `import { FormGroup, FormControl } from '@angular/forms';
import { passwordsMatch } from './validators';
export class D {
  form = new FormGroup({ a: new FormControl('') }, passwordsMatch);
}`;
    expect(constructs(source)).toContain('groupValidator');
  });
});

describe('a control-level validators option is not a cross-field rule', () => {
  it('does not report groupValidator for a validators array on a FormControl', () => {
    const source = `import { FormControl, Validators } from '@angular/forms';
export class E {
  email = new FormControl('', { validators: [Validators.required] });
}`;
    expect(constructs(source)).not.toContain('groupValidator');
  });

  it('does not report groupValidator for fb.control', () => {
    const source = `import { FormBuilder, Validators } from '@angular/forms';
export class F {
  constructor(private fb: FormBuilder) {}
  email = this.fb.control('', { validators: [Validators.required] });
}`;
    expect(constructs(source)).not.toContain('groupValidator');
  });
});
