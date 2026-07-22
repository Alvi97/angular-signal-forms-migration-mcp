import { describe, expect, it } from 'vitest';
import { detectInSource } from '../src/core/detect.js';
import type { Finding } from '../src/core/types.js';

const IMPORT = `import { FormBuilder, Validators } from '@angular/forms';`;

function constructs(findings: readonly Finding[]): string[] {
  return findings.map((f) => f.construct);
}

// The singular `{ validator: fn }` key isn't an AbstractControlOptions key (it's `validators`),
// so `new FormGroup` drops it and the validator never runs. A live bug, not migration work.
describe('silently dead validator options', () => {
  it.each([['validator'], ['asyncValidator']])(
    'flags the singular `%s` key on `new FormGroup`',
    (key) => {
      const findings = detectInSource(
        '/app/reset.component.ts',
        `${IMPORT}
export class Reset {
  form = new FormGroup({
    password: new FormControl(''),
    confirmPassword: new FormControl(''),
  }, { ${key}: this.checkPasswords });
}`,
      );

      const finding = findings.find((f) => f.construct === 'deadValidatorOption');
      expect(finding).toBeDefined();
      expect(finding?.classification).toBe('judgment');
      expect(finding?.reason).toContain(key);
    },
  );

  /**
   * FormBuilder.group() is NOT affected, and asserting otherwise was a false positive
   * that told a user they had a security hole they did not have.
   *
   * Angular's own source (forms.mjs, FormBuilder.group) gates on
   * `isAbstractControlOptions(options)` — which is FALSE for `{ validator: fn }` because
   * it looks for validators/asyncValidators/updateOn — and then falls into a legacy
   * branch that maps `newOptions.validators = options.validator`. So the validator runs.
   *
   * `new FormGroup(c, { validator: fn })` takes a different path: `isOptionsObj` IS true
   * for that object, so `pickValidators` reads `.validators`, finds undefined, and the
   * validator is dropped. Same key, opposite outcome, decided by which constructor.
   */
  it.each([['validator'], ['asyncValidator']])(
    'does NOT flag the singular `%s` key on fb.group — Angular maps it',
    (key) => {
      const findings = detectInSource(
        '/app/reset.component.ts',
        `${IMPORT}
export class Reset {
  constructor(private fb: FormBuilder) {}
  form = this.fb.group({
    password: ['', [Validators.required]],
    confirmPassword: [''],
  }, { ${key}: this.checkPasswords });
}`,
      );

      expect(constructs(findings)).not.toContain('deadValidatorOption');
    },
  );

  it('does not flag the correct plural form', () => {
    const findings = detectInSource(
      '/app/ok.component.ts',
      `${IMPORT}
export class Ok {
  constructor(private fb: FormBuilder) {}
  form = this.fb.group({ a: [''] }, { validators: [this.check] });
}`,
    );

    expect(constructs(findings)).not.toContain('deadValidatorOption');
  });

  it('does not flag an unrelated property called validator', () => {
    // A `validator` key on something that is not a form options object is fine.
    const findings = detectInSource(
      '/app/cfg.ts',
      `${IMPORT}
const config = { validator: someFn, label: 'x' };
export const registry = { config };`,
    );

    expect(constructs(findings)).not.toContain('deadValidatorOption');
  });
});
