/**
 * Migration complexity summary (pure). Answers "how big is this, and where do we start?"
 * Ordering is simplest-first, so early all-mechanical files settle the model shape that the
 * judgment-heavy files need.
 */
import type { Classification, FileFindings, MigrationComplexity } from './types.js';

/** Constructs meaning "this file defines reusable validators". */
const VALIDATOR_CONSTRUCTS: ReadonlySet<string> = new Set(['customValidator', 'asyncValidator']);

/**
 * A file's role for ordering. `owner` constructs a form; `validators` owns none but defines
 * reusable validators whose error shape gates consumers; `reference` only touches someone
 * else's form, so it can't migrate alone.
 */
type FileRole = 'owner' | 'validators' | 'reference';

interface FileWeight {
  readonly file: string;
  readonly total: number;
  readonly judgment: number;
  readonly role: FileRole;
}

/** Sort bucket: validators decide first, references can't go alone, owners in between. */
function bucket(role: FileRole): number {
  if (role === 'validators') return 0;
  if (role === 'owner') return 1;
  return 2;
}

function compareWeights(a: FileWeight, b: FileWeight): number {
  // Bucket before size: shared validators sort first (they gate consumers), reference-only
  // files last (they can't migrate alone), then by judgment count, size, and path.
  if (a.role !== b.role) return bucket(a.role) - bucket(b.role);
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
    // A file with no findings isn't part of the migration.
    if (entry.findings.length === 0) continue;

    let judgment = 0;
    let defines = false;
    let definesValidators = false;
    for (const finding of entry.findings) {
      if (finding.definesForm) defines = true;
      if (VALIDATOR_CONSTRUCTS.has(finding.construct)) definesValidators = true;
      totalFindings += 1;
      byConstruct[finding.construct] = (byConstruct[finding.construct] ?? 0) + 1;
      counts[finding.classification] += 1;
      if (finding.classification === 'judgment') judgment += 1;
    }
    const role: FileRole = defines ? 'owner' : definesValidators ? 'validators' : 'reference';
    weights.push({ file: entry.file, total: entry.findings.length, judgment, role });
  }

  const sorted = [...weights].sort(compareWeights);

  return {
    totalFindings,
    byConstruct,
    mechanicalCount: counts.mechanical,
    judgmentCount: counts.judgment,
    suggestedOrder: sorted.map((weight) => weight.file),
    referenceOnlyFiles: sorted.filter((w) => w.role === 'reference').map((w) => w.file),
    sharedValidatorFiles: sorted.filter((w) => w.role === 'validators').map((w) => w.file),
  };
}
