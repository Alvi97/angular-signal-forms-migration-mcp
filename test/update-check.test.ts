import { describe, expect, it } from 'vitest';
import { compareVersions, shouldCheckForUpdate, updateNotice } from '../src/core/update-check.js';

describe('compareVersions', () => {
  it.each([
    ['1.0.0', '1.0.1', -1],
    ['1.0.1', '1.0.0', 1],
    ['1.0.0', '1.0.0', 0],
    ['0.9.9', '0.10.0', -1],
    ['1.2.0', '1.10.0', -1],
    ['2.0.0', '1.99.99', 1],
  ])('%s vs %s -> %i', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });

  it('treats a prerelease as older than its release', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
  });

  it('never throws on junk', () => {
    expect(() => compareVersions('not-a-version', '1.0.0')).not.toThrow();
  });
});

describe('updateNotice', () => {
  it('produces a notice when a newer version exists', () => {
    const notice = updateNotice('0.1.1', '0.2.0', 'pkg');
    expect(notice).toContain('0.1.1');
    expect(notice).toContain('0.2.0');
    // It must tell the user what to actually DO, not just that they are behind.
    expect(notice).toContain('@latest');
  });

  it('is silent when current', () => {
    expect(updateNotice('0.2.0', '0.2.0', 'pkg')).toBeUndefined();
  });

  it('is silent when ahead — a local build must not nag', () => {
    expect(updateNotice('0.3.0', '0.2.0', 'pkg')).toBeUndefined();
  });

  it('is silent on unparseable input rather than guessing', () => {
    expect(updateNotice('0.1.1', '', 'pkg')).toBeUndefined();
  });
});

describe('shouldCheckForUpdate', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('checks when it has never checked before', () => {
    expect(shouldCheckForUpdate(undefined, 1_000_000, DAY)).toBe(true);
  });

  it('does not check again within the interval', () => {
    expect(shouldCheckForUpdate(1_000_000, 1_000_000 + DAY / 2, DAY)).toBe(false);
  });

  it('checks again once the interval has passed', () => {
    expect(shouldCheckForUpdate(1_000_000, 1_000_000 + DAY + 1, DAY)).toBe(true);
  });

  it('checks when the stored timestamp is in the future — a corrupt cache', () => {
    expect(shouldCheckForUpdate(9_999_999_999, 1_000_000, DAY)).toBe(true);
  });
});

import { extractLatestVersion } from '../src/infra/update-notifier.js';

/**
 * The registry answers 406 to the abbreviated-metadata header on /latest but honours it
 * on the package root. Getting that wrong made this check fail on every launch while
 * looking perfectly healthy, because it is designed to fail silently.
 */
describe('extractLatestVersion', () => {
  it('reads the package-root shape', () => {
    expect(extractLatestVersion({ 'dist-tags': { latest: '0.1.1' } })).toBe('0.1.1');
  });

  it('reads the single-manifest shape', () => {
    expect(extractLatestVersion({ version: '0.2.0' })).toBe('0.2.0');
  });

  it('prefers dist-tags when both are present', () => {
    expect(extractLatestVersion({ 'dist-tags': { latest: '2.0.0' }, version: '1.0.0' })).toBe(
      '2.0.0',
    );
  });

  it.each([[null], [undefined], ['string'], [42], [{}], [{ 'dist-tags': {} }]])(
    'returns undefined for %s rather than throwing',
    (body) => {
      expect(() => extractLatestVersion(body)).not.toThrow();
      expect(extractLatestVersion(body)).toBeUndefined();
    },
  );
});
