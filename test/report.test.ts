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

  it('gives the suggested order simplest-first', () => {
    const login = report.indexOf('login.component.ts');
    const validators = report.indexOf('validators.ts');
    expect(login).toBeGreaterThan(-1);
    expect(login).toBeLessThan(validators);
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
