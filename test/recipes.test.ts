import { describe, expect, it } from 'vitest';
import { availableConstructs, getSignalFormsRecipe } from '../src/core/recipes.js';
import { DETECTED_CONSTRUCTS, recipeSchema } from '../src/core/types.js';

/** Constructs the detector emits in M1 that deliberately have no recipe yet. */
const DEFERRED_TO_M3 = ['valueChanges', 'statusChanges'] as const;

describe('getSignalFormsRecipe', () => {
  it('returns a verified recipe for a mechanical construct', () => {
    const result = getSignalFormsRecipe('Validators.required');

    expect(result.found).toBe(true);
    if (!result.found) return;

    expect(result.construct).toBe('Validators.required');
    expect(result.after).toContain("from '@angular/forms/signals'");
    expect(result.after).toContain('required(path.name');
  });

  it('returns a structured miss — never throws — for an unknown construct', () => {
    const result = getSignalFormsRecipe('FormRecord');

    expect(result.found).toBe(false);
    if (result.found) return;

    expect(result.construct).toBe('FormRecord');
    // The miss is self-healing: the agent gets the valid keys back and can retry.
    expect(result.availableConstructs).toContain('FormGroup');
    expect(result.availableConstructs.length).toBeGreaterThan(0);
  });

  it('does not throw on empty or junk input', () => {
    for (const input of ['', '   ', '???', 'drop table recipes']) {
      expect(() => getSignalFormsRecipe(input)).not.toThrow();
      expect(getSignalFormsRecipe(input).found).toBe(false);
    }
  });
});

describe('construct name normalisation', () => {
  it('folds case and a trailing call form', () => {
    for (const spelling of ['FormControl', 'formcontrol', 'FORMCONTROL', '  FormControl  ']) {
      const result = getSignalFormsRecipe(spelling);
      expect(result.found, spelling).toBe(true);
      if (result.found) expect(result.construct).toBe('FormControl');
    }

    // `Validators.required()` is how it reads at a call site.
    const called = getSignalFormsRecipe('Validators.required()');
    expect(called.found).toBe(true);
  });

  it('resolves the aliases a human or agent would plausibly type', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['fb.group', 'FormBuilder.group'],
      ['fb.control', 'FormBuilder.control'],
      ['required', 'Validators.required'],
      ['minlength', 'Validators.minLength'],
      ['ValidatorFn', 'customValidator'],
      ['custom validator', 'customValidator'],
    ];

    for (const [input, expected] of cases) {
      const result = getSignalFormsRecipe(input);
      expect(result.found, input).toBe(true);
      if (result.found) expect(result.construct).toBe(expected);
    }
  });
});

describe('recipe coverage', () => {
  // The real contract is composition: anything find_form_candidates emits must be
  // answerable by get_signalforms_recipe. Several constructs reach their recipe through
  // an alias (every shape-mutating method resolves to `dynamicControls`), so this asserts
  // the lookup succeeds rather than that a canonical key exists.
  it.each(DETECTED_CONSTRUCTS.filter((c) => !DEFERRED_TO_M3.includes(c as never)))(
    'resolves a recipe for %s',
    (construct) => {
      expect(getSignalFormsRecipe(construct).found, construct).toBe(true);
    },
  );

  it.each(DEFERRED_TO_M3)('reports %s as a documented gap, not a crash', (construct) => {
    // Detected in M1, recipe deferred to M3 (RxJS interop). See ROADMAP.md.
    const result = getSignalFormsRecipe(construct);
    expect(result.found).toBe(false);
  });

  it('exposes constructs sorted, so tool output is stable', () => {
    const constructs = availableConstructs();
    expect([...constructs].sort((a, b) => a.localeCompare(b))).toEqual(constructs);
  });
});

describe('recipe content invariants', () => {
  const recipes = availableConstructs().map((c) => getSignalFormsRecipe(c));

  it('every recipe satisfies the published schema', () => {
    for (const recipe of recipes) {
      expect(recipe.found).toBe(true);
      if (!recipe.found) continue;
      expect(() => recipeSchema.parse(recipe)).not.toThrow();
    }
  });

  it('every recipe carries the stability / version caveat', () => {
    for (const recipe of recipes) {
      if (!recipe.found) continue;
      expect(
        recipe.caveats.some((c) => c.startsWith('STABILITY:')),
        recipe.construct,
      ).toBe(true);
    }
  });

  it('every recipe states which Angular version it was verified against', () => {
    for (const recipe of recipes) {
      if (!recipe.found) continue;
      expect(
        recipe.caveats.some((c) => c.includes('v22')),
        recipe.construct,
      ).toBe(true);
    }
  });

  it('every "after" snippet imports from @angular/forms/signals', () => {
    for (const recipe of recipes) {
      if (!recipe.found) continue;
      expect(recipe.after, recipe.construct).toContain('@angular/forms/signals');
    }
  });

  it('no "after" snippet uses the pre-release [control] directive name', () => {
    // v21 shipped `[formField]` / `FormField`. Pre-release material used `[control]`,
    // and model memory reproduces it — this guards against that regression.
    for (const recipe of recipes) {
      if (!recipe.found) continue;
      expect(recipe.after, recipe.construct).not.toMatch(/\[control\]|\bControl\b/);
    }
  });

  it('no "after" snippet still constructs Reactive Forms objects', () => {
    for (const recipe of recipes) {
      if (!recipe.found) continue;
      if (recipe.construct === 'FormControl') continue; // mentions compatForm() bridging in caveats
      expect(recipe.after, recipe.construct).not.toMatch(/new FormControl|new FormGroup/);
    }
  });
});

describe('Validators.requiredTrue', () => {
  // v22 docs: required() "treats false as missing (invalid), matching
  // <input type=checkbox required>". v21 did not — so the recipe is version-sensitive
  // and must say so, or an agent will apply it to a v21 project and silently accept
  // an unchecked box.
  it('uses required() — correct for v22', () => {
    const result = getSignalFormsRecipe('Validators.requiredTrue');
    expect(result.found).toBe(true);
    if (!result.found) return;

    expect(result.after).toMatch(/\brequired\(path\./);
  });

  it('warns that the recipe is version-sensitive and names the v21 behaviour', () => {
    const result = getSignalFormsRecipe('Validators.requiredTrue');
    if (!result.found) return;

    expect(result.caveats.some((c) => c.includes('VERSION-SENSITIVE'))).toBe(true);
    expect(result.caveats.some((c) => c.includes('v21'))).toBe(true);
    // It must still hand the agent the version-independent fallback.
    expect(result.caveats.some((c) => c.includes('validate('))).toBe(true);
  });
});
