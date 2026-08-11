/**
 * Test coverage of the files a migration will rewrite (pure). A rewrite with no test isn't a
 * blocker, but it changes how the work should be sequenced, and it's knowable up front.
 */
import { detectInSource, type FileSystemPort } from './detect.js';

/** Files that decide whether any spec runs; a zero-byte one silently disables every suite below. */
const HARNESS_FILES = ['jest.config.ts', 'jest.config.js', 'src/test-setup.ts', 'test-setup.ts'];

export interface CoverageReport {
  /** Files with a spec that has content AND a harness that can run it. */
  readonly covered: string[];
  /** Files with no spec file at all. */
  readonly uncovered: string[];
  /** Files whose spec exists but is empty; the most misleading state of the three. */
  readonly emptySpec: string[];
  readonly total: number;
  /** Empty harness files above the sources; while one exists, every spec under it is inert. */
  readonly brokenHarness: string[];
  /** Files that will be rewritten with nothing verifying them. */
  readonly unprotected: number;
  /**
   * Spec files that themselves use Reactive Forms, and how many constructs each has. Excluded
   * from the counts, but still need rewriting under the different testing rules.
   */
  readonly specsUsingForms: { readonly spec: string; readonly findings: number }[];
}

// Both separators: toAbsolute is path.resolve, which emits backslashes on win32.
function parentOf(path: string): string | undefined {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
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
  const specsUsingForms: { spec: string; findings: number }[] = [];
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

    // A zero-byte or whitespace-only spec reads as coverage until the suite fails to parse.
    const specFindings = detectInSource(spec, contents).length;
    if (specFindings > 0) specsUsingForms.push({ spec, findings: specFindings });

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
    specsUsingForms: specsUsingForms.sort(
      (a, b) => b.findings - a.findings || a.spec.localeCompare(b.spec),
    ),
  };
}
