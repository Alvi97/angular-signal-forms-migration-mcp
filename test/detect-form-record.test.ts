import { describe, expect, it } from 'vitest';
import { detectInSource } from '../src/core/detect.js';
import { getSignalFormsRecipe } from '../src/core/recipes.js';

/**
 * FormRecord appeared nowhere in src/: absent from CONTROL_TYPES, so it never bound a name to
 * a form, so everything downstream was invisible too. Measured before this: the fixture below
 * reported 3 findings and ZERO judgment, while `new FormRecord`, `fb.record`, `addControl`,
 * `.get(key)`, `Object.keys(.controls)` and `.getRawValue()` were all missed.
 *
 * `class FormRecord extends FormGroup {}` — an empty body (forms.mjs). The whole difference is
 * type-level: a homogeneous control type and an OPEN key set, which is exactly what makes it a
 * judgment call rather than a rename.
 */
const SOURCE = `import { FormRecord, FormControl, FormBuilder } from '@angular/forms';
export class A {
  constructor(private fb: FormBuilder) {}
  prefs = new FormRecord<FormControl<boolean>>({});
  built = this.fb.record({ a: [''] });
  add(key: string) { this.prefs.addControl(key, new FormControl(true)); }
  read(key: string) { return this.prefs.get(key)?.value; }
  keys() { return Object.keys(this.prefs.controls); }
  raw() { return this.prefs.getRawValue(); }
}`;

const findings = detectInSource('/a.ts', SOURCE);
const constructs = findings.map((f) => f.construct);

describe('FormRecord is detected', () => {
  it('reports the constructor', () => {
    expect(constructs).toContain('FormRecord');
  });

  it('reports fb.record()', () => {
    expect(constructs).toContain('FormBuilder.record');
  });

  it('binds the name, so downstream usage is no longer invisible', () => {
    expect(constructs).toContain('FormGroup.addControl');
    expect(constructs).toContain('AbstractControl.get');
    expect(constructs).toContain('AbstractControl.controls');
    expect(constructs).toContain('AbstractControl.getRawValue');
  });

  it('finds materially more than the 3 it found before', () => {
    expect(findings.length).toBeGreaterThan(6);
  });

  /** An open key set cannot be a fixed model shape, so it is a design decision. */
  it('classifies the record itself as judgment', () => {
    const record = findings.find((f) => f.construct === 'FormRecord');
    expect(record?.classification).toBe('judgment');
    expect(record?.reason).toMatch(/key/i);
  });
});

describe('the FormRecord recipe', () => {
  const recipe = getSignalFormsRecipe('FormRecord');

  it('resolves', () => {
    expect(recipe.found).toBe(true);
  });

  it('uses a Record-typed model and applyEach rather than inventing a record API', () => {
    if (!recipe.found) return;
    expect(recipe.after).toContain('Record<string,');
    expect(recipe.after).toContain('applyEach');
    // There is no `formRecord()` in Signal Forms; inventing one is the worst outcome.
    expect(recipe.after).not.toMatch(/\bformRecord\s*\(/);
  });

  it('states plainly that the docs describe no record example', () => {
    if (!recipe.found) return;
    const caveats = recipe.caveats.join('\n');
    expect(caveats).toMatch(/UNDOCUMENTED|docs describe no|no record example/i);
  });

  it('warns that an index into the field tree can be undefined under strict settings', () => {
    if (!recipe.found) return;
    expect(recipe.caveats.join('\n')).toMatch(/undefined/i);
  });
});
