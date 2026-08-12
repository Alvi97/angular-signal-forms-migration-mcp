#!/usr/bin/env node
/**
 * MCP wiring only. Each handler parses input with zod, calls a pure core function, and shapes
 * the Result into a CallToolResult ({ ok: false } becomes isError: true). All tools are
 * readOnlyHint: true; the server never writes to source files.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  detectAngularVersion,
  findAngularManifest,
  MIN_SIGNAL_FORMS_VERSION,
  signalFormsAvailable,
} from './core/angular-version.js';
import { analyzeMigrationComplexity } from './core/complexity.js';
import { pageFindings } from './core/paginate.js';
import { detectModuleResolution } from './core/module-resolution.js';
import { ALWAYS_SKIPPED, VERIFY_DISCLAIMER, verifyMigration } from './core/verify.js';
import { findFormCandidates } from './core/detect.js';
import { getSignalFormsRecipe } from './core/recipes.js';
import { assessCoverage } from './core/coverage.js';
import { buildMigrationReport } from './core/report.js';
import {
  declaredDependencyNames,
  detectCompanions,
  inferUpgradeOptions,
} from './core/companions.js';
import { buildUpgradePlan, validateUpgradeRange } from './core/upgrade.js';
import { buildUpgradeReport } from './core/upgrade-report.js';
import {
  analyzeMigrationComplexityInputSchema,
  findFormCandidatesInputSchema,
  findFormCandidatesOutputSchema,
  getSignalFormsRecipeInputSchema,
  getSignalFormsRecipeOutputSchema,
  getAngularUpgradePlanInputSchema,
  getAngularUpgradePlanOutputSchema,
  getMigrationReportInputSchema,
  getMigrationReportOutputSchema,
  analyzeMigrationComplexityOutputSchema,
  verifyMigrationInputSchema,
  verifyMigrationOutputSchema,
  VERIFY_CHECKS,
  type VerifyMigrationOutput,
  type FindFormCandidatesOutput,
  type GetSignalFormsRecipeOutput,
} from './core/types.js';
import { VERIFIED_ANGULAR_VERSION } from './core/version.js';
import { findPeerBlockers } from './core/peer-blockers.js';
import {
  nodeFileSystem,
  readBuildConfigs,
  readInstalledPeer,
  toAbsolute,
} from './infra/node-fs.js';
import { checkForUpdate } from './infra/update-notifier.js';

/** Identity announced in the handshake, read from package.json so it can't misreport itself. */
const packageJson: unknown = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
);

function packageField(name: string, fallback: string): string {
  if (typeof packageJson !== 'object' || packageJson === null) return fallback;
  const value = (packageJson as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : fallback;
}

export const SERVER_NAME = packageField('name', 'angular-signal-forms-migration-mcp');
export const SERVER_VERSION = packageField('version', '0.0.0');

/** Default page size for finding lists. A whole workspace does not fit in one context. */
const DEFAULT_FINDING_LIMIT = 200;

/** stdout is the MCP stdio channel; diagnostics go to stderr. */
function logToStderr(message: string): void {
  process.stderr.write(`[${SERVER_NAME}] ${message}\n`);
}

/**
 * Every payload ships twice: `structuredContent` because the SDK REQUIRES it when a tool
 * declares an outputSchema (it throws otherwise — mcp.js validateToolOutput), and `content`
 * because dropping it would break any client that renders only text. Both copies stay, but
 * the text one is compact: pretty-printing cost 19% on a 200-finding page and no agent reads
 * the indentation.
 */
function jsonResult<T>(payload: T): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Injected into the calling agent's context at handshake, so it's the one place to shape how
 * the output is used. Kept to a checklist; it competes with the user's task for context.
 */
export const SERVER_INSTRUCTIONS = `This server DETECTS and ADVISES on migrating Angular Reactive Forms to Signal Forms.
It never edits code. You make every edit, and the user reviews it.

Order: get_migration_report for the picture, find_form_candidates for one file's edit
sites, get_signalforms_recipe per construct before writing code. Below v21,
get_angular_upgrade_plan gives the upgrade that must come first.

Rules that matter:

- CHECK THE PREREQUISITE FIRST. A BLOCKING PREREQUISITE in the report, or a non-null
  blockingPrerequisite from analyze_migration_complexity, means the Angular version is
  too old for @angular/forms/signals and NO recipe compiles — use
  get_angular_upgrade_plan instead.

- A FINDING IS A SHAPE MATCH, NOT A PROVEN DEFECT. Before calling code broken, prove it
  with a failing test; if it passes on unmodified code there was nothing to fix.

- CHECK \`incomplete\` ON EVERY find_form_candidates RESULT. Findings are paged (200) and
  filterable, so a response is often a WINDOW. Non-null means there is more and names the
  call that returns it; null means complete. A page read as the whole job under-migrates.

- NEVER treat a "judgment" finding as mechanical. The shape changes and a human decides
  the design. Ask, or present options — inventing an API to close the gap is the worst
  outcome available.

- READ THE CAVEATS before using any "after" snippet. VERSION-SENSITIVE means behaviour
  differs across releases; UNVERIFIED means the docs did not confirm it.

- TEMPLATES ARE SCANNED — external .html AND inline template: strings — as a TOKEN scan,
  not an AST (Template.* -> templateBindings recipe), so RE-RUN THE AOT BUILD after
  editing. An external .html is "reference only" and migrates WITH its component.

- Migrate in the suggested order. A file owning no form cannot move alone; shared
  validators gate every consumer, so settle their error shape early.

- AFTER MIGRATING A FILE, run verify_migration on it — it reports traps that COMPILE and
  are still wrong, so run it after tsc. It proves the ABSENCE OF KNOWN DEFECTS, never
  correctness; read checksSkipped for what it could not check.

- DO NOT INVENT API NAMES, in prose or code. Signal Forms is too new to recall reliably,
  and one wrong name recurs: there is NO "Control" export — that is pre-release naming;
  the directives are [formField] and [formRoot]. Unsure? Say so instead.`;

/**
 * Reads every scannable `.ts` under `root`, so `verifyMigration` can stay pure. Mirrors the
 * detector's traversal policy rather than inventing a second one.
 */
function collectSourceTexts(
  root: string,
): { ok: true; data: { file: string; text: string }[] } | { ok: false; error: string } {
  if (!nodeFileSystem.exists(root)) return { ok: false, error: `Path does not exist: ${root}` };

  const out: { file: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of nodeFileSystem.readDir(dir)) {
      if (nodeFileSystem.isDirectory(entry)) {
        const name = entry.split(/[\\/]/).pop() ?? '';
        if (SKIPPED_VERIFY_DIRS.has(name)) continue;
        walk(entry);
        continue;
      }
      if (!entry.endsWith('.ts') || entry.endsWith('.d.ts')) continue;
      try {
        out.push({ file: entry, text: nodeFileSystem.readFile(entry) });
      } catch {
        // Unreadable single file: skip it and keep going, as the detector does.
      }
    }
  };

  try {
    if (nodeFileSystem.isDirectory(root)) walk(root);
    else out.push({ file: root, text: nodeFileSystem.readFile(root) });
  } catch (cause) {
    return { ok: false, error: `Failed to read ${root}: ${String(cause)}` };
  }
  return { ok: true, data: out };
}

const SKIPPED_VERIFY_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  '.angular',
  '.git',
  'out-tsc',
  'coverage',
]);

export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    'find_form_candidates',
    {
      title: 'Find Angular Reactive Forms migration candidates',
      description:
        'Scans .ts and .html files (or a directory) for Angular Reactive Forms constructs and classifies each ' +
        'finding as "mechanical" (safe to transliterate) or "judgment" (a human must decide the ' +
        'target design). Read-only: this tool never modifies your files. Results are PAGED ' +
        '(default 200 findings) — check `incomplete`: non-null means there is more, and says ' +
        'how to get it. Filter with `constructs` / `classification` to work one decision at a time.',
      inputSchema: findFormCandidatesInputSchema.shape,
      outputSchema: findFormCandidatesOutputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    ({ path, offset, limit, constructs, classification }) => {
      const result = findFormCandidates(toAbsolute(path), nodeFileSystem);
      if (!result.ok) return errorResult(result.error);

      // A whole-workspace scan measured 1,474,818 bytes on 60 components before paging.
      const paged = pageFindings(result.data, {
        offset: offset ?? 0,
        limit: limit ?? DEFAULT_FINDING_LIMIT,
        ...(constructs === undefined ? {} : { constructs }),
        ...(classification === undefined ? {} : { classification }),
      });

      const payload: FindFormCandidatesOutput = {
        incomplete: paged.incomplete,
        files: paged.files.map((entry) => ({
          file: entry.file,
          findings: [...entry.findings],
          matchedInFile: entry.matchedInFile,
          partial: entry.partial,
        })),
        totalFindings: paged.page.totalUnfiltered,
        page: paged.page,
      };
      return jsonResult(payload);
    },
  );

  server.registerTool(
    'get_signalforms_recipe',
    {
      title: 'Get an Angular Signal Forms migration recipe',
      description:
        'Returns a verified before/after migration recipe for a single Reactive Forms construct ' +
        '(e.g. "FormControl", "FormBuilder.group", "Validators.required"). An unknown construct ' +
        'returns found:false plus the list of available constructs — it is never an error. ' +
        'Read-only: this tool never modifies your files.',
      inputSchema: getSignalFormsRecipeInputSchema.shape,
      outputSchema: getSignalFormsRecipeOutputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    ({ construct }) => {
      const lookup = getSignalFormsRecipe(construct);

      const payload: GetSignalFormsRecipeOutput = lookup.found
        ? {
            construct: lookup.construct,
            found: true,
            description: lookup.description,
            before: lookup.before,
            after: lookup.after,
            caveats: lookup.caveats,
            provenance: lookup.provenance,
          }
        : {
            construct: lookup.construct,
            found: false,
            availableConstructs: [...lookup.availableConstructs],
          };
      return jsonResult(payload);
    },
  );

  server.registerTool(
    'analyze_migration_complexity',
    {
      title: 'Summarise the size and shape of a Signal Forms migration',
      description:
        'Scans .ts and .html files (or a directory) and summarises the migration: total findings, counts per ' +
        'construct, the mechanical/judgment split, and a suggested file order (simplest first, ' +
        'so all-mechanical files land before the ones needing design decisions). ' +
        'Read-only: this tool never modifies your files.',
      inputSchema: analyzeMigrationComplexityInputSchema.shape,
      outputSchema: analyzeMigrationComplexityOutputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    ({ path }) => {
      const absolute = toAbsolute(path);
      const result = findFormCandidates(absolute, nodeFileSystem);
      if (!result.ok) return errorResult(result.error);

      const version = detectAngularVersion(absolute, nodeFileSystem);
      return jsonResult({
        ...analyzeMigrationComplexity(result.data),
        angularVersion: version.known ? version.raw : null,
        signalFormsAvailable: version.known ? signalFormsAvailable(version.major) : null,
        // Stated plainly so an agent cannot start a migration that cannot compile.
        blockingPrerequisite:
          version.known && !signalFormsAvailable(version.major)
            ? `@angular/forms/signals does not exist below Angular v21; this project is on ` +
              `${version.raw}. Upgrade before migrating — the findings below remain valid as ` +
              `the post-upgrade blueprint.`
            : null,
      });
    },
  );

  server.registerTool(
    'get_migration_report',
    {
      title: 'Generate a Signal Forms migration report',
      description:
        'Scans .ts and .html files (or a directory) and returns a MARKDOWN REPORT combining findings, ' +
        'complexity, a suggested file order, the constructs present with their recipe names, ' +
        'and a warning for any version-sensitive recipe involved. Returns the report as a ' +
        'string — it does NOT write a file; you decide whether to save it. ' +
        'Read-only: this tool never modifies your files.',
      inputSchema: getMigrationReportInputSchema.shape,
      outputSchema: getMigrationReportOutputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    ({ path }) => {
      const absolute = toAbsolute(path);
      const result = findFormCandidates(absolute, nodeFileSystem);
      if (!result.ok) return errorResult(result.error);

      const withFindings = result.data.filter((entry) => entry.findings.length > 0);
      const markdown = buildMigrationReport(
        absolute,
        result.data,
        detectAngularVersion(absolute, nodeFileSystem),
        assessCoverage(
          withFindings.map((entry) => entry.file),
          nodeFileSystem,
        ),
        // The second gate. A correct Angular version is not sufficient: legacy `node` module
        // resolution cannot import @angular/forms/signals at all.
        detectModuleResolution(absolute, nodeFileSystem),
      );
      return {
        // The markdown is the payload, so it goes in content as-is rather than JSON-encoded.
        content: [{ type: 'text', text: markdown }],
        structuredContent: { markdown },
      };
    },
  );

  server.registerTool(
    'get_angular_upgrade_plan',
    {
      title: 'Plan the Angular upgrade that Signal Forms requires',
      description:
        'Signal Forms needs Angular 21+. When a project is older, this returns the upgrade ' +
        "plan as markdown, reproducing angular.dev/update-guide from Angular's own published " +
        'step data — not written by this server. The current version is detected from the ' +
        'project; you choose application complexity (1 Basic, 2 Medium, 3 Advanced) and ' +
        'whether you use ngUpgrade, Angular Material or Windows, exactly as the official ' +
        'guide asks. Read-only: this tool never modifies your files.',
      inputSchema: getAngularUpgradePlanInputSchema.shape,
      outputSchema: getAngularUpgradePlanOutputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    ({ path, fromMajor, toMajor, level, ngUpgrade, material, windows }) => {
      const detected = detectAngularVersion(toAbsolute(path), nodeFileSystem);
      const from = fromMajor ?? (detected.known ? detected.major : undefined);

      if (from === undefined) {
        return errorResult(
          "Could not determine the project's Angular version, and no fromMajor was given. " +
            (detected.known ? '' : detected.reason),
        );
      }

      const to = toMajor ?? VERIFIED_ANGULAR_VERSION;

      // A downgrade or no-op range is a caller error, not an empty plan.
      const invalid = validateUpgradeRange(from, to);
      if (invalid !== undefined) return errorResult(invalid);

      // Infer from the manifest, but explicit arguments still win.
      const manifest = findAngularManifest(toAbsolute(path), nodeFileSystem);
      const inferred = inferUpgradeOptions(manifest);

      const plan = buildUpgradePlan(from, to, {
        level: level ?? 3,
        ngUpgrade: ngUpgrade ?? inferred.ngUpgrade,
        material: material ?? inferred.material,
        // Only the caller knows their OS; the manifest cannot say.
        windows: windows ?? false,
      });

      // Where the manifest lives is where node_modules lives.
      const manifestDir = detected.known
        ? detected.from.replace(/\/(node_modules\/@angular\/core\/)?package\.json$/, '')
        : toAbsolute(path);
      const declared = declaredDependencyNames(manifest);
      const peers = findPeerBlockers(declared, to, (name) => readInstalledPeer(manifestDir, name));
      const isNxWorkspace = declared.some((n) => n === 'nx' || n.startsWith('@nx/'));

      // material and ngUpgrade can be read off package.json; `windows` cannot — nothing in a
      // manifest says what OS anyone is on. Anything neither answered nor inferred was never
      // asked, and the report must not attribute it to the user.
      const inferredOptions = [
        ...(material === undefined ? ['material'] : []),
        ...(ngUpgrade === undefined ? ['ngUpgrade'] : []),
      ];
      const answeredOptions = [
        ...(material === undefined ? [] : ['material']),
        ...(ngUpgrade === undefined ? [] : ['ngUpgrade']),
        ...(windows === undefined ? [] : ['windows']),
      ];
      const markdown = buildUpgradeReport(
        plan,
        to >= MIN_SIGNAL_FORMS_VERSION,
        detectCompanions(manifest, readBuildConfigs(manifestDir)),
        inferredOptions,
        { isNxWorkspace, peers, answered: answeredOptions },
      );
      return {
        content: [{ type: 'text', text: markdown }],
        structuredContent: { markdown },
      };
    },
  );

  server.registerTool(
    'verify_migration',
    {
      title: 'Verify an already-migrated Signal Forms file',
      description:
        'Reads code you have ALREADY migrated and reports Signal Forms traps that COMPILE and ' +
        'are still wrong — a missed signal call in a position TypeScript does not check, a ' +
        'deprecated-but-valid v21 rule shape, a pre-release API name, an AbstractControl left ' +
        'in a form() model, Reactive Forms imports left behind. Run it after tsc, not instead ' +
        'of it: anything the compiler already reports is deliberately not repeated here. ' +
        'Read-only. It proves the ABSENCE OF KNOWN DEFECTS, never correctness.',
      inputSchema: verifyMigrationInputSchema.shape,
      outputSchema: verifyMigrationOutputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    ({ path }) => {
      const root = toAbsolute(path);
      const collected = collectSourceTexts(root);
      if (!collected.ok) return errorResult(collected.error);

      const report = verifyMigration(collected.data);
      const all = report.files.flatMap((entry) => entry.findings);

      const payload: VerifyMigrationOutput = {
        files: report.files.map((entry) => ({ file: entry.file, findings: [...entry.findings] })),
        errorCount: all.filter((f) => f.severity === 'error').length,
        warningCount: all.filter((f) => f.severity === 'warning').length,
        infoCount: all.filter((f) => f.severity === 'info').length,
        notMigratedFiles: [...report.notMigratedFiles],
        checksRun: VERIFY_CHECKS.filter(
          (check) => !ALWAYS_SKIPPED.some((skipped) => skipped.check === check),
        ),
        checksSkipped: ALWAYS_SKIPPED.map((skipped) => ({ ...skipped })),
        disclaimer: VERIFY_DISCLAIMER,
      };
      return jsonResult(payload);
    },
  );

  return server;
}

/** What the process should do, decided from argv. Pure, so it is unit-testable. */
export type CliAction = 'version' | 'help' | 'serve';

export function resolveCliAction(argv: readonly string[]): CliAction {
  if (argv.some((arg) => arg === '--version' || arg === '-v' || arg === '-V')) return 'version';
  if (argv.some((arg) => arg === '--help' || arg === '-h')) return 'help';
  // Unknown flags are ignored: an MCP client may pass through arguments we don't recognise.
  return 'serve';
}

export const USAGE_TEXT = `${SERVER_NAME} v${SERVER_VERSION}

An MCP server that finds Angular Reactive Forms and advises on migrating them to
Signal Forms. It detects and advises only — it never edits your code.

Usage:
  ${SERVER_NAME}            Start the MCP server on stdio (what an MCP client does).
  ${SERVER_NAME} --version  Print the version.
  ${SERVER_NAME} --help     Show this message.

Add it to Claude Code:
  claude mcp add signal-forms-migration -- npx -y ${SERVER_NAME}@latest

Tools: find_form_candidates, get_signalforms_recipe, analyze_migration_complexity,
get_migration_report, get_angular_upgrade_plan, verify_migration.

Docs: https://github.com/Alvi97/angular-signal-forms-migration-mcp`;

async function main(): Promise<void> {
  const action = resolveCliAction(process.argv.slice(2));

  // These are CLI invocations, not protocol sessions, so stdout is the right channel.
  if (action === 'version') {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }
  if (action === 'help') {
    process.stdout.write(`${USAGE_TEXT}\n`);
    return;
  }

  const server = createServer();
  await server.connect(new StdioServerTransport());
  logToStderr(`v${SERVER_VERSION} ready on stdio`);

  // Not awaited: the update check must never delay a session. It fails quietly and is
  // throttled to once a day.
  void checkForUpdate(SERVER_NAME, SERVER_VERSION, (message) => {
    logToStderr(message);
  });
}

/**
 * True only when this module IS the process entrypoint. Importing it — which every test of a
 * tool handler must do — has to start no transport and fire no update check. Before this
 * guard, `vitest run test/server-identity.test.ts` handed vitest's own stdio to a
 * StdioServerTransport and made a live network request.
 *
 * Realpaths on both sides, and that is mandatory rather than defensive: npm installs the bin
 * as a symlink, so argv[1] is `node_modules/.bin/angular-signal-forms-migration-mcp` while
 * import.meta.url is `dist/server.js`. Comparing them naively is false there, and a guard
 * that gets this wrong makes the published server start and then do nothing — strictly worse
 * than the unconditional start it replaces.
 */
function isEntrypoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  main().catch((cause: unknown) => {
    logToStderr(`fatal: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exit(1);
  });
}
