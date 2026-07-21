import { describe, expect, it } from 'vitest';
import { allRecipes } from '../src/core/recipes.js';

/**
 * A shared caveat quotes a specific page. Every recipe carrying it must cite that page.
 *
 * Three independent doc audits reported the same defect: the STABILITY quote — "if you need
 * production stability guarantees, reactive forms remain a solid choice" — is verbatim
 * correct and lives on the overview page, which almost no recipe listed in its sources. The
 * claims were true and the citations pointed somewhere the sentence does not appear, which
 * is the failure mode that makes provenance worthless: it looks sourced.
 *
 * Attaching sources by hand per recipe made this inevitable, so withProvenance now derives
 * them from the caveat text. These tests pin that.
 */
describe('shared caveats cite the page they quote', () => {
  const recipes = allRecipes();

  it('has recipes carrying the shared caveats', () => {
    expect(recipes.some((r) => r.caveats.some((c) => c.includes('STABILITY:')))).toBe(true);
    expect(recipes.some((r) => r.caveats.some((c) => c.includes('INCREMENTAL IS SUPPORTED')))).toBe(
      true,
    );
  });

  it.each([
    ['STABILITY:', 'https://angular.dev/guide/forms/signals/overview'],
    ['INCREMENTAL IS SUPPORTED', 'https://angular.dev/guide/forms/signals/migration'],
  ])('every recipe quoting %s cites %s', (marker, url) => {
    for (const recipe of recipes) {
      if (!recipe.caveats.some((caveat) => caveat.includes(marker))) continue;
      expect(recipe.provenance.sources, recipe.construct).toContain(url);
    }
  });

  it('does not attach the citation to recipes that do not carry the caveat', () => {
    const withoutStability = recipes.filter(
      (r) => !r.caveats.some((c) => c.includes('STABILITY:')),
    );
    // Nothing to assert if every recipe carries it; the guard is that the rule is
    // conditional rather than a blanket append.
    for (const recipe of withoutStability) {
      const onlyFromStability =
        recipe.provenance.sources.length === 1 &&
        recipe.provenance.sources[0] === 'https://angular.dev/guide/forms/signals/overview';
      expect(onlyFromStability, recipe.construct).toBe(false);
    }
  });

  it('never emits a duplicate source', () => {
    for (const recipe of recipes) {
      const unique = new Set(recipe.provenance.sources);
      expect(unique.size, recipe.construct).toBe(recipe.provenance.sources.length);
    }
  });
});

/**
 * The two fabrications the audit found were both invented SPECIFICS — a source-code
 * behaviour change and a literal error-key string — reasoned from a documentation gap and
 * then stated as verified fact. These guard the corrected text repo-wide.
 */
describe('the corrected v21 claims stay corrected', () => {
  const everyCaveat = allRecipes()
    .flatMap((r) => r.caveats)
    .join('\n');

  it('never again claims v21 required() accepted false', () => {
    expect(everyCaveat).not.toMatch(/on v21 .{0,40}PASSES/i);
    expect(everyCaveat).not.toMatch(/v21 .{0,30}accepted `?false/i);
  });

  it('never again claims a requiredTrue error key existed', () => {
    expect(everyCaveat).not.toMatch(/reported `\{ requiredTrue/);
  });

  it('states the source-level evidence instead of comparing doc pages', () => {
    expect(everyCaveat).toMatch(/byte-identical in @angular\/forms 21\.0\.0 and 22\.0\.7/);
  });
});
