import { describe, expect, it } from 'vitest';
import { detectInSource } from '../src/core/detect.js';
import type { Finding } from '../src/core/types.js';

const IMPORT = `import { FormArray, FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';`;

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

describe('FormArray as a first-class finding', () => {
  it('reports a statically-populated FormArray as mechanical', () => {
    const findings = detectInSource(
      '/app/tags.component.ts',
      `${IMPORT}
const tags = new FormArray([new FormControl('a'), new FormControl('b')]);`,
    );

    const finding = find(findings, 'FormArray');
    expect(finding.classification).toBe('mechanical');
    expect(finding.line).toBe(2);
  });

  it('reports fb.array(...) as its own finding', () => {
    const findings = detectInSource(
      '/app/order.component.ts',
      `${IMPORT}
export class Order {
  constructor(private fb: FormBuilder) {}
  form = this.fb.group({ items: this.fb.array([]) });
}`,
    );

    expect(constructs(findings)).toContain('FormBuilder.array');
  });

  it('downgrades an array that is mutated at runtime to judgment', () => {
    const findings = detectInSource(
      '/app/order.component.ts',
      `${IMPORT}
export class Order {
  items = new FormArray<FormGroup>([]);
  addItem() { this.items.push(new FormGroup({ name: new FormControl('') })); }
}`,
    );

    expect(find(findings, 'FormArray').classification).toBe('judgment');
  });
});

describe('dynamic control mutation', () => {
  it.each([
    ['addControl', "this.form.addControl('nickname', new FormControl(''));"],
    ['removeControl', "this.form.removeControl('nickname');"],
    ['setControl', "this.form.setControl('nickname', new FormControl(''));"],
    ['registerControl', "this.form.registerControl('nickname', new FormControl(''));"],
  ])('reports %s as judgment', (method, statement) => {
    const findings = detectInSource(
      '/app/dyn.component.ts',
      `${IMPORT}
export class Dyn {
  form: FormGroup;
  toggle() { ${statement} }
}`,
    );

    const finding = find(findings, `FormGroup.${method}`);
    expect(finding.classification).toBe('judgment');
  });

  it('ignores those method names on things that are not forms', () => {
    const findings = detectInSource(
      '/app/other.component.ts',
      `${IMPORT}
const registry = new Registry();
registry.addControl('x', 1);
registry.removeControl('x');`,
    );

    expect(constructs(findings).filter((c) => c.startsWith('FormGroup.'))).toEqual([]);
  });

  it('reports array mutation methods too', () => {
    const findings = detectInSource(
      '/app/order.component.ts',
      `${IMPORT}
export class Order {
  items: FormArray;
  add() { this.items.push(new FormControl('')); }
  drop(i: number) { this.items.removeAt(i); }
}`,
    );

    expect(constructs(findings)).toContain('FormArray.push');
    expect(constructs(findings)).toContain('FormArray.removeAt');
  });
});

describe('async validators', () => {
  it('reports an AsyncValidatorFn as judgment', () => {
    const findings = detectInSource(
      '/app/v.ts',
      `import { AbstractControl, AsyncValidatorFn, ValidationErrors } from '@angular/forms';
export function uniqueEmail(): AsyncValidatorFn {
  return (control: AbstractControl) => api.check(control.value);
}`,
    );

    const finding = find(findings, 'asyncValidator');
    expect(finding.classification).toBe('judgment');
  });

  it('reports the asyncValidators option on a control', () => {
    const findings = detectInSource(
      '/app/v.ts',
      `${IMPORT}
const email = new FormControl('', { asyncValidators: [uniqueEmail()] });`,
    );

    expect(constructs(findings)).toContain('asyncValidator');
  });

  it('does not confuse a sync ValidatorFn for an async one', () => {
    const findings = detectInSource(
      '/app/v.ts',
      `import { ValidatorFn } from '@angular/forms';
export function x(): ValidatorFn { return () => null; }`,
    );

    expect(constructs(findings)).not.toContain('asyncValidator');
    expect(constructs(findings)).toContain('customValidator');
  });
});
