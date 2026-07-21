import { describe, expect, it } from 'vitest';
import { detectCompanions, groupCompanions, inferUpgradeOptions } from '../src/core/companions.js';

/** mockio-master's real dependency set, trimmed to what matters. */
const MOCKIO = {
  dependencies: { '@angular/core': '19.2.6', '@angular/cdk': '^19.2.8', rxjs: '~7.8.0' },
  devDependencies: {
    nx: '20.7.0',
    '@nx/angular': '^20.7.0',
    '@angular-builders/custom-webpack': '^19.0.1',
    '@angular-devkit/build-angular': '19.2.6',
    typescript: '~5.7.2',
  },
};

describe('inferUpgradeOptions answers the wizard from evidence', () => {
  it('says no to Material when it is not installed', () => {
    // The reader was asked whether they use Angular Material. The answer was in their
    // package.json the whole time.
    expect(inferUpgradeOptions(MOCKIO).material).toBe(false);
  });

  it('says yes to Material when it is installed', () => {
    const withMaterial = {
      dependencies: { ...MOCKIO.dependencies, '@angular/material': '^19.2.0' },
    };
    expect(inferUpgradeOptions(withMaterial).material).toBe(true);
  });

  it('detects ngUpgrade from @angular/upgrade', () => {
    expect(inferUpgradeOptions(MOCKIO).ngUpgrade).toBe(false);
    expect(inferUpgradeOptions({ dependencies: { '@angular/upgrade': '^19.0.0' } }).ngUpgrade).toBe(
      true,
    );
  });

  it('never throws on a malformed or empty manifest', () => {
    for (const input of [{}, null, undefined, 'nonsense', { dependencies: 'no' }]) {
      expect(() => inferUpgradeOptions(input)).not.toThrow();
    }
  });
});

describe('detectCompanions finds what must move with Angular', () => {
  const found = detectCompanions(MOCKIO);
  const names = found.map((c) => c.name);

  it('flags Nx, which Angular’s own guide says nothing about', () => {
    expect(names).toContain('nx');
    const nx = found.find((c) => c.name === 'nx');
    expect(nx?.category).toBe('external');
    // It must NOT invent a compatibility mapping — only that one exists elsewhere.
    expect(nx?.note).toMatch(/own compatibility|its own|not covered/i);
  });

  it('flags webpack builders, which the target deprecates', () => {
    expect(names).toContain('@angular-builders/custom-webpack');
    expect(names).toContain('@angular-devkit/build-angular');
  });

  it('flags CDK as part of the Angular release train', () => {
    const cdk = found.find((c) => c.name === '@angular/cdk');
    expect(cdk?.category).toBe('release-train');
  });

  it('records the installed range so the reader can see the gap', () => {
    expect(found.find((c) => c.name === 'nx')?.installed).toBe('20.7.0');
  });

  it('finds nothing in a plain Angular app', () => {
    expect(detectCompanions({ dependencies: { '@angular/core': '22.0.0' } })).toEqual([]);
  });

  it('never throws on junk', () => {
    for (const input of [null, undefined, 42, { devDependencies: [] }]) {
      expect(() => detectCompanions(input)).not.toThrow();
    }
  });
});

describe('rendering does not repeat itself', () => {
  it('collapses packages that share the same advice', () => {
    // mockio has 13 @nx/* packages. Printing the identical Nx note 13 times buries the
    // two lines that differ.
    const many = {
      devDependencies: {
        nx: '20.7.0',
        '@nx/angular': '20.7.0',
        '@nx/jest': '20.7.0',
        '@nx/webpack': '20.7.0',
        '@angular-devkit/build-angular': '19.2.6',
      },
    };
    const groups = groupCompanions(detectCompanions(many));

    // One group for Nx, one for the builder.
    expect(groups).toHaveLength(2);
    const nx = groups.find((g) => g.names.includes('nx'));
    expect(nx?.names).toHaveLength(4);
    expect(nx?.note).toMatch(/lockstep/);
  });

  it('keeps a single package readable as a group of one', () => {
    const groups = groupCompanions(detectCompanions({ dependencies: { 'zone.js': '~0.15.0' } }));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.names).toEqual(['zone.js']);
  });
});

/**
 * Three dead dependencies were found in one session by checking whether anything actually
 * referenced them. The tool said "check the builder supports your target" about
 * @angular-builders/custom-webpack when the correct answer was "delete it — no builder
 * config mentions it". Advice to evaluate something is worse than advice to remove it.
 */
describe('unreferenced build tooling', () => {
  const manifest = { devDependencies: { '@angular-builders/custom-webpack': '^19.0.1' } };

  it('marks a builder that no config references as unused', () => {
    const configs = [
      '{"projects":{"frontend":{"targets":{"build":{"executor":"@angular-devkit/build-angular:application"}}}}}',
    ];
    const found = detectCompanions(manifest, configs);
    const builder = found.find((c) => c.name === '@angular-builders/custom-webpack');

    expect(builder?.unused).toBe(true);
    expect(builder?.note).toMatch(/not referenced|remove/i);
  });

  it('leaves a builder that IS referenced alone', () => {
    const configs = [
      '{"targets":{"build":{"executor":"@angular-builders/custom-webpack:browser"}}}',
    ];
    const found = detectCompanions(manifest, configs);
    expect(found.find((c) => c.name === '@angular-builders/custom-webpack')?.unused).toBe(false);
  });

  it('does not guess when no config was supplied', () => {
    // Without build config in hand, "unused" is unknowable — say nothing rather than
    // recommend deleting a dependency.
    const found = detectCompanions(manifest);
    expect(found.find((c) => c.name === '@angular-builders/custom-webpack')?.unused).toBe(false);
  });
});
