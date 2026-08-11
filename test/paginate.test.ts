import { describe, expect, it } from 'vitest';
import { pageFindings } from '../src/core/paginate.js';
import type { FileFindings, Finding } from '../src/core/types.js';

function finding(
  construct: string,
  line: number,
  classification: 'mechanical' | 'judgment',
): Finding {
  return {
    construct,
    line,
    snippet: `// ${construct}`,
    classification,
    reason: `reason for ${construct}`,
    definesForm: false,
  };
}

const FILES: FileFindings[] = [
  {
    file: '/repo/a.ts',
    findings: [
      finding('FormGroup', 1, 'mechanical'),
      finding('FormArray.push', 2, 'judgment'),
      finding('Validators.required', 3, 'mechanical'),
    ],
  },
  {
    file: '/repo/b.ts',
    findings: [finding('FormControl', 1, 'mechanical'), finding('asyncValidator', 2, 'judgment')],
  },
  { file: '/repo/c.ts', findings: [finding('FormGroup', 9, 'mechanical')] },
];

const TOTAL = 6;

/** Flattens a page back to (file, construct, line) triples, in order. */
function flatten(
  files: readonly { readonly file: string; readonly findings: readonly Finding[] }[],
): string[] {
  return files.flatMap((f) => f.findings.map((x) => `${f.file}:${String(x.line)}:${x.construct}`));
}

describe('pageFindings', () => {
  it('returns everything and signals complete when it fits', () => {
    const page = pageFindings(FILES, { offset: 0, limit: 100 });
    expect(page.page.returned).toBe(TOTAL);
    expect(page.page.totalMatched).toBe(TOTAL);
    expect(page.page.truncated).toBe(false);
    expect(page.page.nextOffset).toBeNull();
    expect(page.incomplete).toBeNull();
  });

  /**
   * The property that makes nextOffset trustworthy. If concatenating the pages did not
   * reproduce the whole list in order, an agent walking the pages would silently skip work.
   */
  it('concatenating every page reproduces the unpaginated list exactly', () => {
    for (const limit of [1, 2, 3, 5, 6, 7]) {
      const seen: string[] = [];
      let offset: number | null = 0;
      let guard = 0;
      while (offset !== null && guard++ < 50) {
        const page = pageFindings(FILES, { offset, limit });
        seen.push(...flatten(page.files));
        offset = page.page.nextOffset;
      }
      expect(seen, `limit ${String(limit)}`).toEqual(flatten(FILES));
    }
  });

  it('marks a partially returned file rather than implying it is whole', () => {
    const page = pageFindings(FILES, { offset: 0, limit: 2 });
    const first = page.files[0];
    expect(first?.file).toBe('/repo/a.ts');
    expect(first?.findings).toHaveLength(2);
    expect(first?.matchedInFile).toBe(3);
    expect(first?.partial).toBe(true);
  });

  it('a truncated page always carries a non-null incomplete notice', () => {
    const page = pageFindings(FILES, { offset: 0, limit: 2 });
    expect(page.page.truncated).toBe(true);
    expect(page.incomplete).not.toBeNull();
    expect(page.incomplete).toContain('offset');
  });

  it('filters by construct, and says so in the unfiltered total', () => {
    const page = pageFindings(FILES, { offset: 0, limit: 100, constructs: ['FormGroup'] });
    expect(page.page.returned).toBe(2);
    expect(page.page.totalMatched).toBe(2);
    expect(page.page.totalUnfiltered).toBe(TOTAL);
    // A filter is not truncation: everything matching was returned.
    expect(page.page.truncated).toBe(false);
    // But the agent must still see that the scan held more than this.
    expect(page.incomplete).not.toBeNull();
  });

  it('filters by classification', () => {
    const page = pageFindings(FILES, { offset: 0, limit: 100, classification: 'judgment' });
    expect(flatten(page.files)).toEqual([
      '/repo/a.ts:2:FormArray.push',
      '/repo/b.ts:2:asyncValidator',
    ]);
  });

  it('drops files with no matching findings rather than returning empty shells', () => {
    const page = pageFindings(FILES, { offset: 0, limit: 100, constructs: ['asyncValidator'] });
    expect(page.files.map((f) => f.file)).toEqual(['/repo/b.ts']);
  });

  it('an offset past the end is empty and terminal, not an error', () => {
    const page = pageFindings(FILES, { offset: 999, limit: 10 });
    expect(page.files).toEqual([]);
    expect(page.page.returned).toBe(0);
    expect(page.page.nextOffset).toBeNull();
    expect(page.incomplete).not.toBeNull();
  });

  /** The invariant the whole design rests on: silence must mean complete. */
  it('incomplete is null if and only if the response is the whole picture', () => {
    const cases = [
      { offset: 0, limit: 100 },
      { offset: 0, limit: 2 },
      { offset: 4, limit: 100 },
      { offset: 0, limit: 100, constructs: ['FormGroup'] },
      { offset: 0, limit: 100, classification: 'judgment' as const },
    ];
    for (const options of cases) {
      const page = pageFindings(FILES, options);
      const whole =
        page.page.returned === page.page.totalMatched &&
        page.page.totalMatched === page.page.totalUnfiltered;
      expect(page.incomplete === null, JSON.stringify(options)).toBe(whole);
    }
  });
});
