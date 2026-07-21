#!/usr/bin/env node
/**
 * MCP wiring only — no logic lives here.
 *
 * Every handler is a thin adapter: parse input (zod) -> call a pure core function
 * -> shape the Result into a CallToolResult. Core never throws across this
 * boundary, so handlers translate `{ ok: false }` into `isError: true` rather
 * than relying on exceptions.
 *
 * Both tools are advertised `readOnlyHint: true`. This server DETECTS and ADVISES;
 * it never writes to the user's source files.
 */
import { readFileSync } from 'node:fs';
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

/**
 * Identity announced in the MCP handshake, read from package.json rather than hardcoded.
 *
 * These were literal strings until 0.1.1 shipped still calling itself
 * "signal-forms-migration-mcp 0.1.0" — the pre-rename package name and a stale version.
 * A server that misreports its own build makes every "which version am I running?"
 * question unanswerable.
 */
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

/** stdout is the MCP stdio channel and must stay clean — diagnostics go to stderr. */
function logToStderr(message: string): void {
  process.stderr.write(`[${SERVER_NAME}] ${message}\n`);
}

function jsonResult<T>(payload: T): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Sent to the client at handshake and injected into the calling agent's context.
 *
 * This is the server's only channel for shaping HOW its output is used. Everything here
 * is a rule that is expensive to get wrong and that an agent will otherwise get wrong by
 * default — chiefly: treating a judgment finding as a rename, and starting a migration
 * the project cannot compile. A README does not reach the model; this does.
 *
 * Kept to a checklist. It competes for context with the user's actual task.
 */
export const SERVER_INSTRUCTIONS = `This server DETECTS and ADVISES on migrating Angular Reactive Forms to Signal Forms.
It never edits code. You make every edit, and the user reviews it.

Order: get_migration_report for the picture, find_form_candidates for one file's edit
sites, get_signalforms_recipe per construct before writing replacement code. When the
project is below v21, get_angular_upgrade_plan gives the upgrade that must come first.

Rules that matter:

- CHECK THE PREREQUISITE FIRST. If the report opens with a BLOCKING PREREQUISITE, or
  analyze_migration_complexity returns a non-null blockingPrerequisite, the project's
  Angular is too old for @angular/forms/signals and NO recipe will compile. Do not
  migrate; use get_angular_upgrade_plan instead.

- NEVER treat a "judgment" finding as mechanical. Judgment means the shape changes and a
  human decides the design. Ask, or present options — do not pick one silently. Some
  constructs have NO equivalent at all (addControl/removeControl, switchMap pipelines,
  enumerating form.controls); the recipe says so, and inventing an API is the worst
  outcome available.

- READ THE CAVEATS before using any "after" snippet. VERSION-SENSITIVE means behaviour
  differs across Angular versions and a fallback is given; UNVERIFIED means the docs did
  not confirm it. Recipes carry provenance (version, source URLs, date) — if the user's
  Angular differs from it, say so rather than assuming.

- TEMPLATES ARE NOT SCANNED. Only .ts is parsed, so every migrated component also needs
  its .html updated ([formGroup]/formControlName -> [formField]), and template-driven
  forms (ngModel) produce no findings. The totals are the Reactive Forms slice only.

- Migrate in the suggested order. Files reported as not owning a form hold only a
  reference to one defined elsewhere and cannot be migrated alone — move them together
  with whichever file defines that form. Shared validator files own no
  form but gate every consumer, so settle their error shape early.


- DO NOT INVENT API NAMES, including when explaining rather than writing code. Use only
  what the recipes give you. Signal Forms is too new to recall reliably, and one wrong
  name recurs: there is NO "Control" export — that is pre-release naming, and it does not
  exist in v21+. The binding directive is FormField / [formField]; the form element
  directive is FormRoot / [formRoot]. If you are about to name an API that did not come
  from a recipe, say you are unsure instead.`;

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
        'Scans a .ts file or directory for Angular Reactive Forms constructs and classifies each ' +
        'finding as "mechanical" (safe to transliterate) or "judgment" (a human must decide the ' +
        'target design). Read-only: this tool never modifies your files.',
      inputSchema: findFormCandidatesInputSchema.shape,
      outputSchema: findFormCandidatesOutputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    ({ path }) => {
      const result = findFormCandidates(toAbsolute(path), nodeFileSystem);
      if (!result.ok) return errorResult(result.error);

      const payload: FindFormCandidatesOutput = {
        files: result.data,
        totalFindings: result.data.reduce((total, entry) => total + entry.findings.length, 0),
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
        'Scans a .ts file or directory and summarises the migration: total findings, counts per ' +
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
        'Scans a .ts file or directory and returns a MARKDOWN REPORT combining findings, ' +
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
      );
      return {
        // The markdown IS the payload here, so it goes in content as-is rather than
        // being JSON-encoded — the agent should be able to read or save it directly.
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

      // Read the manifest rather than asking the caller what is in it. Explicit
      // arguments still win — inference is a default, not an override.
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

      const inferredOptions = [
        ...(material === undefined ? ['material'] : []),
        ...(ngUpgrade === undefined ? ['ngUpgrade'] : []),
      ];
      const markdown = buildUpgradeReport(
        plan,
        to >= MIN_SIGNAL_FORMS_VERSION,
        detectCompanions(manifest, readBuildConfigs(manifestDir)),
        inferredOptions,
        { isNxWorkspace, peers },
      );
      return {
        content: [{ type: 'text', text: markdown }],
        structuredContent: { markdown },
      };
    },
  );

  return server;
}

/** What the process should do, decided from argv. Pure, so it is unit-testable. */
export type CliAction = 'version' | 'help' | 'serve';

export function resolveCliAction(argv: readonly string[]): CliAction {
  if (argv.some((arg) => arg === '--version' || arg === '-v' || arg === '-V')) return 'version';
  if (argv.some((arg) => arg === '--help' || arg === '-h')) return 'help';
  // Unknown flags are ignored rather than fatal: an MCP client may pass through
  // arguments we do not recognise, and refusing to start would be the worse failure.
  return 'serve';
}

const USAGE = `${SERVER_NAME} v${SERVER_VERSION}

An MCP server that finds Angular Reactive Forms and advises on migrating them to
Signal Forms. It detects and advises only — it never edits your code.

Usage:
  ${SERVER_NAME}            Start the MCP server on stdio (what an MCP client does).
  ${SERVER_NAME} --version  Print the version.
  ${SERVER_NAME} --help     Show this message.

Add it to Claude Code:
  claude mcp add signal-forms-migration -- npx -y ${SERVER_NAME}@latest

Tools: find_form_candidates, get_signalforms_recipe, analyze_migration_complexity,
get_migration_report.

Docs: https://github.com/Alvi97/angular-signal-forms-migration-mcp`;

async function main(): Promise<void> {
  const action = resolveCliAction(process.argv.slice(2));

  // These are CLI invocations, not protocol sessions, so stdout is the right channel.
  if (action === 'version') {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }
  if (action === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const server = createServer();
  await server.connect(new StdioServerTransport());
  logToStderr(`v${SERVER_VERSION} ready on stdio`);

  // Deliberately not awaited: the server is already serving, and a slow or unreachable
  // registry must never delay or fail a session. Every failure path inside resolves
  // quietly, and it is throttled to once a day.
  void checkForUpdate(SERVER_NAME, SERVER_VERSION, (message) => {
    logToStderr(message);
  });
}

main().catch((cause: unknown) => {
  logToStderr(`fatal: ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exit(1);
});
