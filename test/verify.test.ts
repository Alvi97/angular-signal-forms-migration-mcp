import { describe, expect, it } from 'vitest';
import { ALWAYS_SKIPPED, usesSignalForms, verifyMigratedSource } from '../src/core/verify.js';

const checks = (source: string): string[] =>
  verifyMigratedSource('/a.ts', source).map((finding) => finding.check);

/** A minimal migrated component; each case appends the line under test. */
function migrated(body: string, imports = 'form, required'): string {
  return `import { signal, computed, effect } from '@angular/core';
import { ${imports} } from '@angular/forms/signals';

export class C {
  readonly model = signal({ email: '', admin: false });
  readonly f = form(this.model, (p) => { required(p.email); });
  ${body}
}`;
}

describe('a file that was never migrated is not verified', () => {
  it('returns nothing for a plain Reactive Forms file', () => {
    const source = `import { FormGroup, FormControl } from '@angular/forms';
export class C { form = new FormGroup({ email: new FormControl('') }); }`;
    expect(verifyMigratedSource('/a.ts', source)).toEqual([]);
    expect(usesSignalForms(source)).toBe(false);
  });

  it('recognises a migrated file', () => {
    expect(usesSignalForms(migrated(''))).toBe(true);
  });
});

/**
 * TS2774 catches `if (f().invalid)` but NOT `if (!f().invalid)`, `while (...)`, `!!...` or
 * `... || false`. Those are the whole reason this check exists — a check the compiler already
 * makes would be noise in a tool the agent runs after tsc.
 */
describe('signalNotCalled covers the positions the compiler misses', () => {
  it.each([
    ['negation', 'bad(): boolean { return !this.f().invalid; }'],
    ['while', 'bad(): void { while (this.f().invalid) { break; } }'],
    ['double negation', 'bad(): boolean { return !!this.f().invalid; }'],
    ['logical or', 'bad(): boolean { return this.f().invalid || false; }'],
    ['template literal', 'bad(): string { return `${this.f().touched}`; }'],
  ])('flags a missed call in %s', (_name, body) => {
    expect(checks(migrated(body))).toContain('signalNotCalled');
  });

  it('does not flag a correctly called signal', () => {
    expect(checks(migrated('ok(): boolean { return !this.f().invalid(); }'))).not.toContain(
      'signalNotCalled',
    );
  });

  it('does not flag a WritableSignal being written', () => {
    const body =
      "ok(): void { this.f.email().value.set('x'); this.f.email().value.update(v => v); }";
    expect(checks(migrated(body))).not.toContain('signalNotCalled');
  });

  it('does not flag a signal handed to computed or effect', () => {
    const body = 'readonly bad = computed(() => this.f().invalid());';
    expect(checks(migrated(body))).not.toContain('signalNotCalled');
  });

  it('does not flag a state name read off something that is not a form', () => {
    const body = 'other = { value: 1 }; read(): number { return this.other.value; }';
    expect(checks(migrated(body))).not.toContain('signalNotCalled');
  });
});

describe('deprecatedLogicShape catches the v21 rule shape the compiler allows', () => {
  it('flags a bare callback', () => {
    const source = migrated('', 'form, required, disabled').replace(
      'required(p.email);',
      'required(p.email); disabled(p.email, () => true);',
    );
    expect(checks(source)).toContain('deprecatedLogicShape');
  });

  it('does not flag the v22 options object', () => {
    const source = migrated('', 'form, required, disabled').replace(
      'required(p.email);',
      'required(p.email); disabled(p.email, { when: () => true });',
    );
    expect(checks(source)).not.toContain('deprecatedLogicShape');
  });

  it('refuses to judge an identifier argument rather than guessing', () => {
    const source = migrated('', 'form, required, hidden').replace(
      'required(p.email);',
      'required(p.email); hidden(p.email, someCondition);',
    );
    expect(checks(source)).not.toContain('deprecatedLogicShape');
  });
});

describe('preReleaseApiName distinguishes a wrong name from an outdated one', () => {
  it('flags Control, which never shipped', () => {
    const findings = verifyMigratedSource(
      '/a.ts',
      `import { form, Control } from '@angular/forms/signals';
export class C {}`,
    );
    const finding = findings.find((f) => f.check === 'preReleaseApiName');
    expect(finding?.message).toContain('no `Control` export');
  });

  it('flags Field as outdated, NOT as invented — it shipped in 21.0.0', () => {
    const findings = verifyMigratedSource(
      '/a.ts',
      `import { form, Field } from '@angular/forms/signals';
export class C {}`,
    );
    const finding = findings.find((f) => f.check === 'preReleaseApiName');
    expect(finding?.message).toContain('was real in 21.0.0');
    // The distinction that matters: outdated, not invented. Telling a user their name never
    // existed when it shipped two minors ago destroys trust in every other finding.
    expect(finding?.message).toContain('not a hallucination');
    expect(finding?.message).toContain('out of date');
  });

  it('does not flag FormField', () => {
    const source = `import { form, FormField } from '@angular/forms/signals';
export class C {}`;
    expect(checks(source)).not.toContain('preReleaseApiName');
  });
});

describe('schemaConstructionTimeRead only fires on the once-only body', () => {
  it('flags a signal read directly in the schema callback', () => {
    const source = `import { signal } from '@angular/core';
import { form, required } from '@angular/forms/signals';
declare const isAdmin: () => boolean;
export class C {
  readonly model = signal({ ssn: '' });
  readonly f = form(this.model, (p) => { if (isAdmin()) required(p.ssn); });
}`;
    expect(checks(source)).toContain('schemaConstructionTimeRead');
  });

  /**
   * Load-bearing exclusion, not a nicety: a rule callback runs per evaluation, and the
   * documented cross-field idiom is exactly this shape.
   */
  it('does not flag a read inside a rule callback', () => {
    const source = `import { signal } from '@angular/core';
import { form, validate } from '@angular/forms/signals';
export class C {
  readonly model = signal({ a: '', b: '' });
  readonly f = form(this.model, (p) => {
    validate(p.a, ({ stateOf }) => (stateOf(p.b).touched() ? null : { kind: 'x' }));
  });
}`;
    expect(checks(source)).not.toContain('schemaConstructionTimeRead');
  });
});

describe('controlInSignalFormModel catches the NG01907 trap', () => {
  it('flags an AbstractControl inside a form() model', () => {
    const source = `import { signal } from '@angular/core';
import { FormControl } from '@angular/forms';
import { form } from '@angular/forms/signals';
export class C {
  readonly model = signal({ first: '', last: new FormControl('') });
  readonly f = form(this.model);
}`;
    const finding = verifyMigratedSource('/a.ts', source).find(
      (f) => f.check === 'controlInSignalFormModel',
    );
    expect(finding?.message).toContain('NG01907');
    expect(finding?.severity).toBe('error');
  });

  it('does not flag a plain model', () => {
    expect(checks(migrated(''))).not.toContain('controlInSignalFormModel');
  });
});

describe('leftovers are graded by whether the compat layer is in use', () => {
  it('flags Reactive Forms imports in a fully migrated file', () => {
    const source = `import { FormGroup } from '@angular/forms';
import { form } from '@angular/forms/signals';
export class C {}`;
    expect(checks(source)).toContain('leftoverReactiveForms');
    expect(verifyMigratedSource('/a.ts', source)[0]?.severity).toBe('error');
  });

  it('flags a lingering ReactiveFormsModule separately', () => {
    const source = `import { ReactiveFormsModule } from '@angular/forms';
import { form } from '@angular/forms/signals';
export class C {}`;
    expect(checks(source)).toContain('reactiveFormsModuleImport');
  });

  /** An interop file is not broken — but silence there would read as "nothing to see". */
  it('downgrades to info when the compat layer is in use, rather than going quiet', () => {
    const source = `import { FormGroup } from '@angular/forms';
import { compatForm } from '@angular/forms/signals/compat';
export class C {}`;
    const findings = verifyMigratedSource('/a.ts', source);
    expect(findings.map((f) => f.severity)).toEqual(['info']);
    expect(findings[0]?.message).toContain('expected');
  });
});

describe('every finding carries its evidence', () => {
  it('never emits an empty evidence string', () => {
    const sources = [
      migrated('bad(): boolean { return !this.f().invalid; }'),
      `import { form, Control } from '@angular/forms/signals';\nexport class C {}`,
      `import { FormGroup } from '@angular/forms';\nimport { form } from '@angular/forms/signals';\nexport class C {}`,
    ];
    for (const source of sources) {
      for (const finding of verifyMigratedSource('/a.ts', source)) {
        expect(finding.evidence.length, finding.check).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * The refusal is part of the contract. A check that cannot run must say so, because an empty
 * result otherwise reads as a pass — which is the exact failure this tool exists to remove.
 */
describe('droppedConstraint is refused rather than guessed', () => {
  it('is always reported as skipped, with the reason', () => {
    const skipped = ALWAYS_SKIPPED.find((s) => s.check === 'droppedConstraint');
    expect(skipped).toBeDefined();
    expect(skipped?.reason).toContain('pre-migration copy');
  });

  it('is not implemented as a heuristic', () => {
    // A field with no rule is indistinguishable from one that never needed a rule.
    const source = migrated('');
    expect(checks(source)).not.toContain('droppedConstraint');
  });
});
