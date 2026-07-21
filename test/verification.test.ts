import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allRecipes } from '../src/core/recipes.js';

const root = new URL('../', import.meta.url);
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, root)), 'utf8');

/**
 * Guards on the compile harness itself.
 *
 * The harness only means something if it actually covers the recipes. A fixture set that
 * silently stops exercising the risky APIs is worse than none, because the README claims
 * they are compile-verified.
 */
describe('compile verification harness', () => {
  it('pins a real Angular major, not "latest"', () => {
    const pkg: unknown = JSON.parse(read('verify/package.json'));
    const deps = (pkg as { devDependencies?: Record<string, string> }).devDependencies ?? {};
    expect(deps['@angular/forms']).toMatch(/^\^?2[2-9]\./);
    expect(deps['@angular/core']).toMatch(/^\^?2[2-9]\./);
  });

  it('has fixtures for the highest-risk recipes', () => {
    // formStateRead/formStateWrite are ~23% of findings on a real codebase and were the
    // last recipes written. They get their own fixture.
    expect(existsSync(fileURLToPath(new URL('verify/src/form-state.ts', root)))).toBe(true);
    expect(existsSync(fileURLToPath(new URL('verify/src/smoke.ts', root)))).toBe(true);
    expect(existsSync(fileURLToPath(new URL('verify/src/controls-and-interop.ts', root)))).toBe(
      true,
    );
  });

  it('exercises every module the recipes import from', () => {
    const fixtures = [
      'verify/src/smoke.ts',
      'verify/src/form-state.ts',
      'verify/src/controls-and-interop.ts',
    ]
      .map(read)
      .join('\n');

    const modules = new Set<string>();
    for (const recipe of allRecipes()) {
      for (const match of recipe.after.matchAll(/from\s+'(@angular\/[^']+)'/g)) {
        const module = match[1];
        if (module !== undefined) modules.add(module);
      }
    }

    for (const module of modules) {
      expect(fixtures, `no fixture imports from ${module}`).toContain(`'${module}'`);
    }
  });

  it('proves the v22 rule signature the docs and v21 disagree on', () => {
    // disabled(path, { when }) on v22 vs a bare callback on v21. If this compiles, the
    // version-sensitive caveat is describing something real.
    expect(read('verify/src/form-state.ts')).toContain('disabled(path.code, { when:');
  });

  it('compiles the nested composition the docs never demonstrate', () => {
    // group-inside-array via schema() + apply() inside applyEach().
    const smoke = read('verify/src/smoke.ts');
    expect(smoke).toContain('apply(item.address, addressSchema)');
    expect(smoke).toContain('applyEach(path.items, itemSchema)');
  });

  it('is wired into CI', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('verify:recipes');
    expect(ci).toContain('verify:install');
  });
});

/**
 * Importing a symbol proves it exists. It does not prove the recipe calls it correctly.
 *
 * An audit found max/maxLength/minLength/pattern were import-only: their existence was
 * verified, their call signatures never were. A recipe could have shown the wrong
 * argument order for any of them and the harness would still have been green.
 */
describe('every callable API the recipes use is called in a fixture', () => {
  const fixtures = [
    'verify/src/smoke.ts',
    'verify/src/form-state.ts',
    'verify/src/controls-and-interop.ts',
  ]
    .map(read)
    .join('\n');

  /** Types are adequately proven by the import alone; functions are not. */
  const TYPES_ONLY = new Set(['FormField', 'SchemaPath', 'SchemaPathTree', 'ValidationError']);

  it('exercises every imported function with real arguments', () => {
    const imported = new Set<string>();
    for (const recipe of allRecipes()) {
      for (const match of recipe.after.matchAll(
        /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+'@angular\/forms\/signals'/g,
      )) {
        for (const raw of (match[1] ?? '').split(',')) {
          const name = raw
            .trim()
            .replace(/^type\s+/, '')
            .trim();
          if (name !== '') imported.add(name);
        }
      }
    }

    const unexercised = [...imported]
      .filter((name) => !TYPES_ONLY.has(name))
      .filter((name) => !new RegExp(`\\b${name}\\s*[(<]`).test(fixtures));

    expect(unexercised, `not called in any fixture: ${unexercised.join(', ')}`).toEqual([]);
  });
});
