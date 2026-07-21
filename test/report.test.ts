import { describe, expect, it } from 'vitest';
import { buildMigrationReport } from '../src/core/report.js';
import type { FileFindings } from '../src/core/types.js';

function file(
  path: string,
  findings: ReadonlyArray<[string, 'mechanical' | 'judgment']>,
): FileFindings {
  return {
    file: path,
    findings: findings.map(([construct, classification], index) => ({
      construct,
      line: index + 10,
      snippet: `// ${construct}`,
      classification,
      // Constructing findings define a form; the rest merely reference one.
      definesForm: /^(FormControl|FormGroup|FormArray|FormBuilder\.(group|control|array))$/.test(
        construct,
      ),
      reason: `reason for ${construct}`,
    })),
  };
}

const MIXED: readonly FileFindings[] = [
  file('/repo/src/app/login.component.ts', [
    ['FormBuilder.group', 'mechanical'],
    ['Validators.required', 'mechanical'],
  ]),
  file('/repo/src/app/order.component.ts', [
    ['FormArray', 'judgment'],
    ['FormArray.push', 'judgment'],
    ['Validators.required', 'mechanical'],
  ]),
  file('/repo/src/app/validators.ts', [['customValidator', 'judgment']]),
];

describe('buildMigrationReport', () => {
  const report = buildMigrationReport('/repo/src/app', MIXED);

  it('returns a markdown string, and writes nothing', () => {
    expect(typeof report).toBe('string');
    expect(report.startsWith('#')).toBe(true);
  });

  it('states the scanned path and the headline totals', () => {
    expect(report).toContain('/repo/src/app');
    expect(report).toContain('6'); // total findings
    expect(report).toMatch(/3\s*\|?\s*mechanical|mechanical.*3/i);
  });

  it('lists every file, relative to the scanned root so the table stays readable', () => {
    for (const entry of MIXED) {
      const relative = entry.file.replace('/repo/src/app/', '');
      expect(report, relative).toContain(relative);
      // The absolute root is stated once at the top rather than repeated per row.
      expect(report).not.toContain(entry.file);
    }
  });

  it('includes a construct count table', () => {
    expect(report).toContain('Validators.required');
    expect(report).toContain('FormArray');
  });

  it('orders form owners simplest-first', () => {
    const login = report.indexOf('login.component.ts');
    const order = report.indexOf('order.component.ts');
    expect(login).toBeGreaterThan(-1);
    // login has 0 judgment calls, order has 2.
    expect(login).toBeLessThan(order);
  });

  it('labels each row with why it sits there', () => {
    expect(report).toContain('| Role |');
    expect(report).toContain('form owner');
  });

  it('explains that shared validators lead for design reasons, not ease', () => {
    expect(report).toMatch(/Decide their design first/i);
  });

  it('names every judgment finding with its line and reason', () => {
    expect(report).toContain('customValidator');
    expect(report).toContain('reason for customValidator');
  });

  it('points at the recipes to look up', () => {
    expect(report).toContain('get_signalforms_recipe');
  });

  it('calls out version-sensitive recipes when a relevant construct is present', () => {
    // Validators.required is flagged versionSensitive, so the report must warn.
    expect(report).toMatch(/VERSION-SENSITIVE|version-sensitive/);
  });

  it('does not warn about version sensitivity when no such construct appears', () => {
    const clean = buildMigrationReport('/repo', [
      file('/repo/a.ts', [['FormBuilder', 'mechanical']]),
    ]);
    expect(clean).not.toMatch(/VERSION-SENSITIVE/);
  });

  it('handles an empty scan without pretending there is work', () => {
    const empty = buildMigrationReport('/repo/src/empty', []);
    expect(empty).toContain('No Reactive Forms constructs');
    expect(empty).not.toContain('Suggested order');
  });
});

/* -------------------------------------------------------------------------- */
/* Version gate                                                                */
/* -------------------------------------------------------------------------- */

import type { AngularVersion } from '../src/core/angular-version.js';

const v = (major: number, raw = `${major}.0.0`): AngularVersion => ({
  known: true,
  raw,
  major,
  source: 'node_modules',
  from: '/repo/node_modules/@angular/core/package.json',
});
const unknown: AngularVersion = { known: false, reason: 'No package.json was found.' };

describe('blocking prerequisite when Signal Forms is unavailable', () => {
  it.each([19, 20])('blocks on Angular v%i', (major) => {
    const report = buildMigrationReport('/repo', MIXED, v(major, `${major}.3.25`));

    // The blocker must come FIRST — a plan rendered above it would be acted on.
    const blockerAt = report.indexOf('BLOCKING PREREQUISITE');
    expect(blockerAt).toBeGreaterThan(-1);
    expect(blockerAt).toBeLessThan(report.indexOf('## Summary'));

    expect(report).toContain(`${major}.3.25`);
    expect(report).toContain('@angular/forms/signals');
    expect(report).toMatch(/21\+|v21/);
  });

  it('still renders the full plan below the blocker — it is the post-upgrade blueprint', () => {
    const report = buildMigrationReport('/repo', MIXED, v(20));
    expect(report).toContain('## Summary');
    expect(report).toContain('## Suggested order');
    expect(report).toContain('## Constructs found');
  });

  it.each([21, 22, 23])('does not block on Angular v%i', (major) => {
    expect(buildMigrationReport('/repo', MIXED, v(major))).not.toContain('BLOCKING PREREQUISITE');
  });

  it('warns rather than blocks when the version cannot be determined', () => {
    const report = buildMigrationReport('/repo', MIXED, unknown);
    expect(report).not.toContain('BLOCKING PREREQUISITE');
    expect(report).toContain('could not determine');
  });
});

describe('version-sensitive recipes resolve against the detected version', () => {
  it('names the applicable variant when the target is on a covered version', () => {
    const report = buildMigrationReport('/repo', MIXED, v(22));
    expect(report).toMatch(/verified against .*v22|matches your Angular/i);
  });

  it('says so explicitly when the target is on NEITHER diverging version', () => {
    // Angular 20: the v21-vs-v22 divergence does not describe this project at all.
    const report = buildMigrationReport('/repo', MIXED, v(20));
    expect(report).toMatch(/neither/i);
  });
});
