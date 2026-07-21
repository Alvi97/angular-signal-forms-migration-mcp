import { describe, expect, it } from 'vitest';
import { getSignalFormsRecipe } from '../src/core/recipes.js';

/**
 * The template half of a migration.
 *
 * Recipes described the TypeScript rewrite and stopped, so the strings a template must
 * match on were left unsourced — an agent migrating a real login form went and read
 * node_modules to find them. Two of the keys are renamed, and getting one wrong fails
 * silently: `e.kind === 'minlength'` is valid TypeScript that is never true, so the error
 * message just disappears with nothing to debug.
 *
 * The kinds themselves are compile-pinned against real @angular/forms v22 in
 * verify/src/submission-and-error-kinds.ts, including two @ts-expect-error assertions that
 * the lowercase spellings are rejected. This file pins the ADVICE to those same strings.
 */
function caveatsFor(construct: string): string {
  const recipe = getSignalFormsRecipe(construct);
  if (!recipe.found) throw new Error(`missing recipe: ${construct}`);
  return recipe.caveats.join('\n');
}

describe('every built-in validator recipe states its error kind', () => {
  it.each([
    ['Validators.required', 'required'],
    ['Validators.requiredTrue', 'required'],
    ['Validators.email', 'email'],
    ['Validators.min', 'min'],
    ['Validators.max', 'max'],
    ['Validators.minLength', 'minLength'],
    ['Validators.maxLength', 'maxLength'],
    ['Validators.pattern', 'pattern'],
  ])('%s reports kind %s', (construct, kind) => {
    expect(caveatsFor(construct)).toContain(`reports \`{ kind: '${kind}' }\``);
  });

  it.each([
    ['Validators.minLength', 'minlength'],
    ['Validators.maxLength', 'maxlength'],
  ])('%s warns that the reactive key %s was renamed', (construct, oldKey) => {
    const caveats = caveatsFor(construct);
    expect(caveats).toContain('RENAMED');
    expect(caveats).toContain(oldKey);
  });

  it('does not claim a rename where the spelling is unchanged', () => {
    expect(caveatsFor('Validators.required')).not.toContain('RENAMED');
  });

  /**
   * `errors().some(e => e.kind === '…')` is the obvious translation and cannot be written in
   * an Angular template at all — no arrow functions — which pushes people into building a
   * computed index per field. getError() is the API for this and needs neither.
   */
  it.each([
    ['Validators.required', 'required'],
    ['Validators.minLength', 'minLength'],
    ['Validators.pattern', 'pattern'],
  ])('%s points at getError() for the template read', (construct, kind) => {
    expect(caveatsFor(construct)).toContain(`field().getError('${kind}')`);
  });

  it('says so on the state-reading recipe too', () => {
    expect(caveatsFor('formStateRead')).toContain('getError(kind)');
  });
});

/**
 * A real v22 AOT build failed with NG8022 because a hand-written maxlength="6" survived
 * next to [formField] — the directive sets that attribute itself.
 *
 * The MIRRORING is documented ("Native HTML validation"). The BUILD FAILURE is not: there
 * is no angular.dev/errors/NG8022 page and it is absent from the sitemap. So the advice is
 * given, and marked UNVERIFIED, exactly as CLAUDE.md requires for anything the docs do not
 * confirm. Erasing that marker to make the caveat read more confidently is the bug.
 */
describe('native attribute collision', () => {
  const MIRRORED: readonly [string, string][] = [
    ['Validators.required', 'required'],
    ['Validators.min', 'min'],
    ['Validators.max', 'max'],
    ['Validators.minLength', 'minlength'],
    ['Validators.maxLength', 'maxlength'],
  ];

  it.each(MIRRORED)('%s warns that the rule writes %s itself', (construct, attribute) => {
    expect(caveatsFor(construct)).toContain(`this rule sets \`${attribute}\``);
  });

  it.each(MIRRORED)('%s names NG8022 as the failure mode', (construct) => {
    expect(caveatsFor(construct)).toContain('NG8022');
  });

  it.each(MIRRORED)('%s marks the undocumented part UNVERIFIED', (construct) => {
    expect(caveatsFor(construct)).toContain('UNVERIFIED');
  });

  it('does not claim it for pattern(), the documented exception', () => {
    const caveats = caveatsFor('Validators.pattern');
    expect(caveats).not.toContain('NG8022');
    expect(caveats).toContain('does NOT mirror');
  });
});

/**
 * `setErrors()` is how nearly every reactive login form reports "wrong password", and the
 * recipe used to answer it with "no counterpart — use validateHttp() or validateAsync()".
 * That is wrong twice: the docs never say it, and an async validator would call the sign-in
 * endpoint on every keystroke. Angular v22 documents submission errors for exactly this.
 */
describe('setErrors resolves to the documented submission-error path', () => {
  it('routes the setErrors lookup to the submission recipe', () => {
    const recipe = getSignalFormsRecipe('AbstractControl.setErrors');
    expect(recipe.found).toBe(true);
    if (!recipe.found) return;
    expect(recipe.construct).toBe('formSubmission');
  });

  it('is sourced to the form-submission guide', () => {
    const recipe = getSignalFormsRecipe('formSubmission');
    expect(recipe.found).toBe(true);
    if (!recipe.found) return;
    expect(recipe.provenance.sources).toContain(
      'https://angular.dev/guide/forms/signals/form-submission',
    );
  });

  it('names fieldTree, submitting() and onInvalid', () => {
    const recipe = getSignalFormsRecipe('formSubmission');
    if (!recipe.found) throw new Error('missing formSubmission recipe');
    const text = `${recipe.after}\n${recipe.caveats.join('\n')}`;
    expect(text).toContain('fieldTree');
    expect(text).toContain('submitting()');
    expect(text).toContain('onInvalid');
  });

  it('warns off the async validators the old advice pointed at', () => {
    expect(caveatsFor('formSubmission')).toMatch(/DO NOT reach for validateHttp\(\)/);
  });

  it('tells the reader the error clears itself', () => {
    expect(caveatsFor('formSubmission')).toContain('CLEARS ITSELF');
  });

  it('no longer sends setErrors to an async validator from formStateWrite', () => {
    const caveats = caveatsFor('formStateWrite');
    expect(caveats).toContain('setErrors()');
    expect(caveats).not.toMatch(/setErrors\(\)[^.]*validateHttp\(\) *'? *\+? *'?or validateAsync/);
  });
});
