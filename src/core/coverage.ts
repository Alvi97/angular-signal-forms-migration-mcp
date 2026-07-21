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

export interface CoverageReport {
  /** Files with a spec that has actual content. */
  readonly covered: string[];
  /** Files with no spec file at all. */
  readonly uncovered: string[];
  /** Files whose spec exists but is empty — the most misleading state of the three. */
  readonly emptySpec: string[];
  readonly total: number;
  /** uncovered + emptySpec: files that will be rewritten with nothing verifying them. */
  readonly unprotected: number;
}

/** `foo.component.ts` -> `foo.component.spec.ts`. */
function specPathFor(file: string): string {
  return file.replace(/\.ts$/, '.spec.ts');
}

export function assessCoverage(files: readonly string[], fs: FileSystemPort): CoverageReport {
  const covered: string[] = [];
  const uncovered: string[] = [];
  const emptySpec: string[] = [];

  for (const file of files) {
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
    else covered.push(file);
  }

  return {
    covered,
    uncovered,
    emptySpec,
    total: files.length,
    unprotected: uncovered.length + emptySpec.length,
  };
}
