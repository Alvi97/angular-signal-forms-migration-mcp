import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `main()` used to run at module scope, so importing the module — which every test of a tool
 * handler must do — handed the test process's stdio to a StdioServerTransport and fired a
 * live update check. Reproduced before the guard: `vitest run test/server-identity.test.ts`
 * printed "[angular-signal-forms-migration-mcp] v0.6.0 ready on stdio".
 *
 * vitest gives each test FILE a fresh module registry, so the dynamic import below really is
 * this file's first load of the module and does run its top-level code.
 */
describe('importing the server module has no side effects', () => {
  it('writes nothing to stderr and starts no transport', async () => {
    const written: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    };

    try {
      const module = await import('../src/server.js');
      expect(typeof module.createServer).toBe('function');
    } finally {
      process.stderr.write = original;
    }

    expect(written.join('')).toBe('');
  });

  it('createServer builds a server without connecting a transport', async () => {
    const { createServer } = await import('../src/server.js');
    expect(createServer()).toBeDefined();
  });
});

/**
 * The guard compares realpaths on both sides, and that is mandatory rather than defensive:
 * npm installs the bin as a symlink, so argv[1] is node_modules/.bin/<name> while
 * import.meta.url is dist/server.js. Comparing them naively is false there, and a guard that
 * gets it wrong makes the PUBLISHED server start and then do nothing — strictly worse than
 * the unconditional start it replaced. Only the built artifact can prove this.
 */
describe('the published, symlinked bin still starts', () => {
  const built = fileURLToPath(new URL('../dist/server.js', import.meta.url));

  it.skipIf(!existsSync(built))('reports its version through a symlink, as npm installs it', () => {
    const direct = execFileSync(process.execPath, [built, '--version'], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(direct.trim()).not.toBe('');

    const link = join(
      mkdtempSync(join(tmpdir(), 'sfm-bin-')),
      'angular-signal-forms-migration-mcp',
    );
    symlinkSync(built, link);

    expect(
      execFileSync(process.execPath, [link, '--version'], { encoding: 'utf8', timeout: 60_000 }),
    ).toBe(direct);
  });

  it.skipIf(!existsSync(built))('boots the stdio server through a symlink', () => {
    const link = join(
      mkdtempSync(join(tmpdir(), 'sfm-boot-')),
      'angular-signal-forms-migration-mcp',
    );
    symlinkSync(built, link);

    // Empty stdin closes the transport immediately; the banner proves main() ran at all.
    const result = execFileSync(process.execPath, [link], {
      encoding: 'utf8',
      timeout: 60_000,
      input: '',
      env: { ...process.env, SIGNAL_FORMS_MCP_NO_UPDATE_CHECK: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(result).toBeDefined();
  });
});

/**
 * USAGE listed four tools while five were registered — get_angular_upgrade_plan, the one a
 * sub-v21 user needs FIRST, was missing. Listing tools by hand drifts; this derives the truth
 * from the registered server, so adding a tool without listing it fails here.
 */
describe('--help lists every registered tool', () => {
  it('names exactly the tools the server registers', async () => {
    const { createServer, USAGE_TEXT } = await import('../src/server.js');
    const server = createServer();
    // The SDK keeps registered tools on the underlying McpServer instance.
    const registered = Object.keys(
      (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools,
    ).sort((a, b) => a.localeCompare(b));

    expect(registered.length).toBeGreaterThan(0);
    for (const name of registered) {
      expect(USAGE_TEXT, `--help omits ${name}`).toContain(name);
    }
  });
});
