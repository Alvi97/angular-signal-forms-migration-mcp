import { describe, expect, it } from 'vitest';
import { detectAngularVersion, signalFormsAvailable } from '../src/core/angular-version.js';
import { memoryFs } from './helpers/memory-fs.js';

const pkg = (core: string) =>
  JSON.stringify({ name: 'app', dependencies: { '@angular/core': core, '@angular/forms': core } });

/** Exact installed version, the way a real node_modules reports it. */
const installed = (version: string) => JSON.stringify({ name: '@angular/core', version });

describe('detectAngularVersion', () => {
  it('prefers the exact installed version over the declared range', () => {
    const fs = memoryFs({
      '/repo/package.json': pkg('^20.0.0'),
      '/repo/node_modules/@angular/core/package.json': installed('20.3.25'),
      '/repo/src/app/a.component.ts': '',
    });

    const result = detectAngularVersion('/repo/src/app', fs);
    expect(result.known).toBe(true);
    if (!result.known) return;
    expect(result.raw).toBe('20.3.25');
    expect(result.major).toBe(20);
    expect(result.source).toBe('node_modules');
  });

  it('falls back to the declared range when nothing is installed', () => {
    const fs = memoryFs({ '/repo/package.json': pkg('^22.1.0'), '/repo/src/a.ts': '' });

    const result = detectAngularVersion('/repo/src', fs);
    expect(result.known).toBe(true);
    if (!result.known) return;
    expect(result.major).toBe(22);
    expect(result.source).toBe('package.json');
  });

  it.each([
    ['^21.0.0', 21],
    ['~22.3.1', 22],
    ['>=20.1.0', 20],
    ['22.0.0-rc.1', 22],
    ['19.2.6', 19],
  ])('parses the major from %s', (range, major) => {
    const fs = memoryFs({ '/repo/package.json': pkg(range), '/repo/a.ts': '' });
    const result = detectAngularVersion('/repo', fs);
    expect(result.known && result.major).toBe(major);
  });

  it('walks up from a nested scan path to the workspace root', () => {
    const fs = memoryFs({
      '/repo/package.json': pkg('^22.0.0'),
      '/repo/libs/frontend/src/lib/a.component.ts': '',
    });

    expect(detectAngularVersion('/repo/libs/frontend/src/lib', fs).known).toBe(true);
  });

  it('starts from the containing directory when given a file', () => {
    const fs = memoryFs({ '/repo/package.json': pkg('^22.0.0'), '/repo/src/a.ts': '' });
    expect(detectAngularVersion('/repo/src/a.ts', fs).known).toBe(true);
  });

  it.each([
    ['no package.json anywhere', {}],
    ['package.json without Angular', { '/repo/package.json': '{"name":"x"}' }],
    ['unparseable package.json', { '/repo/package.json': '{ not json' }],
    ['unparseable version range', { '/repo/package.json': pkg('workspace:*') }],
  ])('never throws: %s', (_label, files) => {
    const fs = memoryFs({ ...files, '/repo/a.ts': '' });
    expect(() => detectAngularVersion('/repo', fs)).not.toThrow();
    expect(detectAngularVersion('/repo', fs).known).toBe(false);
  });

  it('explains why it could not determine a version', () => {
    const result = detectAngularVersion('/repo', memoryFs({ '/repo/a.ts': '' }));
    expect(result.known).toBe(false);
    if (result.known) return;
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

describe('signalFormsAvailable', () => {
  it.each([
    [19, false],
    [20, false],
    [21, true],
    [22, true],
    [23, true],
  ])('v%i -> %s', (major, expected) => {
    expect(signalFormsAvailable(major)).toBe(expected);
  });
});

/**
 * toAbsolute is path.resolve (infra/node-fs.ts), which emits backslashes on win32, but
 * parentOf split on '/' only — so every Windows project reported an unknown version and the
 * v21 blocking gate silently vanished on exactly the platform types.ts ships a `windows`
 * option for. detect.ts already split on both separators.
 */
describe('win32 paths', () => {
  it('walks up a backslash path to find the manifest', () => {
    const fs = memoryFs({
      'C:\\proj\\package.json': pkg('^22.0.0'),
      'C:\\proj\\libs\\app\\a.component.ts': '',
    });

    const result = detectAngularVersion('C:\\proj\\libs\\app', fs);
    expect(result.known).toBe(true);
    if (result.known) expect(result.major).toBe(22);
  });

  it('still blocks below v21 on a backslash path', () => {
    const fs = memoryFs({
      'C:\\proj\\package.json': pkg('^19.0.0'),
      'C:\\proj\\src\\a.component.ts': '',
    });

    const result = detectAngularVersion('C:\\proj\\src', fs);
    expect(result.known).toBe(true);
    if (result.known) expect(signalFormsAvailable(result.major)).toBe(false);
  });
});
