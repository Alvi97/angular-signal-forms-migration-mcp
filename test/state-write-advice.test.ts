import { describe, expect, it } from 'vitest';
import { detectInSource } from '../src/core/detect.js';
import { getSignalFormsRecipe } from '../src/core/recipes.js';

// Two corrections to earlier advice (reset() needs an argument; markAllAsTouched is a
// rename), guarding against advice confident enough to follow but wrong enough to break.
function caveats(construct: string): string {
  const recipe = getSignalFormsRecipe(construct);
  if (!recipe.found) throw new Error(`missing recipe: ${construct}`);
  return recipe.caveats.join('\n');
}

function classify(method: string): string {
  const findings = detectInSource(
    '/app/a.ts',
    `import { FormGroup } from '@angular/forms';
export class A {
  form: FormGroup;
  go() { this.form.${method}(); }
}`,
  );
  const finding = findings.find((f) => f.construct === `AbstractControl.${method}`);
  if (finding === undefined) throw new Error(`not detected: ${method}`);
  return finding.classification;
}

/**
 * `reset()` reads as a straight rename and is not one. Reactive Forms restored the initial
 * value AND cleared touched/dirty; Signal Forms clears touched/dirty and leaves the value
 * alone unless you pass one. A literal transliteration therefore leaves stale data on
 * screen — nothing throws, nothing fails to compile, the field just does not empty.
 */
describe('reset() does not clear the value', () => {
  it('says so on the state-writing recipe', () => {
    expect(caveats('formStateWrite')).toContain('RESET TAKES AN ARGUMENT NOW');
  });

  /**
   * angular.dev never contrasts this with Reactive Forms — the migration guide does not
   * mention reset() at all. The comparison is this tool's reading of two APIs, so it has to
   * be labelled rather than presented as documentation.
   */
  it('labels the Reactive Forms comparison as inference', () => {
    expect(caveats('formStateWrite')).toMatch(/INFERRED, not documented[\s\S]*Reactive Forms/);
  });

  it('quotes the documented parameter behaviour rather than paraphrasing it', () => {
    expect(caveats('formStateWrite')).toContain('the value will');
  });

  it('gives the call that preserves the old behaviour', () => {
    expect(caveats('formStateWrite')).toMatch(/f\(\)\.reset\(\{ \.\.\.INITIAL \}\)/);
  });

  it('warns at the finding, not only in the recipe', () => {
    const findings = detectInSource(
      '/app/a.ts',
      `import { FormGroup } from '@angular/forms';
export class A {
  form: FormGroup;
  go() { this.form.reset(); }
}`,
    );
    const reset = findings.find((f) => f.construct === 'AbstractControl.reset');
    expect(reset?.reason).toMatch(/needs an argument|will not be\s+changed/i);
  });
});

/**
 * The recipe listed markAllAsTouched under "NO COUNTERPART" and then, two caveats later,
 * told the reader to call `f().markAsTouched()`. An agent reading both concluded the recipe
 * was stale and went to the typings. It was not stale, it was self-contradictory — which is
 * worse, because it costs the reader's trust in everything else on the page.
 */
describe('markAllAsTouched is a rename, and the advice says so once', () => {
  it('is classified mechanical', () => {
    expect(classify('markAllAsTouched')).toBe('mechanical');
  });

  it('is not listed as having no counterpart', () => {
    const noCounterpart = caveats('formStateWrite')
      .split('\n')
      .filter((line) => line.includes('NO COUNTERPART'))
      .join('\n');
    expect(noCounterpart).not.toContain('markAllAsTouched');
  });

  it('still lists the APIs that genuinely have none', () => {
    const text = caveats('formStateWrite');
    for (const absent of ['markAsPristine', 'updateValueAndValidity', 'setValidators']) {
      expect(text).toContain(absent);
    }
  });

  it('keeps markAsUntouched and markAsPristine as judgment', () => {
    expect(classify('markAsUntouched')).toBe('judgment');
    expect(classify('markAsPristine')).toBe('judgment');
  });
});
