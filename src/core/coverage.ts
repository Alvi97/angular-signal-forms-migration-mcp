/**
 * Test coverage of the files a migration will rewrite — pure.
 *
 * Three separate live runs against real codebases independently reached the same
 * conclusion: "my verification signal is the compiler, not the tests, because the files
 * I'm rewriting have no covering tests." The report never said so, leaving each operator
 * to discover it.
 *
 * A rewrite with no test underneath is not a blocker, but it changes how the work should
 * be sequenced — and it is knowable before a line is changed.
 */
import type { FileSystemPort } from './detect.js';

/**
 * Files that decide whether ANY spec in a project runs.
 *
 * A zero-byte one of these takes down every suite beneath it while looking present to
 * every tool that checks. That is not hypothetical: it silenced five auth suites for
 * months, and the failure surfaced as an unrelated-looking parse error.
 */
const HARNESS_FILES = ['jest.config.ts', 'jest.config.js', 'src/test-setup.ts', 'test-setup.ts'];

export interface CoverageReport {
  /** Files with a spec that has content AND a harness that can run it. */
  readonly covered: string[];
  /** Files with no spec file at all. */
  readonly uncovered: string[];
  /** Files whose spec exists but is empty — the most misleading state of the three. */
  readonly emptySpec: string[];
  readonly total: number;
  /**
   * Empty harness files found above the scanned sources. While one of these exists, every
   * spec under it is inert regardless of its contents.
   */
  readonly brokenHarness: string[];
  /** Files that will be rewritten with nothing actually verifying them. */
  readonly unprotected: number;
}

function parentOf(path: string): string | undefined {
  const index = path.lastIndexOf('/');
  return index <= 0 ? undefined : path.slice(0, index);
}

/** Empty harness files in any directory above `file`. */
function brokenHarnessFor(file: string, fs: FileSystemPort): string[] {
  const found: string[] = [];
  let dir = parentOf(file);

  while (dir !== undefined && dir !== '') {
    for (const candidate of HARNESS_FILES) {
      const path = `${dir}/${candidate}`;
      if (!fs.exists(path)) continue;
      try {
        if (fs.readFile(path).trim() === '') found.push(path);
      } catch {
        // Unreadable is not evidence of emptiness.
      }
    }
    dir = parentOf(dir);
  }
  return found;
}

/** `foo.component.ts` -> `foo.component.spec.ts`. */
function specPathFor(file: string): string {
  return file.replace(/\.ts$/, '.spec.ts');
}

export function assessCoverage(files: readonly string[], fs: FileSystemPort): CoverageReport {
  const covered: string[] = [];
  const uncovered: string[] = [];
  const emptySpec: string[] = [];
  const brokenHarness = new Set<string>();

  for (const file of files) {
    for (const broken of brokenHarnessFor(file, fs)) brokenHarness.add(broken);

    const spec = specPathFor(file);
    if (!fs.exists(spec)) {
      uncovered.push(file);
      continue;
    }

    let contents: string;
    try {
      contents = fs.readFile(spec);
    } catch {
      // Unreadable is indistinguishable from absent for our purposes.
      uncovered.push(file);
      continue;
    }

    // A zero-byte or whitespace-only spec is worse than a missing one: tooling counts it
    // as present, so it reads as coverage right up until the suite fails to parse.
    if (contents.trim() === '') emptySpec.push(file);
    // A perfectly good spec under a broken harness still verifies nothing.
    else if (brokenHarnessFor(file, fs).length > 0) emptySpec.push(file);
    else covered.push(file);
  }

  return {
    covered,
    uncovered,
    emptySpec,
    total: files.length,
    brokenHarness: [...brokenHarness].sort((a, b) => a.localeCompare(b)),
    unprotected: uncovered.length + emptySpec.length,
  };
}
