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
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { analyzeMigrationComplexity } from './core/complexity.js';
import { findFormCandidates } from './core/detect.js';
import { getSignalFormsRecipe } from './core/recipes.js';
import {
  analyzeMigrationComplexityInputSchema,
  findFormCandidatesInputSchema,
  findFormCandidatesOutputSchema,
  getSignalFormsRecipeInputSchema,
  getSignalFormsRecipeOutputSchema,
  migrationComplexitySchema,
  type FindFormCandidatesOutput,
  type GetSignalFormsRecipeOutput,
} from './core/types.js';
import { nodeFileSystem, toAbsolute } from './infra/node-fs.js';

const SERVER_NAME = 'signal-forms-migration-mcp';
const SERVER_VERSION = '0.1.0';

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
      outputSchema: migrationComplexitySchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    ({ path }) => {
      const result = findFormCandidates(toAbsolute(path), nodeFileSystem);
      if (!result.ok) return errorResult(result.error);
      return jsonResult(analyzeMigrationComplexity(result.data));
    },
  );

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  logToStderr(`v${SERVER_VERSION} ready on stdio`);
}

main().catch((cause: unknown) => {
  logToStderr(`fatal: ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exit(1);
});
