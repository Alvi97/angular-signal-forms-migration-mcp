import { describe, expect, it } from 'vitest';
import { detectInSource } from '../src/core/detect.js';
import { analyzeMigrationComplexity } from '../src/core/complexity.js';
import type { FileFindings } from '../src/core/types.js';

const IMPORT = `import { FormArray, FormBuilder, FormControl, FormGroup } from '@angular/forms';`;

function findings(source: string): FileFindings {
  return { file: '/repo/a.ts', findings: detectInSource('/repo/a.ts', source) };
}

describe('definesForm marks the findings that construct a form', () => {
  it.each([
    ['new FormGroup', `const f = new FormGroup({});`],
    ['new FormControl', `const c = new FormControl('');`],
    ['new FormArray', `const a = new FormArray([new FormControl('')]);`],
  ])('%s defines a form', (_label, body) => {
    const result = detectInSource('/a.ts', `${IMPORT}\n${body}`);
    expect(result.some((f) => f.definesForm)).toBe(true);
  });

  it('fb.group / fb.control / fb.array define a form', () => {
    const result = detectInSource(
      '/a.ts',
      `${IMPORT}
export class A {
  constructor(private fb: FormBuilder) {}
  g = this.fb.group({ a: [''] });
  c = this.fb.control('');
  r = this.fb.array([]);
}`,
    );
    const defining = result.filter((f) => f.definesForm).map((f) => f.construct);
    expect(defining).toEqual(
      expect.arrayContaining(['FormBuilder.group', 'FormBuilder.control', 'FormBuilder.array']),
    );
  });

  it('a type annotation alone does NOT define a form', () => {
    const result = detectInSource('/a.ts', `${IMPORT}\nexport class A { form: FormGroup; }`);
    expect(result.every((f) => !f.definesForm)).toBe(true);
  });

  it('a cast on another file’s form does NOT define a form', () => {
    // The roles-section-formio shape: a Formio wrapper that only casts a sibling's array.
    const result = detectInSource(
      '/a.ts',
      `${IMPORT}
export class RolesSectionFormio {
  get rows() { return this.parent.rolesForm as FormArray; }
}`,
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((f) => !f.definesForm)).toBe(true);
  });

  it('validators and state reads do not define a form', () => {
    const result = detectInSource(
      '/a.ts',
      `${IMPORT}
export class A {
  form: FormGroup;
  ok() { return this.form.valid; }
}`,
    );
    expect(result.every((f) => !f.definesForm)).toBe(true);
  });
});

describe('ordering demotes reference-only files', () => {
  const owner = findings(`${IMPORT}
export class Owner {
  constructor(private fb: FormBuilder) {}
  form = this.fb.group({ a: [''], b: [''] });
}`);
  const referenceOnly: FileFindings = {
    file: '/repo/wrapper.ts',
    findings: detectInSource(
      '/repo/wrapper.ts',
      `${IMPORT}\nexport class W { get rows() { return this.parent.rolesForm as FormArray; } }`,
    ),
  };

  it('reports which files only reference a form', () => {
    const result = analyzeMigrationComplexity([referenceOnly, owner]);
    expect(result.referenceOnlyFiles).toEqual(['/repo/wrapper.ts']);
  });

  it('never ranks a reference-only file as the pilot, even when it is smallest', () => {
    // This is the roles-section-formio defect: 1 finding, sorted first, un-migratable alone.
    const result = analyzeMigrationComplexity([referenceOnly, owner]);
    expect(result.suggestedOrder[0]).toBe('/repo/a.ts');
    expect(result.suggestedOrder.at(-1)).toBe('/repo/wrapper.ts');
  });

  it('treats a file that both defines and references as an owner', () => {
    const both: FileFindings = {
      file: '/repo/both.ts',
      findings: detectInSource(
        '/repo/both.ts',
        `${IMPORT}
export class B {
  other: FormGroup;
  mine = new FormGroup({});
}`,
      ),
    };
    const result = analyzeMigrationComplexity([both]);
    expect(result.referenceOnlyFiles).toEqual([]);
  });
});

describe('shared validator modules are not the same as un-migratable wrappers', () => {
  const IMP = `import { AbstractControl, FormArray, ValidatorFn } from '@angular/forms';`;

  const validatorModule: FileFindings = {
    file: '/repo/shared/validators.ts',
    findings: detectInSource(
      '/repo/shared/validators.ts',
      `${IMP}
export function passwordsMatch(): ValidatorFn {
  return (c: AbstractControl) => (c.value ? null : { mismatch: true });
}
export function strictEmail(): ValidatorFn {
  return (c: AbstractControl) => null;
}`,
    ),
  };

  const wrapper: FileFindings = {
    file: '/repo/wrapper.ts',
    findings: detectInSource(
      '/repo/wrapper.ts',
      `${IMP}\nexport class W { get rows() { return this.parent.rolesForm as FormArray; } }`,
    ),
  };

  it('does not call a validator module reference-only', () => {
    // It defines reusable validators. It owns no form, but it migrates perfectly well
    // on its own — and its new error shape gates every consumer, so burying it last
    // with "cannot be migrated alone" would be actively misleading.
    const result = analyzeMigrationComplexity([validatorModule, wrapper]);
    expect(result.referenceOnlyFiles).toEqual(['/repo/wrapper.ts']);
  });

  it('reports validator modules separately, as shared primitives', () => {
    const result = analyzeMigrationComplexity([validatorModule, wrapper]);
    expect(result.sharedValidatorFiles).toEqual(['/repo/shared/validators.ts']);
  });

  it('still sorts the un-migratable wrapper last', () => {
    const result = analyzeMigrationComplexity([wrapper, validatorModule]);
    expect(result.suggestedOrder.at(-1)).toBe('/repo/wrapper.ts');
  });
});

describe('shared validators are ordered to match the advice given about them', () => {
  const IMP = `import { AbstractControl, FormBuilder, ValidatorFn } from '@angular/forms';`;

  const validators: FileFindings = {
    file: '/repo/shared/validators.ts',
    findings: detectInSource(
      '/repo/shared/validators.ts',
      `${IMP}
export function a(): ValidatorFn { return (c: AbstractControl) => null; }
export function b(): ValidatorFn { return (c: AbstractControl) => null; }`,
    ),
  };
  const easyForm: FileFindings = {
    file: '/repo/login.ts',
    findings: detectInSource(
      '/repo/login.ts',
      `${IMP}
export class L { constructor(private fb: FormBuilder) {} form = this.fb.group({ a: [''] }); }`,
    ),
  };

  it('ranks a shared validator file FIRST, not last', () => {
    // The report tells the reader to settle these early because their error shape gates
    // every consumer. Ranking them last by judgment count contradicts that in the same
    // document — which is exactly what a reader called out.
    const result = analyzeMigrationComplexity([easyForm, validators]);
    expect(result.suggestedOrder[0]).toBe('/repo/shared/validators.ts');
  });

  it('still puts un-migratable references last', () => {
    const wrapper: FileFindings = {
      file: '/repo/w.ts',
      findings: detectInSource(
        '/repo/w.ts',
        `import { FormArray } from '@angular/forms';\nexport class W { get r() { return this.p.f as FormArray; } }`,
      ),
    };
    const result = analyzeMigrationComplexity([wrapper, easyForm, validators]);
    expect(result.suggestedOrder).toEqual([
      '/repo/shared/validators.ts',
      '/repo/login.ts',
      '/repo/w.ts',
    ]);
  });
});
