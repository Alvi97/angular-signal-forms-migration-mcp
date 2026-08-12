/**
 * Windowing and filtering for finding lists (pure).
 *
 * Measured before this existed: `find_form_candidates` over a 60-component workspace returned
 * a 1,474,818-byte JSON-RPC frame. A single call that cannot fit in the caller's context is
 * not a usable tool, however correct its contents.
 *
 * The window is over FINDINGS, not files. Paginating by file bounds nothing — one component
 * with 400 findings blows any file-based page — so a file may come back partial and says so.
 *
 * The design rule everything here serves: **silence must mean complete.** `incomplete` is
 * non-null whenever the response is not the whole picture, whether that is because of the
 * window or because of a filter. An agent that reads a narrowed list as the full job will
 * under-migrate and never know.
 */
import type { Classification, FileFindings, Finding } from './types.js';

export interface PageOptions {
  readonly offset: number;
  readonly limit: number;
  /** Keep only these construct names. Omitted means every construct. */
  readonly constructs?: readonly string[];
  /** Keep only this classification. Omitted means both. */
  readonly classification?: Classification;
}

export interface PagedFileFindings {
  readonly file: string;
  readonly findings: readonly Finding[];
  /** Findings in this file matching the filters, BEFORE the page window. */
  readonly matchedInFile: number;
  /** True when `findings` is a slice of this file rather than all of its matches. */
  readonly partial: boolean;
}

export interface PageInfo {
  readonly offset: number;
  readonly limit: number;
  readonly returned: number;
  /** Matching the filters across the whole scan, ignoring the window. */
  readonly totalMatched: number;
  /** Before ANY filter, so a narrow filter cannot read as the whole picture. */
  readonly totalUnfiltered: number;
  readonly truncated: boolean;
  readonly nextOffset: number | null;
}

export interface PagedFindings {
  /**
   * Non-null means the list is NOT the whole picture, with the call that returns the rest.
   * Null means it is. Nothing else in the response carries that guarantee.
   */
  readonly incomplete: string | null;
  readonly files: readonly PagedFileFindings[];
  readonly page: PageInfo;
}

function matches(finding: Finding, options: PageOptions): boolean {
  if (options.classification !== undefined && finding.classification !== options.classification) {
    return false;
  }
  if (options.constructs !== undefined && !options.constructs.includes(finding.construct)) {
    return false;
  }
  return true;
}

function notice(page: PageInfo, options: PageOptions): string | null {
  const filtered = page.totalMatched < page.totalUnfiltered;
  if (!page.truncated && !filtered) return null;

  const parts: string[] = [];
  if (page.truncated) {
    const next =
      page.nextOffset === null
        ? `This offset (${String(page.offset)}) is at or past the end; earlier findings are ` +
          'at lower offsets.'
        : `Get the next page with offset ${String(page.nextOffset)}.`;
    parts.push(
      `Showing ${String(page.returned)} of ${String(page.totalMatched)} matching findings. ` + next,
    );
  }
  if (filtered) {
    const how: string[] = [];
    if (options.constructs !== undefined) how.push(`constructs=[${options.constructs.join(', ')}]`);
    if (options.classification !== undefined) how.push(`classification=${options.classification}`);
    parts.push(
      `A filter is active (${how.join(', ')}): ${String(page.totalMatched)} of ` +
        `${String(page.totalUnfiltered)} findings in this scan match it. The rest are real ` +
        'migration work too — re-run without the filter for the full picture.',
    );
  }
  return parts.join(' ');
}

/** Applies the filters, then the window, preserving file and finding order. */
export function pageFindings(files: readonly FileFindings[], options: PageOptions): PagedFindings {
  const limit = Math.max(1, Math.trunc(options.limit));
  const offset = Math.max(0, Math.trunc(options.offset));

  let totalUnfiltered = 0;
  let totalMatched = 0;
  let cursor = 0;
  let returned = 0;
  const out: PagedFileFindings[] = [];

  for (const entry of files) {
    totalUnfiltered += entry.findings.length;
    const matching = entry.findings.filter((finding) => matches(finding, options));
    totalMatched += matching.length;
    if (matching.length === 0) continue;

    // Where this file's matches sit in the flat sequence, so the window can straddle files.
    const start = cursor;
    cursor += matching.length;

    const from = Math.max(0, offset - start);
    const to = Math.min(matching.length, offset + limit - start);
    if (from >= to) continue;

    const slice = matching.slice(from, to);
    returned += slice.length;
    out.push({
      file: entry.file,
      findings: slice,
      matchedInFile: matching.length,
      partial: slice.length < matching.length,
    });
  }

  // `truncated` asks "is this page the whole matched set?", not "is there a next page?".
  // An offset past the end returns nothing and has no next page, yet is emphatically not
  // the whole picture — conflating the two is how a cut list starts reading as complete.
  const truncated = returned < totalMatched;
  const hasMore = offset + returned < totalMatched;
  const page: PageInfo = {
    offset,
    limit,
    returned,
    totalMatched,
    totalUnfiltered,
    truncated,
    nextOffset: hasMore ? offset + returned : null,
  };

  return { incomplete: notice(page, options), files: out, page };
}
