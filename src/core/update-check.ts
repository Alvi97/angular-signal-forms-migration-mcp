/**
 * Update notification (pure).
 *
 * `npx pkg@latest` already upgrades on every launch, so the real problem is not the
 * mechanism but the awareness: a user pinned to an exact version, or holding an npx
 * cache entry, has no way to know a newer release exists.
 *
 * All decisions live here as pure functions; the network call and the cache file are in
 * src/infra/update-notifier.ts.
 */

/** How long to wait between checks. Once a day is plenty for a dev tool. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface Parsed {
  readonly parts: readonly number[];
  readonly prerelease: boolean;
}

function parse(version: string): Parsed | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(version.trim());
  if (match === null) return undefined;
  const parts = [match[1], match[2], match[3]].map((part) => Number.parseInt(part ?? '', 10));
  if (parts.some((part) => Number.isNaN(part))) return undefined;
  return { parts, prerelease: match[4] !== undefined };
}

/** -1 if a < b, 1 if a > b, 0 if equal or either is unparseable. */
export function compareVersions(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  if (left === undefined || right === undefined) return 0;

  for (let i = 0; i < 3; i++) {
    const l = left.parts[i] ?? 0;
    const r = right.parts[i] ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }

  // Same numbers: a prerelease sorts before its release (1.0.0-rc.1 < 1.0.0).
  if (left.prerelease === right.prerelease) return 0;
  return left.prerelease ? -1 : 1;
}

/**
 * The message to show, or undefined when there is nothing to say.
 *
 * Silent when current, ahead (a local build must not nag its own author), or when either
 * version cannot be parsed; guessing would be worse than staying quiet.
 */
export function updateNotice(
  current: string,
  latest: string,
  packageName: string,
): string | undefined {
  if (compareVersions(current, latest) !== -1) return undefined;

  return (
    `update available: ${current} -> ${latest}. ` +
    `If your MCP config pins "${packageName}@latest", restarting your editor is enough. ` +
    `Otherwise repoint it: npx -y ${packageName}@latest. ` +
    'Set SIGNAL_FORMS_MCP_NO_UPDATE_CHECK=1 to silence this.'
  );
}

/** True when enough time has passed, or the stored timestamp is missing or nonsensical. */
export function shouldCheckForUpdate(
  lastCheckedMs: number | undefined,
  nowMs: number,
  intervalMs: number = UPDATE_CHECK_INTERVAL_MS,
): boolean {
  if (lastCheckedMs === undefined) return true;
  // A timestamp in the future means a corrupt or tampered cache; check rather than trust.
  if (lastCheckedMs > nowMs) return true;
  return nowMs - lastCheckedMs >= intervalMs;
}
