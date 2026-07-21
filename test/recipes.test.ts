import { describe, expect, it } from 'vitest';
import { availableConstructs, getSignalFormsRecipe } from '../src/core/recipes.js';
import { DETECTED_CONSTRUCTS, recipeSchema } from '../src/core/types.js';

/**
 * Constructs the detector emits that deliberately have no recipe yet.
 *
 * Empty as of M3: valueChanges/statusChanges were the last documented gap and are now
 * covered by the three tiered stream recipes. Keep the list — it is how a future
 * milestone records a gap without the coverage test silently failing.
 */
const DEFERRED: readonly string[] = [];

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
  it.each(DETECTED_CONSTRUCTS.filter((c) => !DEFERRED.includes(c)))(
    'resolves a recipe for %s',
    (construct) => {
      expect(getSignalFormsRecipe(construct).found, construct).toBe(true);
    },
  );

  it('has no remaining documented gaps', () => {
    // If a future milestone defers a construct, add it to DEFERRED and assert here that
    // the lookup returns a structured miss rather than throwing.
    for (const construct of DEFERRED) {
      expect(getSignalFormsRecipe(construct).found, construct).toBe(false);
    }
    expect(DEFERRED).toEqual([]);
  });

  it('answers every RxJS stream tier with its own recipe', () => {
    for (const construct of [
      'valueChanges',
      'statusChanges',
      'valueChangesPipeline',
      'statusChangesPipeline',
      'valueChangesAsyncPipeline',
      'statusChangesAsyncPipeline',
    ]) {
      expect(getSignalFormsRecipe(construct).found, construct).toBe(true);
    }
  });

  it('does not claim a mechanical rewrite exists for the hard operator tier', () => {
    const result = getSignalFormsRecipe('valueChangesAsyncPipeline');
    expect(result.found).toBe(true);
    if (!result.found) return;

    expect(result.description).toContain('no direct signal equivalent');
    expect(result.caveats.some((c) => c.includes('DO NOT expect a mechanical rewrite'))).toBe(true);
    // It must offer real strategies rather than a single pretend answer.
    expect(result.after).toContain('rxResource');
    expect(result.after).toContain('toObservable');
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

  // A template recipe's `after` is HTML, not TypeScript, so it imports nothing. The two
  // that document a non-conversion (select-multiple blocker, out-of-scope ngModel) are all
  // comment. The rest bind [formField].
  const isTemplateRecipe = (construct: string): boolean =>
    construct === 'templateBindings' || construct.startsWith('Template.');

  it('every TS "after" imports from @angular/forms/signals, and template afters bind [formField]', () => {
    for (const recipe of recipes) {
      if (!recipe.found) continue;
      if (isTemplateRecipe(recipe.construct)) {
        const isNonConversion =
          recipe.construct === 'Template.selectMultiple' || recipe.construct === 'Template.ngModel';
        if (!isNonConversion) {
          expect(recipe.after, recipe.construct).toContain('[formField]');
        }
        continue;
      }
      expect(recipe.after, recipe.construct).toContain('@angular/forms/signals');
    }
  });

  it('no "after" snippet uses the pre-release [control] directive name', () => {
    // v21 shipped `[formField]` / `FormField`. Pre-release material used `[control]`,
    // and model memory reproduces it — this guards against that regression.
    for (const recipe of recipes) {
      if (!recipe.found) continue;
      // Template recipes legitimately contain `<select>`/`<option>`/control words in HTML;
      // the regression this guards is a pre-release Signal Forms DIRECTIVE named `[control]`.
      expect(recipe.after, recipe.construct).not.toMatch(/\[control\]/);
      if (!isTemplateRecipe(recipe.construct)) {
        expect(recipe.after, recipe.construct).not.toMatch(/\bControl\b/);
      }
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

/**
 * This recipe used to carry two invented facts, and they survived three reviews because
 * every review compared DOCUMENTATION across versions:
 *
 *   1. "on v21 required() PASSES for `false`" — it does not. `isEmpty` is byte-identical in
 *      @angular/forms 21.0.0 and 22.0.7, both testing `value === false`. v21's docs merely
 *      omitted the sentence. A doc gap was read as a behaviour.
 *   2. "Reactive Forms reported `{ requiredTrue: ... }`" — it never did. Validators.requiredTrue
 *      has always reported `{ required: true }`, so there is no key rename here at all. That
 *      one was pattern-matched off the genuine minlength -> minLength rename.
 *
 * Both were stated with more confidence than anything actually documented. These tests now
 * pin the opposite.
 */
describe('Validators.requiredTrue', () => {
  it('uses required()', () => {
    const result = getSignalFormsRecipe('Validators.requiredTrue');
    expect(result.found).toBe(true);
    if (!result.found) return;

    expect(result.after).toMatch(/\brequired\(path\./);
  });

  it('does NOT claim a version difference that does not exist', () => {
    const result = getSignalFormsRecipe('Validators.requiredTrue');
    if (!result.found) return;

    const caveats = result.caveats.join('\n');
    expect(caveats).toMatch(/NOT version-sensitive/i);
    expect(caveats).toMatch(/byte-identical/);
    // The old text told v21 users the substitution would silently accept an unchecked box.
    expect(caveats).not.toMatch(/on v21 required\(\) PASSES/);
  });

  it('does NOT claim the error key was renamed', () => {
    const result = getSignalFormsRecipe('Validators.requiredTrue');
    if (!result.found) return;

    const caveats = result.caveats.join('\n');
    expect(caveats).toMatch(/THE ERROR KEY DOES NOT CHANGE/);
    expect(caveats).not.toMatch(/RENAMED/);
  });
});

describe('nested array and group shapes', () => {
  const recipe = getSignalFormsRecipe('FormArray');

  it('demonstrates all three nested compositions', () => {
    expect(recipe.found).toBe(true);
    if (!recipe.found) return;

    // group-inside-array, array-inside-group, array-inside-array-item.
    expect(recipe.after).toContain('apply(item.address, addressSchema)');
    expect(recipe.after).toContain('applyEach(section.rows');
    expect(recipe.after).toMatch(/applyEach\(path\.groups[\s\S]*applyEach\(group\.rules/);
  });

  it('shows how to mutate a nested array immutably', () => {
    if (!recipe.found) return;
    // The trap is mutating the inner array in place; the outer levels must be rebuilt.
    expect(recipe.after).toContain('groups: current.groups.map(');
    expect(recipe.after).toContain('rules: [...group.rules,');
  });

  it('uses the documented composition primitives, not invented ones', () => {
    if (!recipe.found) return;
    expect(recipe.after).toContain('schema<');
    expect(recipe.after).toContain("from '@angular/forms/signals'");
  });

  it('scopes the unverified claim to the nesting that is genuinely undocumented', () => {
    if (!recipe.found) return;
    // An audit caught this over-claiming: the docs DO show schema() combined with
    // applyEach(). Only apply()-inside-applyEach and applyEach-inside-applyEach are
    // absent. Marking documented material as unverified is its own inaccuracy.
    const caveat = recipe.caveats.find((c) => c.includes('PARTIALLY UNVERIFIED'));
    expect(caveat).toBeDefined();
    expect(caveat).toMatch(/DEEPER nesting/);
    expect(caveat).toMatch(/docs DO show schema\(\) combined/);
    expect(caveat).toMatch(/apply\(\) INSIDE applyEach\(\)/);
  });

  it('cites the schemas guide as a source', () => {
    if (!recipe.found) return;
    expect(recipe.provenance.sources).toContain('https://angular.dev/guide/forms/signals/schemas');
  });

  it('points nested-group findings at the FormArray recipe', () => {
    // A nested `fb.group` finding resolves to FormBuilder.group, so that recipe has to
    // hand the agent onward rather than showing only the flat shape.
    for (const construct of ['FormBuilder.group', 'FormGroup']) {
      const r = getSignalFormsRecipe(construct);
      expect(r.found, construct).toBe(true);
      if (!r.found) continue;
      expect(
        r.caveats.some((c) => c.includes('FormArray')),
        construct,
      ).toBe(true);
    }
  });
});
