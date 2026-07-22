import { describe, expect, it } from 'vitest';
import { detectInSource } from '../src/core/detect.js';
import type { Finding } from '../src/core/types.js';

// Reactive Forms members (`at`, `contains`, `length`, `defaultValue`) that are real edit
// sites but were once invisible. `items.at(i)` reaches one FormArray entry.
const SOURCE = (body: string): string => `import { FormArray, FormGroup } from '@angular/forms';

export class C {
  form: FormGroup;
  items: FormArray;
  run(): void {
    ${body}
  }
}`;

function findingFor(body: string, construct: string): Finding | undefined {
  return detectInSource('/app/a.ts', SOURCE(body)).find((f) => f.construct === construct);
}

describe('keyed and indexed lookups', () => {
  it.each([
    ['this.items.at(0).setValue("x");', 'AbstractControl.at', 'mechanical'],
    ['const i = this.index; this.items.at(i).setValue("x");', 'AbstractControl.at', 'judgment'],
    ['if (this.form.contains("email")) { return; }', 'AbstractControl.contains', 'mechanical'],
    ['if (this.form.contains(key)) { return; }', 'AbstractControl.contains', 'judgment'],
  ])('%s reports %s as %s', (body, construct, classification) => {
    expect(findingFor(body, construct)?.classification).toBe(classification);
  });

  it('reads FormArray.length', () => {
    expect(findingFor('const n = this.items.length;', 'AbstractControl.length')).toBeDefined();
  });

  it('reads it through .controls too', () => {
    expect(
      findingFor('const n = this.items.controls.length;', 'AbstractControl.length'),
    ).toBeDefined();
  });

  it('reads FormControl.defaultValue, which only matters because reset() changed', () => {
    expect(
      findingFor('const d = this.form.defaultValue;', 'AbstractControl.defaultValue'),
    ).toBeDefined();
  });

  it('does not fire on lookups against things that are not forms', () => {
    const source = `import { FormGroup } from '@angular/forms';

export class C {
  private list = [1, 2, 3];
  private set = new Set<string>();
  run(): void {
    const a = this.list.at(0);
    const b = this.set.contains;
    const c = this.list.length;
  }
}`;
    const constructs = detectInSource('/app/a.ts', source).map((f) => f.construct);
    expect(constructs).not.toContain('AbstractControl.at');
    expect(constructs).not.toContain('AbstractControl.contains');
    expect(constructs).not.toContain('AbstractControl.length');
  });

  it('routes each new construct to a recipe rather than a dead end', async () => {
    const { getSignalFormsRecipe } = await import('../src/core/recipes.js');
    for (const construct of [
      'AbstractControl.at',
      'AbstractControl.contains',
      'AbstractControl.length',
      'AbstractControl.defaultValue',
    ]) {
      expect(getSignalFormsRecipe(construct).found, construct).toBe(true);
    }
  });
});
