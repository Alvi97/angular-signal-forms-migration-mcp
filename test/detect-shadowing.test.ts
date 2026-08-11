import { describe, expect, it } from 'vitest';
import { detectInSource } from '../src/core/detect.js';

/**
 * Name binding was file-wide and flat, so a `FormGroup` field named `form` bound that name
 * for every scope in the file — including other classes. `form.get('receipt')` on a
 * `FormData` was reported as `AbstractControl.get` with the advice "becomes dot notation on
 * the field tree", and `form.reset()` on an `HTMLFormElement` in an unrelated class as
 * `AbstractControl.reset`.
 *
 * ROADMAP names `formData.get()` as a case the import gate keeps out. It did not.
 */
const SOURCE = `import { FormGroup, FormControl } from '@angular/forms';

export class Shadow {
  form = new FormGroup({ email: new FormControl('') });

  upload(file: File): string | null {
    const form = new FormData();
    form.append('receipt', file);
    return form.get('receipt') as string | null;
  }
}

export class Unrelated {
  submitNative(): void {
    const form = document.querySelector('form') as HTMLFormElement;
    form.reset();
  }
}`;

describe('a local non-form shadowing a form name is not reported', () => {
  const findings = detectInSource('/app/shadow.ts', SOURCE);
  const constructs = findings.map((f) => f.construct);

  it('still reports the real form', () => {
    expect(constructs).toContain('FormGroup');
    expect(constructs).toContain('FormControl');
  });

  it('does not report FormData.get as AbstractControl.get', () => {
    expect(constructs.filter((c) => c === 'AbstractControl.get')).toHaveLength(0);
  });

  it('does not report HTMLFormElement.reset in an unrelated class', () => {
    expect(constructs.filter((c) => c === 'AbstractControl.reset')).toHaveLength(0);
  });
});

describe('a genuine form usage in the same file is still reported', () => {
  const findings = detectInSource(
    '/app/real.ts',
    `import { FormGroup, FormControl } from '@angular/forms';
     export class Real {
       form = new FormGroup({ email: new FormControl('') });
       read(): unknown { return this.form.get('email'); }
       clear(): void { this.form.reset({ email: '' }); }
     }`,
  );
  const constructs = findings.map((f) => f.construct);

  it('reports the real .get and .reset', () => {
    expect(constructs).toContain('AbstractControl.get');
    expect(constructs).toContain('AbstractControl.reset');
  });
});

/**
 * `const { email, pw } = this.form.controls` reported AbstractControl.controls at the
 * destructuring site and then missed every use after it — so the report said the file touched
 * .controls without saying where the work was.
 */
describe('controls destructured off a form are still tracked', () => {
  const findings = detectInSource(
    '/app/destructured.ts',
    `import { FormGroup, FormControl } from '@angular/forms';
     export class Y {
       form = new FormGroup({ email: new FormControl(''), pw: new FormControl('') });
       go(): void {
         const { email, pw } = this.form.controls;
         email.setValue('a');
         pw.markAsTouched();
       }
     }`,
  );
  const constructs = findings.map((f) => f.construct);

  it('reports the uses after the destructuring, not just the destructuring', () => {
    expect(constructs).toContain('AbstractControl.setValue');
    expect(constructs).toContain('AbstractControl.markAsTouched');
  });

  it('still reports the destructuring site itself', () => {
    expect(constructs).toContain('AbstractControl.controls');
  });
});

describe('destructuring a non-form is still ignored', () => {
  it('does not bind names off a Map', () => {
    const findings = detectInSource(
      '/app/map.ts',
      `import { FormGroup } from '@angular/forms';
       export class Z {
         form = new FormGroup({});
         go(): void {
           const { size } = new Map<string, string>();
           return size;
         }
       }`,
    );
    expect(findings.map((f) => f.construct)).not.toContain('AbstractControl.size');
  });
});
