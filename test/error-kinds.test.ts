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
   * The prose guides only ever illustrate three kinds ("e.g. required, email, minLength").
   * All seven are published as literals on the per-class API pages, so that is what gets
   * cited — a stronger position than "it is in the .d.ts".
   */
  it.each([
    ['Validators.required', 'RequiredValidationError'],
    ['Validators.email', 'EmailValidationError'],
    ['Validators.min', 'MinValidationError'],
    ['Validators.max', 'MaxValidationError'],
    ['Validators.minLength', 'MinLengthValidationError'],
    ['Validators.maxLength', 'MaxLengthValidationError'],
    ['Validators.pattern', 'PatternValidationError'],
  ])('%s cites the API page for %s', (construct, errorClass) => {
    expect(caveatsFor(construct)).toContain(`https://angular.dev/api/forms/signals/${errorClass}`);
  });

  /** angular.dev publishes no Reactive-key -> Signal-kind table. The pairing is ours. */
  it('admits the mapping itself is derived', () => {
    expect(caveatsFor('Validators.minLength')).toMatch(/no\s+Reactive-to-Signal error-key table/);
  });

  /**
   * min()/max() are number-only in v22. A Reactive `Validators.min` on a DATE field does not
   * map to min() at all — it maps to minDate(), which reports a different kind.
   */
  it.each([
    ['Validators.min', 'minDate'],
    ['Validators.max', 'maxDate'],
  ])('%s warns that a date bound reports %s instead', (construct, dateKind) => {
    expect(caveatsFor(construct)).toContain(dateKind);
  });

  /**
   * `errors().some(e => e.kind === '…')` is the obvious translation and cannot be written in
   * an Angular template at all — arrow functions are banned in template expressions, which
   * is documented. getError() is the narrowing single-error read; whether it belongs in a
   * template is our inference, guarded separately below.
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

  /**
   * getError() exists and is documented — but ONLY on the FieldState API page, which scopes
   * its reactivity claim to "a reactive context (e.g. computed or effect)". No Angular guide
   * mentions it at all; every documented example iterates errors(). Recommending it in a
   * template is therefore this tool's inference, and has to read as one.
   */
  it.each(['Validators.required', 'Validators.minLength', 'formStateRead'])(
    '%s marks template use of getError() as inference',
    (construct) => {
      expect(caveatsFor(construct)).toMatch(
        /INFERRED, not documented[\s\S]*getError|getError[\s\S]*INFERRED, not documented/,
      );
    },
  );
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
