import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Publishability invariants.
 *
 * These exist because `"private": true` survived from the project scaffold through eight
 * commits and was only found by a failed `npm publish`. Packaging config is easy to read
 * past, so it gets asserted rather than eyeballed.
 */
const packageJson: unknown = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
);

function field(name: string): unknown {
  if (typeof packageJson !== 'object' || packageJson === null) return undefined;
  return (packageJson as Record<string, unknown>)[name];
}

describe('the package can actually be published', () => {
  it('is not marked private', () => {
    // npm refuses to publish with EPRIVATE, and the failure only shows up at publish time.
    expect(field('private')).toBeUndefined();
  });

  it('declares the identity npm needs', () => {
    expect(field('name')).toBe('angular-signal-forms-migration-mcp');
    expect(typeof field('version')).toBe('string');
    expect(field('license')).toBe('MIT');
    expect(typeof field('description')).toBe('string');
  });

  it('ships the built output and points its entrypoints at it', () => {
    expect(field('files')).toEqual(expect.arrayContaining(['dist']));
    expect(field('main')).toBe('dist/server.js');

    const bin = field('bin');
    expect(bin).toBeTypeOf('object');
    // `npx <package-name>` only resolves when a bin matches the package name.
    expect(Object.keys(bin as Record<string, string>)).toContain(
      'angular-signal-forms-migration-mcp',
    );
    for (const target of Object.values(bin as Record<string, string>)) {
      expect(target).toBe('dist/server.js');
    }
  });

  it('rebuilds and revalidates before publishing', () => {
    const scripts = field('scripts') as Record<string, string> | undefined;
    expect(scripts?.prepublishOnly).toContain('build');
    expect(scripts?.prepublishOnly).toContain('check');
  });

  it('links back to the repository so the source is findable', () => {
    const repository = field('repository') as { url?: string } | undefined;
    expect(repository?.url).toContain('github.com/Alvi97/angular-signal-forms-migration-mcp');
  });
});

/**
 * The official MCP Registry ties an npm package to its registry entry by a shared name and
 * a matching version, and refuses to publish on any mismatch. Those are silent, publish-time
 * failures — the same class as the `"private": true` that shipped for eight commits — so they
 * are asserted here rather than discovered when `mcp-publisher publish` errors.
 */
const serverJson: unknown = JSON.parse(
  readFileSync(fileURLToPath(new URL('../server.json', import.meta.url)), 'utf8'),
);

function serverField(name: string): unknown {
  if (typeof serverJson !== 'object' || serverJson === null) return undefined;
  return (serverJson as Record<string, unknown>)[name];
}

describe('the MCP registry manifest matches the package', () => {
  it('carries the mcpName verification marker in the io.github.<user>/ namespace', () => {
    const mcpName = field('mcpName');
    expect(mcpName).toBe('io.github.Alvi97/angular-signal-forms-migration-mcp');
  });

  it('names the same server in server.json as the package.json marker', () => {
    // The registry requires server.json `name` === package.json `mcpName`, exactly.
    expect(serverField('name')).toBe(field('mcpName'));
  });

  it('points its npm package entry at this package, at the same version', () => {
    const packages = serverField('packages') as
      Array<{ registryType?: string; identifier?: string; version?: string }> | undefined;
    const npmEntry = packages?.find((p) => p.registryType === 'npm');
    expect(npmEntry?.identifier).toBe(field('name'));
    // Version must match, or mcp-publisher rejects the publish.
    expect(npmEntry?.version).toBe(field('version'));
    expect(serverField('version')).toBe(field('version'));
  });

  it('declares a stdio transport, which is what the server actually speaks', () => {
    const packages = serverField('packages') as
      Array<{ transport?: { type?: string } }> | undefined;
    expect(packages?.[0]?.transport?.type).toBe('stdio');
  });
});
