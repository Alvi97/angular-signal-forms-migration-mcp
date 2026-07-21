/**
 * Workspace migration report — pure.
 *
 * Composes detection + complexity + recipe references into one markdown document. It
 * RETURNS a string; nothing here writes to disk. Whether the report becomes a file is the
 * calling agent's decision, which keeps the detect-and-advise rule intact.
 */
import { MIN_SIGNAL_FORMS_VERSION, signalFormsAvailable } from './angular-version.js';
import { analyzeMigrationComplexity } from './complexity.js';
import { getSignalFormsRecipe } from './recipes.js';
import { VERIFIED_ANGULAR_VERSION } from './version.js';
import type { AngularVersion } from './angular-version.js';
import type { CoverageReport } from './coverage.js';
import type { FileFindings, Finding } from './types.js';

/** How many judgment findings to spell out per file before summarising the rest. */
const MAX_LISTED_JUDGMENTS = 10;

/**
 * Constructs that are LIVE BUGS rather than migration work.
 *
 * These get their own section above the plan because they are actionable today, on the
 * current Angular, whether or not the migration ever happens — and because a faithful
 * migration would carry them across into new code where they are harder to spot.
 */
const BUG_CONSTRUCTS: ReadonlySet<string> = new Set(['deadValidatorOption']);

interface BugSite {
  readonly file: string;
  readonly line: number;
  readonly construct: string;
  readonly snippet: string;
  readonly reason: string;
}

function collectBugs(files: readonly FileFindings[]): BugSite[] {
  const bugs: BugSite[] = [];
  for (const entry of files) {
    for (const finding of entry.findings) {
      if (!BUG_CONSTRUCTS.has(finding.construct)) continue;
      bugs.push({
        file: entry.file,
        line: finding.line,
        construct: finding.construct,
        snippet: finding.snippet,
        reason: finding.reason,
      });
    }
  }
  return bugs;
}

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

/**
 * The prerequisite block.
 *
 * This exists because the server once produced a complete 653-finding plan for a project
 * on Angular 20, where none of the target API exists. The plan still renders below — it is
 * a valid post-upgrade blueprint — but it must not be the first thing read.
 */
function prerequisiteLines(version: AngularVersion): string[] {
  const lines: string[] = [];

  if (!version.known) {
    lines.push('> **Angular version unknown.** ' + version.reason);
    lines.push('>');
    lines.push(
      `> Signal Forms requires **v${String(MIN_SIGNAL_FORMS_VERSION)}+**. This report ` +
        'could not determine the installed version, so confirm it before starting.',
    );
    lines.push('');
    return lines;
  }

  if (signalFormsAvailable(version.major)) {
    lines.push(
      `Target Angular version: **${version.raw}** (from \`${version.from}\`). ` +
        'Signal Forms is available.',
    );
    lines.push('');
    return lines;
  }

  lines.push('## ⚠️ BLOCKING PREREQUISITE — do not begin migration');
  lines.push('');
  lines.push(
    `The target API \`@angular/forms/signals\` does not exist below Angular ` +
      `v${String(MIN_SIGNAL_FORMS_VERSION)}. This project is on **${version.raw}** ` +
      `(from \`${version.from}\`), so **every recipe below is currently unusable** — the ` +
      'imports will not resolve.',
  );
  lines.push('');
  lines.push(
    `Upgrade to Angular v${String(MIN_SIGNAL_FORMS_VERSION)}+ (ideally v22) first, then ` +
      're-run this scan to confirm the counts and re-resolve the version-sensitive recipes.',
  );
  lines.push('');
  lines.push(
    'Everything below remains valid as the **post-upgrade blueprint**: the findings, the ' +
      'ordering and the judgment calls do not change with the upgrade.',
  );
  lines.push('');
  lines.push(
    'For the upgrade itself, call `get_angular_upgrade_plan { "path": "<this path>", ' +
      '"level": 3 }` — it reproduces angular.dev/update-guide from Angular’s own published ' +
      'step data, and asks the same questions (application complexity; ngUpgrade, Angular ' +
      'Material, Windows).',
  );
  lines.push('');
  return lines;
}

/**
 * Resolves a version-sensitive recipe against the project's ACTUAL version.
 *
 * Handing the agent both variants and hoping is what this replaces. The awkward case is a
 * project on neither diverging version — say Angular 20 — where the honest answer is that
 * the divergence does not describe this project at all.
 */
function versionResolutionLines(version: AngularVersion): string[] {
  const target = String(VERIFIED_ANGULAR_VERSION);

  if (!version.known) {
    return [
      `Recipes are written for Angular v${target}. This report could not determine the ` +
        "project's version, so each affected recipe hands you both variants — read its " +
        'caveats and pick the one matching your Angular.',
    ];
  }

  if (version.major === VERIFIED_ANGULAR_VERSION) {
    return [
      `Your project is on **${version.raw}**, which matches your Angular to the version ` +
        `these recipes were verified against (v${target}). Apply them as written.`,
    ];
  }

  if (version.major === VERIFIED_ANGULAR_VERSION - 1) {
    return [
      `Your project is on **${version.raw}**, one release BEHIND the v${target} the recipes ` +
        'were verified against. For each construct above, use the version-independent ' +
        'fallback given in its caveats, not the primary snippet.',
    ];
  }

  return [
    `Your project is on **${version.raw}**, which is **neither** of the versions these ` +
      `recipes diverge between (v${String(VERIFIED_ANGULAR_VERSION - 1)} and v${target}). ` +
      'The documented divergence does not describe your project, so neither variant can be ' +
      'assumed correct — verify the behaviour on your own version before applying these, or ' +
      'upgrade first.',
  ];
}

/**
 * What is verifying the rewrite.
 *
 * Not a blocker, but it changes the sequencing: an all-mechanical file with no test is a
 * different risk from an all-mechanical file with one, and only the operator can decide
 * whether to write tests first.
 */
function coverageLines(
  coverage: CoverageReport | undefined,
  root: string,
  byPath: ReadonlyMap<string, FileFindings>,
): string[] {
  if (coverage === undefined) return [];
  if (coverage.unprotected === 0 && coverage.specsUsingForms.length === 0) return [];

  const lines = ['## What is verifying this migration', ''];

  // A broken harness invalidates every coverage claim beneath it, so it goes first.
  if (coverage.brokenHarness.length > 0) {
    lines.push(
      '**Some test infrastructure is empty, so specs beneath it do not run at all** — ' +
        'regardless of what those specs contain. Fix this before judging coverage:',
    );
    lines.push('');
    for (const file of coverage.brokenHarness)
      lines.push(`- \`${shortPath(file, root)}\` — 0 bytes`);
    lines.push('');
  }

  const percent = Math.round((coverage.unprotected / Math.max(coverage.total, 1)) * 100);
  lines.push(
    `**${String(coverage.unprotected)} of ${String(coverage.total)} files (${String(percent)}%) ` +
      'to be rewritten have no test that runs.** The compiler will catch shape errors; it ' +
      'will not catch a validator that stopped firing or a field that stopped binding. ' +
      'Consider characterisation tests for the highest-finding files before changing them.',
  );
  lines.push('');
  lines.push(
    'Note this only checks that a sibling `.spec.ts` exists and is non-empty — it does not ' +
      'run anything, so a present spec may still assert nothing useful.',
  );
  lines.push('');

  const withCounts = (file: string): string => {
    const entry = byPath.get(file);
    const count = entry === undefined ? '' : ` — ${String(entry.findings.length)} findings`;
    return `- \`${shortPath(file, root)}\`${count}`;
  };

  if (coverage.emptySpec.length > 0) {
    lines.push('**Spec exists but cannot verify anything** (empty, or under a broken harness):');
    lines.push('');
    for (const file of coverage.emptySpec) lines.push(withCounts(file));
    lines.push('');
  }
  if (coverage.uncovered.length > 0) {
    lines.push('**No spec file:**');
    lines.push('');
    for (const file of coverage.uncovered) lines.push(withCounts(file));
    lines.push('');
  }

  // Specs are excluded from the migration counts deliberately — a spec cannot be migrated
  // "first", so counting them would distort both the totals and the ordering. Saying nothing
  // about them was the wrong fix: they use the same APIs and have to be rewritten too, under
  // rules that differ from production code.
  if (coverage.specsUsingForms.length > 0) {
    const total = coverage.specsUsingForms.reduce((sum, entry) => sum + entry.findings, 0);
    lines.push('');
    lines.push(
      `**${String(coverage.specsUsingForms.length)} spec file(s) use Reactive Forms directly ` +
        `(${String(total)} construct(s)), and are NOT counted above.** They need rewriting ` +
        'too, and the rules differ from production code: a form needs an injection context ' +
        'in a test, `setValue()` becomes `value.set()`, and `detectChanges()`/`tick()` ' +
        'become `await fixture.whenStable()`. Ask for the `testing` recipe.',
    );
    lines.push('');
    for (const entry of coverage.specsUsingForms) {
      lines.push(`- \`${shortPath(entry.spec, root)}\` — ${String(entry.findings)} construct(s)`);
    }
  }

  return lines;
}

export function buildMigrationReport(
  root: string,
  files: readonly FileFindings[],
  version: AngularVersion = { known: false, reason: 'No version was supplied to the report.' },
  coverage?: CoverageReport,
): string {
  const complexity = analyzeMigrationComplexity(files);
  const withFindings = files.filter((entry) => entry.findings.length > 0);
  const lines: string[] = [];

  lines.push('# Signal Forms migration report');
  lines.push('');
  lines.push(`Scanned: \`${root}\``);
  lines.push('');
  lines.push(...prerequisiteLines(version));

  /* ---- Live bugs --------------------------------------------------------- */

  // Deliberately above the plan, and rendered even when the version gate blocks the
  // migration: a gate stops a migration, not a one-word bug fix.
  const bugs = collectBugs(files);
  if (bugs.length > 0) {
    lines.push('## Bugs found — fix these before migrating');
    lines.push('');
    lines.push(
      'These are not migration steps. They are defects in the code as it stands today, ' +
        'fixable independently of any Angular upgrade. They are listed first because a ' +
        'faithful migration would carry them into the new code, where a rewrite makes them ' +
        'much harder to notice.',
    );
    lines.push('');
    for (const bug of bugs) {
      lines.push(`- \`${shortPath(bug.file, root)}:${String(bug.line)}\` — **${bug.construct}**`);
      lines.push(`  - \`${bug.snippet}\``);
      lines.push(`  - ${bug.reason}`);
    }
    lines.push('');
    lines.push(
      `Look up the fix with \`get_signalforms_recipe { "construct": "${bugs[0]?.construct ?? ''}" }\`.`,
    );
    lines.push('');
  }

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
    'Shared validators come first — not because they are easy, but because their error ' +
      'shape gates every consumer, so nothing downstream can be finalised until it is ' +
      'settled. **Decide their design first; convert them whenever.** After that, form ' +
      'owners simplest-first (no judgment calls before any, then fewest, then smallest), ' +
      'which settles the model shape on easy files before hard ones depend on it. Files ' +
      'that only reference a form defined elsewhere come last — they cannot be migrated ' +
      'alone at all.',
  );
  lines.push('');
  lines.push('| # | File | Role | Findings | Mechanical | Judgment |');
  lines.push('| --- | --- | --- | --- | --- | --- |');

  const byPath = new Map(withFindings.map((entry) => [entry.file, entry] as const));
  complexity.suggestedOrder.forEach((file, index) => {
    const entry = byPath.get(file);
    if (entry === undefined) return;
    const judgment = entry.findings.filter((f) => f.classification === 'judgment').length;
    const mechanical = entry.findings.length - judgment;
    const role = complexity.sharedValidatorFiles.includes(file)
      ? 'decide first'
      : complexity.referenceOnlyFiles.includes(file)
        ? 'reference only'
        : 'form owner';
    lines.push(
      `| ${String(index + 1)} | \`${shortPath(file, root)}\` | ${role} ` +
        `| ${String(entry.findings.length)} | ${String(mechanical)} | ${String(judgment)} |`,
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
      'These constructs behave DIFFERENTLY across Angular versions, so the recipe that is ' +
        'correct for one release is wrong for another:',
    );
    lines.push('');
    for (const construct of flagged) lines.push(`- \`${construct}\` — VERSION-SENSITIVE`);
    lines.push('');
    lines.push(...versionResolutionLines(version));
    lines.push('');
  }

  /* ---- Shared primitives ------------------------------------------------- */

  if (complexity.sharedValidatorFiles.length > 0) {
    lines.push('## Shared validators — decide these early');
    lines.push('');
    lines.push(
      'These files own no form but DEFINE reusable validators. They migrate perfectly well ' +
        'on their own, and their new error shape (`{ kind, message? }` instead of ' +
        '`{ [key]: unknown }`) changes every consumer — so settle their design before ' +
        'migrating the forms that use them, even if you convert them later.',
    );
    lines.push('');
    for (const file of complexity.sharedValidatorFiles) {
      lines.push(`- \`${shortPath(file, root)}\``);
    }
    lines.push('');
  }

  /* ---- Reference-only files --------------------------------------------- */

  if (complexity.referenceOnlyFiles.length > 0) {
    lines.push('## Files that do not own a form');
    lines.push('');
    lines.push(
      'Every finding in these files REFERENCES a form defined elsewhere — a type annotation, ' +
        'a cast, a state read — rather than constructing one. They cannot be migrated on ' +
        'their own and are sorted last: migrate them with whichever file owns the form.',
    );
    lines.push('');
    for (const file of complexity.referenceOnlyFiles) {
      lines.push(`- \`${shortPath(file, root)}\``);
    }
    lines.push('');
  }

  lines.push(...coverageLines(coverage, root, byPath));

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
