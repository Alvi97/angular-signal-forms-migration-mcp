/**
 * Migration complexity summary — pure.
 *
 * Takes the output of detection and answers the question a team actually asks first:
 * how big is this, and where should we start? The ordering is deliberately
 * simplest-first — early all-mechanical files build confidence and establish the model
 * shape that the judgment-heavy files will need.
 */
import type { Classification, FileFindings, MigrationComplexity } from './types.js';

interface FileWeight {
  readonly file: string;
  readonly total: number;
  readonly judgment: number;
}

/**
 * Sort key: files with no judgment calls first, then fewest judgment calls, then
 * smallest, then by path so the output is deterministic.
 */
function compareWeights(a: FileWeight, b: FileWeight): number {
  if (a.judgment !== b.judgment) return a.judgment - b.judgment;
  if (a.total !== b.total) return a.total - b.total;
  return a.file.localeCompare(b.file);
}

export function analyzeMigrationComplexity(files: readonly FileFindings[]): MigrationComplexity {
  const byConstruct: Record<string, number> = {};
  const counts: Record<Classification, number> = { mechanical: 0, judgment: 0 };
  const weights: FileWeight[] = [];
  let totalFindings = 0;

  for (const entry of files) {
    // A file with no findings is not part of the migration; leaving it in the
    // suggested order would pad the plan with no-ops.
    if (entry.findings.length === 0) continue;

    let judgment = 0;
    for (const finding of entry.findings) {
      totalFindings += 1;
      byConstruct[finding.construct] = (byConstruct[finding.construct] ?? 0) + 1;
      counts[finding.classification] += 1;
      if (finding.classification === 'judgment') judgment += 1;
    }
    weights.push({ file: entry.file, total: entry.findings.length, judgment });
  }

  return {
    totalFindings,
    byConstruct,
    mechanicalCount: counts.mechanical,
    judgmentCount: counts.judgment,
    suggestedOrder: weights.sort(compareWeights).map((weight) => weight.file),
  };
}
