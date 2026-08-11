import { describe, expect, it } from 'vitest';
import { detectInSource } from '../src/core/detect.js';

/**
 * Reactive Forms bindings live in inline `template:` strings as often as in .html files, and
 * were completely invisible: a component with [formGroup], formControlName and formArrayName
 * inline produced zero Template.* findings while its .ts constructs were reported normally —
 * so the file looked like a form with no template work to do.
 */
const INLINE = `import { Component } from '@angular/core';
import { FormGroup, FormControl } from '@angular/forms';

@Component({
  selector: 'app-x',
  template: \`<form [formGroup]="form">
    <input formControlName="email" required />
    <div formArrayName="items"></div>
  </form>\`,
})
export class X {
  form = new FormGroup({ email: new FormControl('') });
}`;

describe('inline templates are scanned', () => {
  const findings = detectInSource('/x.component.ts', INLINE);
  const templateFindings = findings.filter((f) => f.construct.startsWith('Template.'));

  it('reports the binding family from the inline template', () => {
    const constructs = templateFindings.map((f) => f.construct);
    expect(constructs).toContain('Template.formGroup');
    expect(constructs).toContain('Template.formControlName');
    expect(constructs).toContain('Template.formArrayName');
    expect(constructs).toContain('Template.nativeAttribute');
  });

  it('reports lines absolute to the .ts file, not relative to the template', () => {
    // `<form [formGroup]=...>` sits on line 6 of INLINE; formControlName on line 7.
    expect(templateFindings.find((f) => f.construct === 'Template.formGroup')?.line).toBe(6);
    expect(templateFindings.find((f) => f.construct === 'Template.formControlName')?.line).toBe(7);
    expect(templateFindings.find((f) => f.construct === 'Template.formArrayName')?.line).toBe(8);
  });

  it('still reports the TypeScript constructs in the same file', () => {
    expect(findings.map((f) => f.construct)).toContain('FormGroup');
  });
});

describe('a template with substitutions is skipped, not mis-reported', () => {
  const SUBSTITUTED = `import { Component } from '@angular/core';
import { FormGroup } from '@angular/forms';
const partial = '<input formControlName="a" />';
@Component({ template: \`<form [formGroup]="form">\${partial}</form>\` })
export class Y { form = new FormGroup({}); }`;

  it('reports no Template.* findings rather than wrong line numbers', () => {
    // The text is not what the compiler sees, so any line number would be a guess — and a
    // wrong line is worse than a missing one.
    const findings = detectInSource('/y.component.ts', SUBSTITUTED);
    expect(findings.filter((f) => f.construct.startsWith('Template.'))).toHaveLength(0);
  });

  it('still reports the TypeScript constructs', () => {
    expect(detectInSource('/y.component.ts', SUBSTITUTED).map((f) => f.construct)).toContain(
      'FormGroup',
    );
  });
});

describe('a component with no inline template is unaffected', () => {
  it('reports nothing extra for templateUrl', () => {
    const source = `import { Component } from '@angular/core';
import { FormGroup } from '@angular/forms';
@Component({ selector: 'a', templateUrl: './a.html' })
export class A { form = new FormGroup({}); }`;
    const findings = detectInSource('/a.component.ts', source);
    expect(findings.filter((f) => f.construct.startsWith('Template.'))).toHaveLength(0);
    expect(findings.map((f) => f.construct)).toContain('FormGroup');
  });
});
