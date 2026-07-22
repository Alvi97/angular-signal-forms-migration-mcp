import { describe, expect, it } from 'vitest';
import { assessCoverage } from '../src/core/coverage.js';
import { buildMigrationReport } from '../src/core/report.js';
import { getSignalFormsRecipe } from '../src/core/recipes.js';
import type { FileFindings } from '../src/core/types.js';
import type { FileSystemPort } from '../src/core/detect.js';

// Spec files are excluded from the migration counts but still use the same constructs and
// need rewriting, so the report lists them separately rather than staying silent.
function fsWith(files: Readonly<Record<string, string>>): FileSystemPort {
  return {
    exists: (path) => path in files,
    isDirectory: () => false,
    readDir: () => [],
    readFile: (file) => {
      const contents = files[file];
      if (contents === undefined) throw new Error(`ENOENT: ${file}`);
      return contents;
    },
  };
}

const SPEC_USING_FORMS = `import { FormControl, FormGroup, Validators } from '@angular/forms';

describe('LoginComponent', () => {
  it('validates', () => {
    const form = new FormGroup({ email: new FormControl('', [Validators.required]) });
    form.setValue({ email: 'a@b.com' });
    expect(form.valid).toBe(true);
  });
});`;

const SPEC_WITHOUT_FORMS = `describe('PriceService', () => {
  it('adds tax', () => {
    expect(1 + 1).toBe(2);
  });
});`;

describe('specs that use Reactive Forms are reported separately', () => {
  it('finds constructs inside the spec', () => {
    const coverage = assessCoverage(
      ['/repo/login.component.ts'],
      fsWith({ '/repo/login.component.spec.ts': SPEC_USING_FORMS }),
    );

    expect(coverage.specsUsingForms).toHaveLength(1);
    expect(coverage.specsUsingForms[0]?.spec).toBe('/repo/login.component.spec.ts');
    expect(coverage.specsUsingForms[0]?.findings).toBeGreaterThan(0);
  });

  it('ignores specs that never touch forms', () => {
    const coverage = assessCoverage(
      ['/repo/price.service.ts'],
      fsWith({ '/repo/price.service.spec.ts': SPEC_WITHOUT_FORMS }),
    );

    expect(coverage.specsUsingForms).toEqual([]);
  });

  it('does NOT fold spec findings into the migration totals', () => {
    const findings: FileFindings[] = [
      {
        file: '/repo/login.component.ts',
        findings: [
          {
            construct: 'FormGroup',
            line: 1,
            snippet: 'new FormGroup({})',
            classification: 'mechanical',
            reason: 'r',
            definesForm: true,
          },
        ],
      },
    ];
    const coverage = assessCoverage(
      ['/repo/login.component.ts'],
      fsWith({ '/repo/login.component.spec.ts': SPEC_USING_FORMS }),
    );

    const report = buildMigrationReport('/repo', findings, undefined, coverage);

    // One finding in the counts, even though the spec contains several.
    expect(report).toMatch(/\b1\b/);
    expect(report).toContain('NOT counted above');
    expect(report).toContain('login.component.spec.ts');
  });

  it('points at the testing recipe rather than leaving the reader guessing', () => {
    const coverage = assessCoverage(
      ['/repo/login.component.ts'],
      fsWith({ '/repo/login.component.spec.ts': SPEC_USING_FORMS }),
    );
    const report = buildMigrationReport(
      '/repo',
      [
        {
          file: '/repo/login.component.ts',
          findings: [
            {
              construct: 'FormGroup',
              line: 1,
              snippet: 'new FormGroup({})',
              classification: 'mechanical',
              reason: 'r',
              definesForm: true,
            },
          ],
        },
      ],
      undefined,
      coverage,
    );

    expect(report).toContain('`testing` recipe');
    expect(report).toMatch(/injection context/i);
  });

  it('stays silent when there is nothing to migrate in the first place', () => {
    const coverage = assessCoverage(
      ['/repo/login.component.ts'],
      fsWith({ '/repo/login.component.spec.ts': SPEC_USING_FORMS }),
    );
    const report = buildMigrationReport('/repo', [], undefined, coverage);

    expect(report).toContain('No Reactive Forms constructs');
    expect(report).not.toContain('NOT counted above');
  });
});

describe('the testing recipe', () => {
  const recipe = getSignalFormsRecipe('testing');

  it('exists and is reachable by the obvious words', () => {
    expect(recipe.found).toBe(true);
    for (const spelling of ['spec', 'tests', 'unitTest']) {
      expect(getSignalFormsRecipe(spelling).found, spelling).toBe(true);
    }
  });

  it('leads with the injection-context blocker', () => {
    if (!recipe.found) throw new Error('missing recipe');
    const caveats = recipe.caveats.join('\n');
    expect(caveats).toContain('INJECTION CONTEXT IS THE BLOCKER');
    expect(recipe.after).toContain('TestBed.inject(Injector)');
    expect(recipe.after).toContain('runInInjectionContext');
  });

  it('admits what the testing guide does not document', () => {
    if (!recipe.found) throw new Error('missing recipe');
    expect(recipe.caveats.join('\n')).toMatch(/UNVERIFIED[\s\S]*no test harness/);
  });
});
