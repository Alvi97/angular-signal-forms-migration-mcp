import { describe, expect, it } from 'vitest';
import { auditRecipes, formatAuditReport } from '../src/core/audit.js';
import { allRecipes, getSignalFormsRecipe } from '../src/core/recipes.js';
import { provenanceSchema } from '../src/core/types.js';
import { VERIFIED_ANGULAR_VERSION } from '../src/core/version.js';

/**
 * These are the CI gate on advice quality. A recipe with no source is
 * indistinguishable from one written out of a model's memory — which is the exact
 * failure this project has already hit twice (requiredTrue semantics, [control] vs
 * [formField]). Un-sourced recipes fail the build, not review.
 */
describe('every recipe is sourced', () => {
  const recipes = allRecipes();

  it('has at least one recipe to check', () => {
    expect(recipes.length).toBeGreaterThan(0);
  });

  it.each(recipes.map((r) => [r.construct, r] as const))(
    '%s carries valid provenance',
    (_construct, recipe) => {
      expect(() => provenanceSchema.parse(recipe.provenance)).not.toThrow();
      expect(recipe.provenance.sources.length).toBeGreaterThan(0);
      expect(recipe.provenance.verifiedAgainstVersion).toBeGreaterThan(0);
    },
  );

  it('sources every recipe against angular.dev, not a random blog', () => {
    for (const recipe of recipes) {
      for (const source of recipe.provenance.sources) {
        expect(source, recipe.construct).toMatch(/^https:\/\/(v\d+\.)?angular\.dev\//);
      }
    }
  });

  it('records the version each recipe was actually verified against', () => {
    // Recipes may legitimately lag the target — that is what `docs:audit` reports.
    // What is not allowed is claiming a version newer than the one we target.
    for (const recipe of recipes) {
      expect(recipe.provenance.verifiedAgainstVersion, recipe.construct).toBeLessThanOrEqual(
        VERIFIED_ANGULAR_VERSION,
      );
    }
  });

  it('makes version-sensitive recipes explain themselves', () => {
    for (const recipe of recipes) {
      if (!recipe.provenance.versionSensitive) continue;
      // A version-sensitive recipe must warn AND offer a version-independent path,
      // or an agent will apply it to the wrong Angular and silently break behaviour.
      expect(
        recipe.caveats.some((c) => c.includes('VERSION-SENSITIVE')),
        `${recipe.construct} is flagged version-sensitive but has no VERSION-SENSITIVE caveat`,
      ).toBe(true);
    }
  });
});

describe('provenance reaches the tool boundary', () => {
  it('is included in a successful recipe lookup', () => {
    const result = getSignalFormsRecipe('FormControl');
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.provenance.verifiedAgainstVersion).toBe(VERIFIED_ANGULAR_VERSION);
    expect(result.provenance.sources.length).toBeGreaterThan(0);
  });
});

describe('docs:audit', () => {
  it('reports no stale recipes on a freshly verified codebase', () => {
    const report = auditRecipes();
    expect(report.targetVersion).toBe(VERIFIED_ANGULAR_VERSION);
    expect(report.stale).toEqual([]);
    expect(report.staleSources).toEqual([]);
  });

  it('flags the recipes known to differ across Angular versions', () => {
    const report = auditRecipes();
    const flagged = report.versionSensitive.map((entry) => entry.construct);
    // The canonical case is the disabled() signature: v21 took a bare callback,
    // v22 takes { when: cb }. requiredTrue used to be flagged here on the strength of a
    // version difference that does not exist — see the requiredTrue tests in recipes.test.ts.
    expect(flagged).toContain('formStateWrite');
    expect(flagged).not.toContain('Validators.requiredTrue');
  });

  it('renders a report naming the target version and every construct', () => {
    const report = auditRecipes();
    const text = formatAuditReport(report);

    expect(text).toContain(`target Angular v${String(VERIFIED_ANGULAR_VERSION)}`);
    for (const entry of report.entries) expect(text).toContain(entry.construct);
  });
});

/**
 * Three different strengths of evidence live in these recipes, and conflating them is how
 * a tool ends up asserting something the docs never said:
 *
 *   compile-proven — the API exists and takes these arguments (verify:recipes)
 *   doc-quoted     — angular.dev explicitly states it
 *   inferred       — follows from documented pieces, but is written nowhere
 *
 * An audit of all 99 falsifiable claims against the live docs found several in the third
 * category presented as though they were in the second. Those must say so.
 */
describe('claims that are inference are labelled as inference', () => {
  const find = (construct: string) => {
    const recipe = getSignalFormsRecipe(construct);
    if (!recipe.found) throw new Error(`missing recipe: ${construct}`);
    return recipe;
  };

  it.each([
    // The v22 docs never mention NG_VALUE_ACCESSOR, forwardRef or the CVA callbacks.
    ['ControlValueAccessor', /INFERRED, not documented/],
    // FormBuilder appears nowhere in the Signal Forms guides.
    ['FormBuilder', /INFERRED, not documented/],
    // schema()+apply() inside applyEach() is composed from documented primitives only.
    ['FormArray', /PARTIALLY UNVERIFIED/],
  ])('%s marks its undocumented claim', (construct, marker) => {
    expect(find(construct).caveats.join('\n')).toMatch(marker);
  });

  it('states the stability position exactly as the docs support it', () => {
    // Verified against both versions: v21 carried a CRITICAL "experimental" banner, v22
    // dropped it — but v22 never says "stable", and still steers anyone needing
    // production stability guarantees toward reactive forms.
    const caveats = find('FormControl').caveats.join('\n');
    expect(caveats).toMatch(/no longer labels Signal Forms\s+experimental/);
    expect(caveats).toContain('reactive forms remain a solid choice');
    expect(caveats).not.toMatch(/\bis stable\b|production[- ]ready/i);
  });
});
