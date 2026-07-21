/**
 * Workspace migration report — pure.
 *
 * Composes detection + complexity + recipe references into one markdown document. It
 * RETURNS a string; nothing here writes to disk. Whether the report becomes a file is the
 * calling agent's decision, which keeps the detect-and-advise rule intact.
 */
import { analyzeMigrationComplexity } from './complexity.js';
import { getSignalFormsRecipe } from './recipes.js';
import { VERIFIED_ANGULAR_VERSION } from './version.js';
import type { FileFindings, Finding } from './types.js';

/** How many judgment findings to spell out per file before summarising the rest. */
const MAX_LISTED_JUDGMENTS = 10;

function shortPath(file: string, root: string): string {
  return file.startsWith(root) ? file.slice(root.length).replace(/^\//, '') : file;
}

/** Distinct constructs present, in descending frequency then alphabetical. */
function constructRows(byConstruct: Readonly<Record<string, number>>): [string, number][] {
  return Object.entries(byConstruct).sort(
    ([aName, aCount], [bName, bCount]) => bCount - aCount || aName.localeCompare(bName),
  );
}

/**
 * Version-sensitive recipes among the constructs actually found.
 *
 * Only warns about what is present — a blanket warning on every report trains people to
 * ignore it.
 */
function versionSensitiveConstructs(byConstruct: Readonly<Record<string, number>>): string[] {
  const flagged = new Set<string>();
  for (const construct of Object.keys(byConstruct)) {
    const lookup = getSignalFormsRecipe(construct);
    if (lookup.found && lookup.provenance.versionSensitive) flagged.add(lookup.construct);
  }
  return [...flagged].sort((a, b) => a.localeCompare(b));
}

function judgmentLines(findings: readonly Finding[], root: string, file: string): string[] {
  const judgments = findings.filter((finding) => finding.classification === 'judgment');
  if (judgments.length === 0) return [];

  const lines: string[] = [];
  for (const finding of judgments.slice(0, MAX_LISTED_JUDGMENTS)) {
    lines.push(`- \`${shortPath(file, root)}:${String(finding.line)}\` — **${finding.construct}**`);
    lines.push(`  - ${finding.reason}`);
  }
  const hidden = judgments.length - MAX_LISTED_JUDGMENTS;
  if (hidden > 0) {
    lines.push(`- …and ${String(hidden)} more judgment findings in this file.`);
  }
  return lines;
}

export function buildMigrationReport(root: string, files: readonly FileFindings[]): string {
  const complexity = analyzeMigrationComplexity(files);
  const withFindings = files.filter((entry) => entry.findings.length > 0);
  const lines: string[] = [];

  lines.push('# Signal Forms migration report');
  lines.push('');
  lines.push(`Scanned: \`${root}\``);
  lines.push('');

  if (complexity.totalFindings === 0) {
    lines.push('No Reactive Forms constructs were found under this path.');
    lines.push('');
    lines.push(
      'Note that files importing only `FormsModule` (template-driven `ngModel`) are outside ' +
        "this tool's remit and produce no findings, so this is not proof the path is free of " +
        'forms.',
    );
    return lines.join('\n');
  }

  /* ---- Summary ---------------------------------------------------------- */

  lines.push('## Summary');
  lines.push('');
  lines.push('| | Count |');
  lines.push('| --- | --- |');
  lines.push(`| Files with findings | ${String(withFindings.length)} |`);
  lines.push(`| Total findings | ${String(complexity.totalFindings)} |`);
  lines.push(`| Mechanical | ${String(complexity.mechanicalCount)} |`);
  lines.push(`| Judgment | ${String(complexity.judgmentCount)} |`);
  lines.push('');
  lines.push(
    '**Mechanical** findings are a direct transliteration an agent can apply confidently. ' +
      '**Judgment** findings change shape enough that a human should decide the target design.',
  );
  lines.push('');

  /* ---- Suggested order -------------------------------------------------- */

  lines.push('## Suggested order');
  lines.push('');
  lines.push(
    'Simplest first: files with no judgment calls come before those that have them, then ' +
      'fewest judgment calls, then smallest. Migrating in this order settles the model shape ' +
      'on easy files before the hard ones depend on it.',
  );
  lines.push('');
  lines.push('| # | File | Findings | Mechanical | Judgment |');
  lines.push('| --- | --- | --- | --- | --- |');

  const byPath = new Map(withFindings.map((entry) => [entry.file, entry] as const));
  complexity.suggestedOrder.forEach((file, index) => {
    const entry = byPath.get(file);
    if (entry === undefined) return;
    const judgment = entry.findings.filter((f) => f.classification === 'judgment').length;
    const mechanical = entry.findings.length - judgment;
    lines.push(
      `| ${String(index + 1)} | \`${shortPath(file, root)}\` | ${String(entry.findings.length)} ` +
        `| ${String(mechanical)} | ${String(judgment)} |`,
    );
  });
  lines.push('');

  /* ---- Constructs ------------------------------------------------------- */

  lines.push('## Constructs found');
  lines.push('');
  lines.push('| Count | Construct | Recipe |');
  lines.push('| --- | --- | --- |');
  for (const [construct, count] of constructRows(complexity.byConstruct)) {
    const lookup = getSignalFormsRecipe(construct);
    const recipe = lookup.found ? `\`${lookup.construct}\`` : '_(no recipe yet)_';
    lines.push(`| ${String(count)} | \`${construct}\` | ${recipe} |`);
  }
  lines.push('');
  lines.push(
    'Look any of these up with `get_signalforms_recipe { "construct": "…" }` for a verified ' +
      'before/after pair and its caveats.',
  );
  lines.push('');

  /* ---- Version sensitivity ---------------------------------------------- */

  const flagged = versionSensitiveConstructs(complexity.byConstruct);
  if (flagged.length > 0) {
    lines.push('## Read the caveats');
    lines.push('');
    lines.push(
      `Recipes are verified against **Angular v${String(VERIFIED_ANGULAR_VERSION)}**. These ` +
        'constructs in this codebase behave DIFFERENTLY across Angular versions, so the recipe ' +
        'that is correct for one release is wrong for another:',
    );
    lines.push('');
    for (const construct of flagged) lines.push(`- \`${construct}\` — VERSION-SENSITIVE`);
    lines.push('');
    lines.push(
      'Check the project’s installed Angular version before applying these. Each affected ' +
        'recipe carries a version-independent fallback in its caveats.',
    );
    lines.push('');
  }

  /* ---- Judgment detail --------------------------------------------------- */

  if (complexity.judgmentCount > 0) {
    lines.push('## Judgment calls');
    lines.push('');
    lines.push('These need a decision before any code is written.');
    lines.push('');
    for (const file of complexity.suggestedOrder) {
      const entry = byPath.get(file);
      if (entry === undefined) continue;
      const detail = judgmentLines(entry.findings, root, file);
      if (detail.length > 0) lines.push(...detail);
    }
    lines.push('');
  }

  /* ---- Scope ------------------------------------------------------------- */

  lines.push('## Scope of this report');
  lines.push('');
  lines.push('- Only `.ts` files are parsed. Template bindings in `.html` are **not** covered —');
  lines.push('  `[formGroup]`, `formControlName` and friends must be migrated alongside.');
  lines.push('- Template-driven forms (`FormsModule` / `ngModel`) are out of scope and produce');
  lines.push('  no findings, so the totals above are the Reactive Forms slice only.');
  lines.push('- This server never edits code. Every change above is for you or your agent to');
  lines.push('  make and review.');

  return lines.join('\n');
}
