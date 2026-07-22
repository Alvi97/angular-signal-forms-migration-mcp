/**
 * Provenance audit (pure). Turns "is this advice still current?" into a checklist; rendered
 * by `npm run docs:audit`, with tests asserting the invariants.
 */
import { allRecipes } from './recipes.js';
import { VERIFIED_ANGULAR_VERSION } from './version.js';
import type { Recipe } from './types.js';

export interface AuditEntry {
  readonly construct: string;
  readonly verifiedAgainstVersion: number;
  readonly retrievedISO: string;
  readonly sources: readonly string[];
  readonly versionSensitive: boolean;
  /** True when this recipe was verified against an older Angular than we now target. */
  readonly stale: boolean;
}

export interface AuditReport {
  readonly targetVersion: number;
  readonly entries: readonly AuditEntry[];
  readonly stale: readonly AuditEntry[];
  readonly versionSensitive: readonly AuditEntry[];
  /** Every distinct URL across stale recipes; the re-verification worklist. */
  readonly staleSources: readonly string[];
}

function toEntry(recipe: Recipe): AuditEntry {
  const { provenance } = recipe;
  return {
    construct: recipe.construct,
    verifiedAgainstVersion: provenance.verifiedAgainstVersion,
    retrievedISO: provenance.retrievedISO,
    sources: provenance.sources,
    versionSensitive: provenance.versionSensitive,
    stale: provenance.verifiedAgainstVersion < VERIFIED_ANGULAR_VERSION,
  };
}

export function auditRecipes(): AuditReport {
  const entries = allRecipes()
    .map(toEntry)
    .sort((a, b) => a.construct.localeCompare(b.construct));
  const stale = entries.filter((entry) => entry.stale);

  return {
    targetVersion: VERIFIED_ANGULAR_VERSION,
    entries,
    stale,
    versionSensitive: entries.filter((entry) => entry.versionSensitive),
    staleSources: [...new Set(stale.flatMap((entry) => entry.sources))].sort(),
  };
}

/** Renders the report for a terminal. Returned as a string so the core stays pure. */
export function formatAuditReport(report: AuditReport): string {
  const lines: string[] = [];
  const rule = '-'.repeat(78);

  lines.push(`Recipe provenance audit — target Angular v${String(report.targetVersion)}`);
  lines.push(rule);
  lines.push('  ver  retrieved   src  construct');
  for (const entry of report.entries) {
    const flag = entry.stale ? '!' : entry.versionSensitive ? '~' : ' ';
    lines.push(
      `${flag} ${String(entry.verifiedAgainstVersion).padStart(3)}  ${entry.retrievedISO}` +
        `  ${String(entry.sources.length).padStart(3)}  ${entry.construct}`,
    );
  }
  lines.push(rule);
  lines.push(
    `${String(report.entries.length)} recipes · ${String(report.stale.length)} stale · ` +
      `${String(report.versionSensitive.length)} version-sensitive`,
  );

  if (report.versionSensitive.length > 0) {
    lines.push('');
    lines.push('VERSION-SENSITIVE (~) — behaviour differs across Angular releases.');
    lines.push('Re-read these first on any upgrade; their caveats carry the fallback.');
    for (const entry of report.versionSensitive) lines.push(`  ~ ${entry.construct}`);
  }

  if (report.stale.length === 0) {
    lines.push('');
    lines.push(`No stale recipes: all verified against v${String(report.targetVersion)}.`);
    return lines.join('\n');
  }

  lines.push('');
  lines.push(
    `STALE (!) — verified against an Angular older than v${String(report.targetVersion)}.`,
  );
  for (const entry of report.stale) {
    lines.push(
      `  ! ${entry.construct} (v${String(entry.verifiedAgainstVersion)}, ${entry.retrievedISO})`,
    );
  }
  lines.push('');
  lines.push('Re-verify these URLs against the new version, then update provenance:');
  for (const source of report.staleSources) lines.push(`  ${source}`);

  return lines.join('\n');
}
