import { describe, expect, it } from 'vitest';
import { findFormCandidates } from '../src/core/detect.js';
import { getSignalFormsRecipe } from '../src/core/recipes.js';
import { CROSS_FILE_CONSTRUCTS } from '../src/core/types.js';
import { memoryFs } from './helpers/memory-fs.js';

const ROOT = '/app';

/**
 * `coupon` states minlength/maxlength ONLY in the template — the component declares no
 * matching validator. `email` states `required` in both. The two are indistinguishable from
 * inside the template, which is the whole point.
 */
const TEMPLATE = `<form [formGroup]="form">
  <input formControlName="coupon" minlength="8" maxlength="16" />
  <input formControlName="email" required />
</form>`;

const COMPONENT = `import { FormGroup, FormControl, Validators } from '@angular/forms';

// A control subclass: also cross-file, because its instantiation sites live elsewhere.
export class AddressForm extends FormGroup {
  constructor() { super({ street: new FormControl('') }); }
}

export class C {
  form = new FormGroup({
    coupon: new FormControl(''),
    email: new FormControl('', Validators.required),
  });
}`;

describe('a cross-file construct is never labelled mechanical', () => {
  const fs = memoryFs({
    [`${ROOT}/c.html`]: TEMPLATE,
    [`${ROOT}/c.ts`]: COMPONENT,
  });
  const result = findFormCandidates(ROOT, fs);
  if (!result.ok) throw new Error('scan failed');
  const findings = result.data.flatMap((f) => f.findings);

  it('produced the cross-file findings the fixture contains', () => {
    const crossFile = findings.filter((f) => CROSS_FILE_CONSTRUCTS.has(f.construct));
    expect(crossFile.length).toBeGreaterThanOrEqual(3);
  });

  it.each([...CROSS_FILE_CONSTRUCTS])('%s is always judgment', (construct) => {
    const matching = findings.filter((f) => f.construct === construct);
    expect(matching.length, `fixture exercises ${construct}`).toBeGreaterThan(0);
    for (const finding of matching) {
      expect(finding.classification, `${construct} at line ${String(finding.line)}`).toBe(
        'judgment',
      );
    }
  });

  it('states the precondition rather than an unconditional delete', () => {
    const attr = findings.find((f) => f.construct === 'Template.nativeAttribute');
    expect(attr).toBeDefined();
    expect(attr?.reason).toMatch(/only if|check the/i);
    expect(attr?.reason).not.toMatch(/Delete the attribute — the rule emits it/);
  });
});

/**
 * A `mechanical` label promises the advice FINISHES the job. That is unprovable in general,
 * but the weakest useful form is checkable: the advice has to name what the construct
 * becomes. A reason that describes the problem without naming a replacement is a judgment
 * call wearing a mechanical label.
 */
describe('every mechanical state API names its replacement', () => {
  const REPLACEMENT = /signal|model\(|\bform\(|field state|f\(\)|getError|\.set\(|\.update\(/i;

  it.each([
    'AbstractControl.setValue',
    'AbstractControl.patchValue',
    'AbstractControl.reset',
    'AbstractControl.getRawValue',
    'AbstractControl.markAsTouched',
  ])('%s advice names a Signal Forms replacement', (construct) => {
    const recipe = getSignalFormsRecipe(construct);
    expect(recipe.found, construct).toBe(true);
    if (!recipe.found) return;
    const text = [recipe.description, ...recipe.caveats].join('\n');
    expect(text, construct).toMatch(REPLACEMENT);
  });
});
