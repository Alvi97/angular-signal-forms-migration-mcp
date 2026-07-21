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

import { detectAngularVersion, signalFormsAvailable } from './core/angular-version.js';
import { analyzeMigrationComplexity } from './core/complexity.js';
import { findFormCandidates } from './core/detect.js';
import { getSignalFormsRecipe } from './core/recipes.js';
import { buildMigrationReport } from './core/report.js';
import {
  analyzeMigrationComplexityInputSchema,
  findFormCandidatesInputSchema,
  findFormCandidatesOutputSchema,
  getSignalFormsRecipeInputSchema,
  getSignalFormsRecipeOutputSchema,
  getMigrationReportInputSchema,
  getMigrationReportOutputSchema,
  analyzeMigrationComplexityOutputSchema,
  type FindFormCandidatesOutput,
  type GetSignalFormsRecipeOutput,
} from './core/types.js';
import { nodeFileSystem, toAbsolute } from './infra/node-fs.js';

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

export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

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

      const markdown = buildMigrationReport(
        absolute,
        result.data,
        detectAngularVersion(absolute, nodeFileSystem),
      );
      return {
        // The markdown IS the payload here, so it goes in content as-is rather than
        // being JSON-encoded — the agent should be able to read or save it directly.
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
}

main().catch((cause: unknown) => {
  logToStderr(`fatal: ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exit(1);
});
