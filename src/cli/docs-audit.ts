#!/usr/bin/env node
/**
 * `npm run docs:audit` — prints recipe provenance and flags anything stale.
 *
 * This is a CLI, not library code, so stdout is the correct output channel here.
 * (The MCP server in src/server.ts must never write to stdout; that rule is about
 * the stdio protocol channel, which this process is not part of.)
 */
import { auditRecipes, formatAuditReport } from '../core/audit.js';

const report = auditRecipes();
process.stdout.write(`${formatAuditReport(report)}\n`);

// Non-zero exit when anything is stale, so CI can gate on it.
process.exit(report.stale.length === 0 ? 0 : 1);
