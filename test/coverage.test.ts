import { describe, expect, it } from 'vitest';
import { assessCoverage } from '../src/core/coverage.js';
import { memoryFs } from './helpers/memory-fs.js';

// Whether the files being rewritten have covering tests: a first-class migration risk.
describe('assessCoverage', () => {
  const fs = memoryFs({
    '/repo/a.component.ts': 'x',
    '/repo/a.component.spec.ts': 'describe("a", () => { it("works", () => {}); });',
    '/repo/b.component.ts': 'x',
    '/repo/c.component.ts': 'x',
    '/repo/c.component.spec.ts': '',
    '/repo/d.component.ts': 'x',
    '/repo/d.component.spec.ts': '   \n  ',
  });

  it('recognises a real spec as covering', () => {
    expect(assessCoverage(['/repo/a.component.ts'], fs).covered).toEqual(['/repo/a.component.ts']);
  });

  it('reports a missing spec', () => {
    expect(assessCoverage(['/repo/b.component.ts'], fs).uncovered).toEqual([
      '/repo/b.component.ts',
    ]);
  });

  it('treats a zero-byte spec as worse than none — it looks like coverage', () => {
    // Exactly what bit a live upgrade: empty jest config and setup files that read as
    // present until the suites failed to parse.
    const result = assessCoverage(['/repo/c.component.ts'], fs);
    expect(result.emptySpec).toEqual(['/repo/c.component.ts']);
    expect(result.covered).toEqual([]);
  });

  it('treats a whitespace-only spec the same way', () => {
    expect(assessCoverage(['/repo/d.component.ts'], fs).emptySpec).toEqual([
      '/repo/d.component.ts',
    ]);
  });

  it('summarises how much of the migration is unprotected', () => {
    const result = assessCoverage(
      ['/repo/a.component.ts', '/repo/b.component.ts', '/repo/c.component.ts'],
      fs,
    );
    expect(result.total).toBe(3);
    expect(result.unprotected).toBe(2);
  });

  it('never throws on an unreadable path', () => {
    expect(() => assessCoverage(['/nope/x.ts'], fs)).not.toThrow();
    expect(assessCoverage(['/nope/x.ts'], fs).uncovered).toEqual(['/nope/x.ts']);
  });
});

/**
 * "Has a spec file" is not "has working tests", and conflating them produced a false
 * claim. In a real workspace login.component.spec.ts existed at 880 bytes — so it counted
 * as covered — while every suite in that project failed to run, because the project's
 * jest.config.ts was zero bytes. The report said 5 of 8 files were unprotected; the true
 * answer was 8 of 8.
 */
describe('broken test infrastructure invalidates the coverage claim', () => {
  const broken = memoryFs({
    '/repo/libs/frontend/jest.config.ts': '',
    '/repo/libs/frontend/src/test-setup.ts': 'import "x";',
    '/repo/libs/frontend/src/login.component.ts': 'x',
    '/repo/libs/frontend/src/login.component.spec.ts': 'describe("l", () => it("x", () => {}));',
  });

  it('flags a zero-byte jest config above the file', () => {
    const result = assessCoverage(['/repo/libs/frontend/src/login.component.ts'], broken);
    expect(result.brokenHarness).toEqual(['/repo/libs/frontend/jest.config.ts']);
  });

  it('does not count a file as covered when its harness cannot run', () => {
    const result = assessCoverage(['/repo/libs/frontend/src/login.component.ts'], broken);
    expect(result.covered).toEqual([]);
    expect(result.unprotected).toBe(1);
  });

  it('flags an empty test-setup too', () => {
    const fs = memoryFs({
      '/repo/p/jest.config.ts': 'export default {};',
      '/repo/p/src/test-setup.ts': '   ',
      '/repo/p/src/a.component.ts': 'x',
      '/repo/p/src/a.component.spec.ts': 'describe("a", () => it("x", () => {}));',
    });
    expect(assessCoverage(['/repo/p/src/a.component.ts'], fs).brokenHarness).toEqual([
      '/repo/p/src/test-setup.ts',
    ]);
  });

  it('stays quiet when the harness is fine', () => {
    const fs = memoryFs({
      '/repo/p/jest.config.ts': 'export default { preset: "x" };',
      '/repo/p/src/a.component.ts': 'x',
      '/repo/p/src/a.component.spec.ts': 'describe("a", () => it("x", () => {}));',
    });
    const result = assessCoverage(['/repo/p/src/a.component.ts'], fs);
    expect(result.brokenHarness).toEqual([]);
    expect(result.covered).toEqual(['/repo/p/src/a.component.ts']);
  });
});
