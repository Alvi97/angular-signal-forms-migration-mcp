import { describe, expect, it } from 'vitest';
import { detectInTemplate } from '../src/core/detect-template.js';

/**
 * The M5 defect, one layer up.
 *
 * ROADMAP's own M5 entry records: "Found by running M4 against a real repo:
 * forgot-password.component.ts was reported as '7 findings, all mechanical' while two further
 * lines (form.invalid, form.value) also had to change."
 *
 * Running a real migration of THE SAME FILE found the same failure in its template. The report
 * said 12 findings, all mechanical, zero judgment; the template had six more edit sites the
 * scanner never mentioned, because it flagged binding sites only. M5 added state reads for
 * `.ts` and nobody added them for template expressions.
 */
const TEMPLATE = `<form [formGroup]="forgotPasswordForm" (ngSubmit)="onSubmit()">
  <input formControlName="email"
    [ngClass]="{'border-red-500': email?.invalid && (email?.dirty || email?.touched)}">
  @if (email?.invalid && (email?.dirty || email?.touched)) {
    @if (email?.errors?.['required']) { <div>Email is required</div> }
    @if (email?.errors?.['email']) { <div>Invalid email</div> }
  }
  <button [disabled]="forgotPasswordForm.invalid || isSubmitting"></button>
</form>`;

const findings = detectInTemplate('/a.html', TEMPLATE);
const constructs = findings.map((f) => f.construct);

describe('state read in a template expression is an edit site', () => {
  it('reports the state reads the binding scan used to miss', () => {
    expect(constructs).toContain('Template.stateRead');
  });

  it('finds materially more than the two bindings', () => {
    // Two bindings before; the template above has six further edit sites.
    expect(findings.length).toBeGreaterThan(4);
  });

  it('still reports the bindings themselves', () => {
    expect(constructs).toContain('Template.formGroup');
    expect(constructs).toContain('Template.formControlName');
  });

  it.each([
    ['invalid on a control', 3],
    ['the @if guard', 4],
    ['form-level invalid', 8],
  ])('flags %s', (_name, line) => {
    expect(findings.some((f) => f.line === line && f.construct.startsWith('Template.'))).toBe(true);
  });
});

/**
 * The sharp one. `errors?.['required']` is not a rename: Signal Forms errors are a
 * ValidationError[] carrying `kind`, not an object keyed by error name. Transliterating the
 * bracket access compiles and silently never matches, so it cannot be mechanical.
 */
describe('an error-key lookup is judgment, not a rename', () => {
  const errorFindings = findings.filter((f) => f.construct === 'Template.errorKeyLookup');

  it('is reported separately from a plain state read', () => {
    expect(errorFindings.length).toBeGreaterThanOrEqual(2);
  });

  it('is judgment', () => {
    for (const finding of errorFindings) expect(finding.classification).toBe('judgment');
  });

  it('names getError and warns the shape changes', () => {
    expect(errorFindings[0]?.reason).toMatch(/getError/);
    expect(errorFindings[0]?.reason).toMatch(/kind/);
  });
});

describe('ordinary template expressions are not flagged', () => {
  it('ignores state-looking names on things that are not forms', () => {
    const plain = `<div [ngClass]="{'x': user?.invalid}">{{ product.value }}</div>`;
    expect(detectInTemplate('/b.html', plain)).toEqual([]);
  });

  it('ignores a template with no form bindings at all', () => {
    const plain = `<section><p>{{ title }}</p><button [disabled]="busy"></button></section>`;
    expect(detectInTemplate('/c.html', plain)).toEqual([]);
  });
});
