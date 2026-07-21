import { describe, expect, it } from 'vitest';
import { analyzeMigrationComplexity } from '../src/core/complexity.js';
import type { FileFindings } from '../src/core/types.js';

function file(
  path: string,
  findings: ReadonlyArray<[string, 'mechanical' | 'judgment']>,
): FileFindings {
  return {
    file: path,
    findings: findings.map(([construct, classification], index) => ({
      construct,
      line: index + 1,
      snippet: `// ${construct}`,
      classification,
      reason: 'test fixture',
    })),
  };
}

const SIMPLE = file('/app/login.ts', [
  ['FormBuilder.group', 'mechanical'],
  ['Validators.required', 'mechanical'],
]);
const MIXED = file('/app/register.ts', [
  ['FormBuilder.group', 'mechanical'],
  ['Validators.required', 'mechanical'],
  ['Validators.email', 'mechanical'],
  ['valueChanges', 'judgment'],
]);
const HARD = file('/app/validators.ts', [
  ['customValidator', 'judgment'],
  ['asyncValidator', 'judgment'],
]);

describe('analyzeMigrationComplexity', () => {
  it('totals findings and splits them by classification', () => {
    const result = analyzeMigrationComplexity([SIMPLE, MIXED, HARD]);

    expect(result.totalFindings).toBe(8);
    expect(result.mechanicalCount).toBe(5);
    expect(result.judgmentCount).toBe(3);
  });

  it('counts by construct', () => {
    const result = analyzeMigrationComplexity([SIMPLE, MIXED, HARD]);

    expect(result.byConstruct['Validators.required']).toBe(2);
    expect(result.byConstruct['FormBuilder.group']).toBe(2);
    expect(result.byConstruct['asyncValidator']).toBe(1);
  });

  it('orders files simplest-first: all-mechanical before any judgment', () => {
    const result = analyzeMigrationComplexity([HARD, MIXED, SIMPLE]);

    expect(result.suggestedOrder).toEqual([
      '/app/login.ts',
      '/app/register.ts',
      '/app/validators.ts',
    ]);
  });

  it('breaks ties on total size so the smaller file comes first', () => {
    const small = file('/app/a.ts', [['FormControl', 'mechanical']]);
    const large = file('/app/b.ts', [
      ['FormControl', 'mechanical'],
      ['FormGroup', 'mechanical'],
      ['Validators.min', 'mechanical'],
    ]);

    expect(analyzeMigrationComplexity([large, small]).suggestedOrder).toEqual([
      '/app/a.ts',
      '/app/b.ts',
    ]);
  });

  it('is stable and total on empty input', () => {
    const result = analyzeMigrationComplexity([]);

    expect(result.totalFindings).toBe(0);
    expect(result.mechanicalCount).toBe(0);
    expect(result.judgmentCount).toBe(0);
    expect(result.byConstruct).toEqual({});
    expect(result.suggestedOrder).toEqual([]);
  });

  it('ignores files that produced no findings', () => {
    const result = analyzeMigrationComplexity([SIMPLE, file('/app/empty.ts', [])]);

    expect(result.suggestedOrder).toEqual(['/app/login.ts']);
  });
});
