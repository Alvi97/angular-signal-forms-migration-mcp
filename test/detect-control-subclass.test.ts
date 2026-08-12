import { describe, expect, it } from 'vitest';
import { detectInSource } from '../src/core/detect.js';
import { getSignalFormsRecipe } from '../src/core/recipes.js';
import { CROSS_FILE_CONSTRUCTS } from '../src/core/types.js';

const SOURCE = `import { FormGroup, FormControl } from '@angular/forms';

export class AddressForm extends FormGroup {
  constructor() {
    super({ street: new FormControl(''), city: new FormControl('') });
  }

  get oneLine(): string {
    return \`\${this.get('street')?.value}, \${this.get('city')?.value}\`;
  }

  clearCity(): void {
    this.get('city')?.setValue('');
  }
}`;

const findings = detectInSource('/address.ts', SOURCE);

describe('a class extending a control type is detected', () => {
  it('reports controlSubclass', () => {
    expect(findings.map((f) => f.construct)).toContain('controlSubclass');
  });

  it('reports it once per class, not once per member', () => {
    expect(findings.filter((f) => f.construct === 'controlSubclass')).toHaveLength(1);
  });

  /** FieldTree is a mapped type alias. There is no class to extend, so this is a redesign. */
  it('is a judgment call', () => {
    const finding = findings.find((f) => f.construct === 'controlSubclass');
    expect(finding?.classification).toBe('judgment');
    expect(finding?.reason).toMatch(/no class|type alias|cannot be extended/i);
  });

  it('does not claim the subclass itself defines a migratable form', () => {
    const finding = findings.find((f) => f.construct === 'controlSubclass');
    expect(finding?.definesForm).toBe(false);
  });

  it('still finds the controls constructed inside super()', () => {
    expect(findings.map((f) => f.construct)).toContain('FormControl');
  });
});

describe('an unrelated subclass is not reported', () => {
  it('ignores a class extending something that is not a control', () => {
    const source = `import { FormGroup } from '@angular/forms';
class Base {}
export class Thing extends Base {}
export class Real extends FormGroup {}`;
    expect(
      detectInSource('/a.ts', source).filter((f) => f.construct === 'controlSubclass'),
    ).toHaveLength(1);
  });
});

/**
 * The subclass is instantiated in OTHER files, so whether a given site is safe to change
 * cannot be decided from this one — the M9 invariant applies.
 */
describe('controlSubclass is a cross-file construct', () => {
  it('is registered as one', () => {
    expect([...CROSS_FILE_CONSTRUCTS]).toContain('controlSubclass');
  });
});

describe('the controlSubclass recipe', () => {
  const recipe = getSignalFormsRecipe('controlSubclass');

  it('resolves', () => {
    expect(recipe.found).toBe(true);
  });

  it('does not pretend a field tree can be subclassed', () => {
    if (!recipe.found) return;
    expect(recipe.after).not.toMatch(/extends\s+(FieldTree|Field|Schema)\b/);
  });

  it('labels the member-to-destination mapping as inference, not documentation', () => {
    if (!recipe.found) return;
    expect(recipe.caveats.join('\n')).toMatch(/NOT DOCUMENTED|INFERRED/);
  });

  it('offers compatForm as the staging step, not as the destination', () => {
    if (!recipe.found) return;
    const caveats = recipe.caveats.join('\n');
    expect(caveats).toContain('compatForm');
    expect(caveats).toMatch(/defer|staging|interim|not the destination/i);
  });
});
