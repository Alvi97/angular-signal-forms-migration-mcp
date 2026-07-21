import { describe, expect, it } from 'vitest';
import { getSignalFormsRecipe } from '../src/core/recipes.js';

/**
 * The only migration hazard found so far that no amount of TypeScript can catch.
 *
 * Reactive Forms stamps ng-valid / ng-invalid / ng-touched / ng-dirty onto every bound
 * element. Signal Forms does not, and the migration guide says so outright. Nothing in a
 * build, a type-check or a test suite observes CSS class names, so a migrated app compiles
 * green and quietly loses its error styling everywhere at once.
 *
 * Two independent doc audits surfaced this as their top finding. It had no coverage at all:
 * there is no Reactive Forms *construct* to detect, because the damage lives in .scss files
 * the scanner never opens.
 */
describe('the ng-* status classes recipe', () => {
  const recipe = getSignalFormsRecipe('statusClasses');

  it('exists', () => {
    expect(recipe.found).toBe(true);
  });

  it('is reachable by the words someone would actually search for', () => {
    for (const spelling of ['ng-invalid', 'ng-touched', 'cssClasses', 'styling']) {
      expect(getSignalFormsRecipe(spelling).found, spelling).toBe(true);
    }
  });

  it('quotes the guide rather than paraphrasing the removal', () => {
    if (!recipe.found) throw new Error('missing recipe');
    expect(recipe.caveats.join('\n')).toContain('Signal Forms does not do that');
  });

  it('gives the one-provider fix and names both entry points', () => {
    if (!recipe.found) throw new Error('missing recipe');
    expect(recipe.after).toContain('provideSignalFormsConfig');
    expect(recipe.after).toContain('NG_STATUS_CLASSES');
    // They come from different entry points, which is easy to get wrong.
    expect(recipe.after).toContain("from '@angular/forms/signals'");
    expect(recipe.after).toContain("from '@angular/forms/signals/compat'");
  });

  it('tells the agent to check BEFORE migrating, since nothing will fail afterwards', () => {
    if (!recipe.found) throw new Error('missing recipe');
    const caveats = recipe.caveats.join('\n');
    expect(caveats).toMatch(/BEFORE MIGRATING/i);
    expect(caveats).toContain('grep');
  });

  /**
   * The API page describes NG_STATUS_CLASSES only as adding "the ng-* status classes from
   * reactive forms" without enumerating them, and the guide's hand-rolled example shows
   * four. Claiming full parity would be exactly the kind of inference this project keeps
   * getting caught on.
   */
  it('does not claim to know which classes the preset covers', () => {
    if (!recipe.found) throw new Error('missing recipe');
    expect(recipe.caveats.join('\n')).toMatch(/UNVERIFIED[\s\S]*NG_STATUS_CLASSES covers/);
  });
});
