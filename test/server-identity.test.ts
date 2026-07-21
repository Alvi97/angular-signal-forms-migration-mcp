import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SERVER_NAME, SERVER_VERSION } from '../src/server.js';

const pkg: unknown = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
);
const field = (name: string) => (pkg as Record<string, unknown>)[name];

/**
 * The server announces its name and version in the MCP handshake. Hardcoding them meant
 * a published 0.1.1 still introduced itself as "signal-forms-migration-mcp 0.1.0" — the
 * old package name and a stale version. Anyone debugging which build they were running
 * would have been misled.
 */
describe('server identity', () => {
  it('matches the published package name', () => {
    expect(SERVER_NAME).toBe(field('name'));
  });

  it('matches the published version', () => {
    expect(SERVER_VERSION).toBe(field('version'));
  });
});

import { resolveCliAction } from '../src/server.js';

/**
 * `-v` is the first thing anyone types at a binary. It used to start a stdio server and
 * sit there silently, which reads as a hang.
 */
describe('command line flags', () => {
  it.each([['--version'], ['-v'], ['-V']])('%s reports the version', (flag) => {
    expect(resolveCliAction([flag])).toBe('version');
  });

  it.each([['--help'], ['-h']])('%s shows usage', (flag) => {
    expect(resolveCliAction([flag])).toBe('help');
  });

  it('serves when given no arguments — the MCP client case', () => {
    expect(resolveCliAction([])).toBe('serve');
  });

  it('serves on unrecognised arguments rather than refusing to start', () => {
    // An MCP client may pass through arguments we do not know about; failing to start
    // would be a worse outcome than ignoring them.
    expect(resolveCliAction(['--transport=stdio'])).toBe('serve');
  });
});
