import { describe, expect, it } from 'vitest';
import { majorsInRange, findPeerBlockers } from '../src/core/peer-blockers.js';

describe('majorsInRange', () => {
  it.each([
    ['^19.0.0', [19]],
    ['^19.0.0 || ^20.0.0', [19, 20]],
    ['>=18.0.0 <21.0.0', [18, 19, 20]],
    ['>= 18.0.0 < 21.0.0', [18, 19, 20]],
    ['19.x', [19]],
    ['~20.1.0', [20]],
    ['^19.0.0 || ^20.0.0 || ^21.0.0', [19, 20, 21]],
  ])('%s -> %j', (range, expected) => {
    expect([...majorsInRange(range)].sort((a, b) => a - b)).toEqual(expected);
  });

  it('returns empty for anything it cannot parse, rather than guessing', () => {
    for (const range of ['*', 'workspace:*', 'latest', '']) {
      expect(majorsInRange(range).size).toBe(0);
    }
  });
});

describe('findPeerBlockers', () => {
  /** The real shape that broke a live upgrade: ngx-charts capped at Angular 19. */
  const installed = {
    '@swimlane/ngx-charts': { version: '21.1.3', peer: '^19.0.0' },
    'ngx-toastr': { version: '19.0.0', peer: '^19.0.0 || ^20.0.0 || ^21.0.0' },
    'some-lib': { version: '1.0.0', peer: undefined },
  };
  const read = (name: string) => installed[name as keyof typeof installed] ?? undefined;

  it('flags a package whose peer range excludes the target', () => {
    const found = findPeerBlockers(Object.keys(installed), 21, read);
    const names = found.blocking.map((b) => b.name);

    expect(names).toContain('@swimlane/ngx-charts');
    expect(names).not.toContain('ngx-toastr');
  });

  it('reports the declared range verbatim so the reader can judge', () => {
    const found = findPeerBlockers(Object.keys(installed), 21, read);
    expect(found.blocking[0]?.peerRange).toBe('^19.0.0');
    expect(found.blocking[0]?.installed).toBe('21.1.3');
  });

  it('lists compatible Angular-peered packages separately', () => {
    const found = findPeerBlockers(Object.keys(installed), 21, read);
    expect(found.compatible.map((c) => c.name)).toEqual(['ngx-toastr']);
  });

  it('ignores packages with no Angular peer at all', () => {
    const found = findPeerBlockers(Object.keys(installed), 21, read);
    const all = [...found.blocking, ...found.compatible, ...found.unknown];
    expect(all.map((p) => p.name)).not.toContain('some-lib');
  });

  it('separates unparseable ranges from confirmed blockers', () => {
    const odd = { 'weird-lib': { version: '1.0.0', peer: '*' } };
    const found = findPeerBlockers(['weird-lib'], 21, (n) => odd[n as keyof typeof odd]);
    expect(found.blocking).toEqual([]);
    expect(found.unknown.map((u) => u.name)).toEqual(['weird-lib']);
  });

  it('reports when nothing could be inspected at all', () => {
    // node_modules is absent during an upgrade more often than not — saying "no blockers"
    // then would be a clean bill of health the tool never actually checked.
    const found = findPeerBlockers(['a', 'b'], 21, () => undefined);
    expect(found.inspected).toBe(0);
    expect(found.blocking).toEqual([]);
  });
});
