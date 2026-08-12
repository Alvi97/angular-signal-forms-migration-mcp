import { describe, expect, it } from 'vitest';
import {
  detectModuleResolution,
  resolutionSupportsSignalForms,
} from '../src/core/module-resolution.js';
import { memoryFs } from './helpers/memory-fs.js';

/**
 * Found by running a real migration. The report said "Angular 22.0.7 — Signal Forms is
 * available", which is true about the version and false about the project: the workspace was
 * on `moduleResolution: "node"`, and `@angular/forms/signals` is a package-EXPORTS subpath
 * that `node` resolution cannot see. Nothing compiled until tsconfig moved to `bundler`.
 *
 * The same wall had already stopped an earlier attempt in that repo. Two migrations, one
 * cause, and the tool said "available" both times — a harder blocker than the version gate,
 * precisely because the version looks fine.
 */
const tsconfig = (compilerOptions: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ compilerOptions, ...extra });

describe('resolutionSupportsSignalForms', () => {
  it.each([
    ['bundler', true],
    ['node16', true],
    ['nodenext', true],
    ['NodeNext', true],
    ['node', false],
    ['node10', false],
    ['classic', false],
  ])('%s -> %s', (mode, supported) => {
    expect(resolutionSupportsSignalForms(mode)).toBe(supported);
  });
});

describe('detectModuleResolution', () => {
  it('reads moduleResolution from the nearest tsconfig', () => {
    const fs = memoryFs({
      '/repo/tsconfig.json': tsconfig({ moduleResolution: 'bundler' }),
      '/repo/src/a.ts': '',
    });
    const result = detectModuleResolution('/repo/src', fs);
    expect(result.known).toBe(true);
    if (!result.known) return;
    expect(result.resolution).toBe('bundler');
    expect(result.supported).toBe(true);
  });

  it('flags the setting that blocks the migration entirely', () => {
    const fs = memoryFs({
      '/repo/tsconfig.json': tsconfig({ moduleResolution: 'node' }),
      '/repo/src/a.ts': '',
    });
    const result = detectModuleResolution('/repo/src', fs);
    expect(result.known).toBe(true);
    if (!result.known) return;
    expect(result.supported).toBe(false);
  });

  /** Nx and Angular workspaces almost always split this across a base config. */
  it('follows extends to a base config', () => {
    const fs = memoryFs({
      '/repo/tsconfig.base.json': tsconfig({ moduleResolution: 'node' }),
      '/repo/libs/frontend/tsconfig.json': JSON.stringify({ extends: '../../tsconfig.base.json' }),
      '/repo/libs/frontend/src/a.ts': '',
    });
    const result = detectModuleResolution('/repo/libs/frontend/src', fs);
    expect(result.known).toBe(true);
    if (!result.known) return;
    expect(result.resolution).toBe('node');
    expect(result.supported).toBe(false);
  });

  /** A nearer config overriding the base is exactly how this gets fixed. */
  it('prefers the nearest config over the one it extends', () => {
    const fs = memoryFs({
      '/repo/tsconfig.base.json': tsconfig({ moduleResolution: 'node' }),
      '/repo/libs/frontend/tsconfig.json': JSON.stringify({
        extends: '../../tsconfig.base.json',
        compilerOptions: { moduleResolution: 'bundler' },
      }),
      '/repo/libs/frontend/src/a.ts': '',
    });
    const result = detectModuleResolution('/repo/libs/frontend/src', fs);
    expect(result.known).toBe(true);
    if (!result.known) return;
    expect(result.resolution).toBe('bundler');
    expect(result.supported).toBe(true);
  });

  it('tolerates comments and trailing commas, which real tsconfigs have', () => {
    const fs = memoryFs({
      '/repo/tsconfig.json': `{
  // Angular workspaces ship jsonc here.
  "compilerOptions": {
    "moduleResolution": "bundler", /* trailing */
  },
}`,
      '/repo/src/a.ts': '',
    });
    const result = detectModuleResolution('/repo/src', fs);
    expect(result.known).toBe(true);
    if (!result.known) return;
    expect(result.resolution).toBe('bundler');
  });

  /** Silence must not read as a pass: no tsconfig means unknown, not fine. */
  it('reports unknown rather than assuming success when no tsconfig is found', () => {
    const fs = memoryFs({ '/repo/src/a.ts': '' });
    const result = detectModuleResolution('/repo/src', fs);
    expect(result.known).toBe(false);
    if (result.known) return;
    expect(result.reason).toMatch(/tsconfig/i);
  });

  it('reports unknown when the option is simply absent', () => {
    const fs = memoryFs({
      '/repo/tsconfig.json': tsconfig({ strict: true }),
      '/repo/src/a.ts': '',
    });
    const result = detectModuleResolution('/repo/src', fs);
    expect(result.known).toBe(false);
  });
});
