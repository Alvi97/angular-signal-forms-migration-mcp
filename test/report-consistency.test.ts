import { describe, expect, it } from 'vitest';
import { buildMigrationReport } from '../src/core/report.js';
import { analyzeMigrationComplexity } from '../src/core/complexity.js';
import { detectInSource } from '../src/core/detect.js';
import { getSignalFormsRecipe } from '../src/core/recipes.js';
import type { AngularVersion } from '../src/core/angular-version.js';
import type { FileFindings } from '../src/core/types.js';

// The report states things twice, as prose and as tables. These invariants check the two
// never drift (a "decide these early" section once shipped while the table ranked it last).

const IMPORT = `import { AbstractControl, FormArray, FormBuilder, FormControl, FormGroup, Validators, ValidatorFn } from '@angular/forms';`;

function file(path: string, source: string): FileFindings {
  return { file: path, findings: detectInSource(path, `${IMPORT}\n${source}`) };
}

/** A workspace exercising every role, classification and section at once. */
const WORKSPACE: readonly FileFindings[] = [
  file(
    '/repo/shared/validators.ts',
    `export function match(): ValidatorFn { return (c: AbstractControl) => null; }
     export function strict(): ValidatorFn { return (c: AbstractControl) => null; }`,
  ),
  file(
    '/repo/simple.component.ts',
    `export class S {
       constructor(private fb: FormBuilder) {}
       form = this.fb.group({ email: ['', [Validators.required]] });
     }`,
  ),
  file(
    '/repo/hard.component.ts',
    `export class H {
       form: FormGroup;
       form2 = new FormGroup({ a: new FormControl('') }, { validator: this.chk });
       constructor(private fb: FormBuilder) { this.form = this.fb.group({ a: [''] }); }
       go() {
         Object.keys(this.form.controls).forEach((k) => this.form.get(k)?.markAsTouched());
         this.form.valueChanges.subscribe(() => this.x());
       }
     }`,
  ),
  file('/repo/wrapper.ts', `export class W { get r() { return this.p.f as FormArray; } }`),
  file('/repo/empty.ts', `export class E {}`),
];

const V22: AngularVersion = {
  known: true,
  raw: '22.0.7',
  major: 22,
  source: 'node_modules',
  from: '/repo/node_modules/@angular/core/package.json',
  straddlesGate: false,
};
const V19: AngularVersion = { ...V22, raw: '19.2.6', major: 19 };

/** Row order of the "Suggested order" table, as the reader sees it. */
function orderTableFiles(report: string): string[] {
  const section = report.slice(
    report.indexOf('## Suggested order'),
    report.indexOf('## Constructs'),
  );
  return [...section.matchAll(/^\|\s*\d+\s*\|\s*`([^`]+)`/gm)].map((m) => m[1] ?? '');
}
function orderTableRoles(report: string): string[] {
  const section = report.slice(
    report.indexOf('## Suggested order'),
    report.indexOf('## Constructs'),
  );
  return [...section.matchAll(/^\|\s*\d+\s*\|\s*`[^`]+`\s*\|\s*([^|]+?)\s*\|/gm)].map(
    (m) => m[1] ?? '',
  );
}

describe('the report never contradicts itself', () => {
  const complexity = analyzeMigrationComplexity(WORKSPACE);
  const report = buildMigrationReport('/repo', WORKSPACE, V22);

  it('ranks every file it tells you to decide early, early', () => {
    // The exact contradiction that shipped.
    const order = complexity.suggestedOrder;
    const lastValidator = Math.max(...complexity.sharedValidatorFiles.map((f) => order.indexOf(f)));
    const firstOwner = order.findIndex(
      (f) =>
        !complexity.sharedValidatorFiles.includes(f) && !complexity.referenceOnlyFiles.includes(f),
    );
    expect(complexity.sharedValidatorFiles.length).toBeGreaterThan(0);
    expect(lastValidator).toBeLessThan(firstOwner);
  });

  it('ranks every file it says cannot be migrated alone, last', () => {
    const order = complexity.suggestedOrder;
    const firstReference = Math.min(...complexity.referenceOnlyFiles.map((f) => order.indexOf(f)));
    const lastOther = order.reduce(
      (acc, f, i) => (complexity.referenceOnlyFiles.includes(f) ? acc : i),
      -1,
    );
    expect(complexity.referenceOnlyFiles.length).toBeGreaterThan(0);
    expect(firstReference).toBeGreaterThan(lastOther);
  });

  it('labels each table row with the role the data actually assigns it', () => {
    const files = orderTableFiles(report);
    const roles = orderTableRoles(report);
    expect(files.length).toBe(roles.length);

    files.forEach((shortened, i) => {
      const full = complexity.suggestedOrder.find((f) => f.endsWith(shortened));
      expect(full, shortened).toBeDefined();
      if (full === undefined) return;
      const expected = complexity.sharedValidatorFiles.includes(full)
        ? 'decide first'
        : complexity.referenceOnlyFiles.includes(full)
          ? 'reference only'
          : 'form owner';
      expect(roles[i], shortened).toBe(expected);
    });
  });

  it('orders the table exactly as the analysis does', () => {
    const shortened = complexity.suggestedOrder.map((f) => f.replace('/repo/', ''));
    expect(orderTableFiles(report)).toEqual(shortened);
  });
});

describe('the report never contradicts its own arithmetic', () => {
  const complexity = analyzeMigrationComplexity(WORKSPACE);
  const report = buildMigrationReport('/repo', WORKSPACE, V22);

  it('splits every finding into exactly one classification', () => {
    expect(complexity.mechanicalCount + complexity.judgmentCount).toBe(complexity.totalFindings);
  });

  it('counts the same total by construct as overall', () => {
    const summed = Object.values(complexity.byConstruct).reduce((a, b) => a + b, 0);
    expect(summed).toBe(complexity.totalFindings);
  });

  it('lists exactly the files that have findings — no phantoms, no omissions', () => {
    const withFindings = WORKSPACE.filter((f) => f.findings.length > 0).map((f) => f.file);
    expect([...complexity.suggestedOrder].sort()).toEqual([...withFindings].sort());
  });

  it('prints the same totals in the summary as the analysis computed', () => {
    expect(report).toContain(`| Total findings | ${String(complexity.totalFindings)} |`);
    expect(report).toContain(`| Mechanical | ${String(complexity.mechanicalCount)} |`);
    expect(report).toContain(`| Judgment | ${String(complexity.judgmentCount)} |`);
  });

  it('has per-file rows that add up to the stated total', () => {
    const section = report.slice(
      report.indexOf('## Suggested order'),
      report.indexOf('## Constructs'),
    );
    const perFile = [...section.matchAll(/^\|\s*\d+\s*\|[^|]+\|[^|]+\|\s*(\d+)\s*\|/gm)].map((m) =>
      Number.parseInt(m[1] ?? '0', 10),
    );
    expect(perFile.reduce((a, b) => a + b, 0)).toBe(complexity.totalFindings);
  });
});

describe('the report never promises a recipe it does not have', () => {
  const complexity = analyzeMigrationComplexity(WORKSPACE);
  const report = buildMigrationReport('/repo', WORKSPACE, V22);

  it('names a real recipe for every construct it lists', () => {
    for (const construct of Object.keys(complexity.byConstruct)) {
      const lookup = getSignalFormsRecipe(construct);
      // Either it resolves, or the table must say so plainly rather than naming nothing.
      if (!lookup.found) {
        expect(report).toContain('_(no recipe yet)_');
        continue;
      }
      expect(report).toContain(`\`${lookup.construct}\``);
    }
  });

  it('only claims version-sensitivity for constructs actually present', () => {
    const flaggedSection = report.slice(report.indexOf('## Read the caveats'));
    for (const construct of Object.keys(complexity.byConstruct)) {
      const lookup = getSignalFormsRecipe(construct);
      if (lookup.found && !lookup.provenance.versionSensitive) {
        // A recipe that is not version-sensitive must not appear as a bullet there.
        expect(flaggedSection).not.toContain(`- \`${lookup.construct}\` — VERSION-SENSITIVE`);
      }
    }
  });
});

describe('the report never tells you to start a migration it just blocked', () => {
  it('puts the blocker above every actionable section', () => {
    const blocked = buildMigrationReport('/repo', WORKSPACE, V19);
    const blocker = blocked.indexOf('BLOCKING PREREQUISITE');

    expect(blocker).toBeGreaterThan(-1);
    for (const section of ['## Summary', '## Suggested order', '## Constructs found']) {
      expect(blocked.indexOf(section), section).toBeGreaterThan(blocker);
    }
  });

  it('frames the plan as post-upgrade rather than as work to begin', () => {
    const blocked = buildMigrationReport('/repo', WORKSPACE, V19);
    expect(blocked).toMatch(/post-upgrade blueprint/i);
  });

  it('does not resolve version-sensitive recipes it cannot resolve', () => {
    // On v19 the v21-vs-v22 divergence describes nothing about this project.
    const blocked = buildMigrationReport('/repo', WORKSPACE, V19);
    expect(blocked).toMatch(/neither/i);
    expect(blocked).not.toMatch(/Apply them as written/);
  });
});

describe('consistency holds for degenerate workspaces too', () => {
  it.each([
    ['only validators', [WORKSPACE[0]!]],
    ['only a reference-only file', [WORKSPACE[3]!]],
    ['only empty files', [WORKSPACE[4]!]],
    ['a single owner', [WORKSPACE[1]!]],
  ])('%s', (_label, files) => {
    const complexity = analyzeMigrationComplexity(files);
    const report = buildMigrationReport('/repo', files, V22);

    expect(complexity.mechanicalCount + complexity.judgmentCount).toBe(complexity.totalFindings);
    // A section must never list a file that the order does not contain.
    for (const listed of [...complexity.sharedValidatorFiles, ...complexity.referenceOnlyFiles]) {
      expect(complexity.suggestedOrder).toContain(listed);
    }
    // An empty scan must not render an order table at all.
    if (complexity.totalFindings === 0) {
      expect(report).not.toContain('## Suggested order');
      expect(report).toContain('No Reactive Forms constructs');
    }
  });
});

/**
 * Live bugs are not migration work.
 *
 * The dead-validator detection shipped and then went unnoticed by a reader, because it
 * rendered as one row among twenty in the construct table — visually identical to
 * `Validators.pattern`. An earlier report, produced BEFORE the detection existed, gave the
 * same bug its own section because a human found it by hand. Capability went up and the
 * outcome went down, which means the placement was wrong, not the detection.
 */
describe('live bugs are surfaced, not buried', () => {
  const buggy: readonly FileFindings[] = [
    file(
      '/repo/reset.component.ts',
      // The constructor form, which really does drop the validator. fb.group does not.
      `export class R {
         form = new FormGroup({ a: new FormControl('') }, { validator: this.chk });
       }`,
    ),
    ...WORKSPACE,
  ];

  const report = buildMigrationReport('/repo', buggy, V22);

  it('gives them their own section', () => {
    expect(report).toContain('## Bugs found');
  });

  it('puts them above the migration plan', () => {
    expect(report.indexOf('## Bugs found')).toBeLessThan(report.indexOf('## Summary'));
  });

  it('names the file and line so they can be fixed without a search', () => {
    expect(report).toMatch(/reset\.component\.ts:\d+/);
  });

  it('says these are fixable now, independent of the migration', () => {
    const section = report.slice(report.indexOf('## Bugs found'), report.indexOf('## Summary'));
    expect(section).toMatch(/before migrating|independently|today/i);
  });

  it('still surfaces them when the migration itself is blocked', () => {
    // A version gate stops the migration; it does not stop a one-word bug fix.
    const blocked = buildMigrationReport('/repo', buggy, V19);
    expect(blocked).toContain('## Bugs found');
    expect(blocked.indexOf('BLOCKING PREREQUISITE')).toBeLessThan(blocked.indexOf('## Bugs found'));
  });

  it('says nothing when there are no bugs', () => {
    // WORKSPACE's hard.component.ts deliberately carries the same typo, so a clean
    // workspace has to exclude it.
    const clean = WORKSPACE.filter((f) => !f.file.includes('hard.component'));
    expect(buildMigrationReport('/repo', clean, V22)).not.toContain('## Bugs found');
  });
});
