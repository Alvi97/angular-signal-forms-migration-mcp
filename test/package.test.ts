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
