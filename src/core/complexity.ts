/**
 * Migration complexity summary — pure.
 *
 * Takes the output of detection and answers the question a team actually asks first:
 * how big is this, and where should we start? The ordering is deliberately
 * simplest-first — early all-mechanical files build confidence and establish the model
 * shape that the judgment-heavy files will need.
 */
import type { Classification, FileFindings, MigrationComplexity } from './types.js';

/** Constructs that mean "this file DEFINES reusable validators". */
const VALIDATOR_CONSTRUCTS: ReadonlySet<string> = new Set(['customValidator', 'asyncValidator']);

/**
 * What a file is, for ordering purposes.
 *
 * `owner`     — constructs a form; the normal case.
 * `validators`— owns no form but defines reusable validators. Migrates fine on its own, and
 *               its new error shape gates every consumer, so it must NOT be buried.
 * `reference` — neither. Only annotations, casts or state reads on someone else's form,
 *               so it cannot be migrated in isolation at all.
 */
type FileRole = 'owner' | 'validators' | 'reference';

interface FileWeight {
  readonly file: string;
  readonly total: number;
  readonly judgment: number;
  readonly role: FileRole;
}

/**
 * Sort key: files with no judgment calls first, then fewest judgment calls, then
 * smallest, then by path so the output is deterministic.
 */
function compareWeights(a: FileWeight, b: FileWeight): number {
  // Reference-only files sort last regardless of size. A wrapper holding a single cast on
  // a sibling's form looks like the easiest file in the repo and is in fact un-migratable
  // on its own, so it must never be offered as the pilot.
  const aReference = a.role === 'reference';
  const bReference = b.role === 'reference';
  if (aReference !== bReference) return aReference ? 1 : -1;
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
