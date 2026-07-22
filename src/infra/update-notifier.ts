/**
 * The impure half of the update check: one registry request, one cache file. Never delays
 * startup, breaks a session, or writes to stdout; any failure is swallowed. Opt out with
 * SIGNAL_FORMS_MCP_NO_UPDATE_CHECK=1.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  shouldCheckForUpdate,
  updateNotice,
  UPDATE_CHECK_INTERVAL_MS,
} from '../core/update-check.js';

const REQUEST_TIMEOUT_MS = 2000;
const CACHE_DIR = join(tmpdir(), 'angular-signal-forms-migration-mcp');
const CACHE_FILE = join(CACHE_DIR, 'update-check.json');

function readLastChecked(): number | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const value = (parsed as Record<string, unknown>)['lastCheckedMs'];
    return typeof value === 'number' ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeLastChecked(nowMs: number): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheckedMs: nowMs }));
  } catch {
    // An unwritable temp dir is not a reason to fail; we just check again next time.
  }
}

/**
 * Asks the registry for the `latest` dist-tag. Returns undefined on any problem.
 *
 * Uses the package root with npm's abbreviated-metadata accept header, which is both
 * smaller than the full document and the only endpoint that honours that header — the
 * `/latest` path answers 406 for it. That combination silently broke this check once,
 * so `extractLatestVersion` is exported and unit-tested against both response shapes.
 */
async function fetchLatestVersion(packageName: string): Promise<string | undefined> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${packageName}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: 'application/vnd.npm.install-v1+json' },
    });
    if (!response.ok) return undefined;
    return extractLatestVersion(await response.json());
  } catch {
    return undefined;
  }
}

/** Reads the latest version from either registry response shape. Never throws. */
export function extractLatestVersion(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const record = body as Record<string, unknown>;

  // Package root: { "dist-tags": { "latest": "0.1.1" } }
  const tags = record['dist-tags'];
  if (typeof tags === 'object' && tags !== null) {
    const latest = (tags as Record<string, unknown>)['latest'];
    if (typeof latest === 'string') return latest;
  }

  // Single-version manifest: { "version": "0.1.1" }
  const version = record['version'];
  return typeof version === 'string' ? version : undefined;
}

/**
 * Checks for a newer release and reports it through `notify` (stderr, in practice).
 *
 * Safe to call without awaiting — every failure path resolves quietly.
 */
export async function checkForUpdate(
  packageName: string,
  currentVersion: string,
  notify: (message: string) => void,
  nowMs: number = Date.now(),
): Promise<void> {
  if (process.env['SIGNAL_FORMS_MCP_NO_UPDATE_CHECK'] === '1') return;
  if (!shouldCheckForUpdate(readLastChecked(), nowMs, UPDATE_CHECK_INTERVAL_MS)) return;

  // Recorded before the request, so a hanging registry can't cause a check every launch.
  writeLastChecked(nowMs);

  const latest = await fetchLatestVersion(packageName);
  if (latest === undefined) return;

  const notice = updateNotice(currentVersion, latest, packageName);
  if (notice !== undefined) notify(notice);
}
