/**
 * The only place in the server that touches the real filesystem.
 *
 * Keeping this adapter out of src/core keeps detection pure and testable with an
 * in-memory FileSystemPort — no fixture files on disk, no temp directories.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { FileSystemPort } from '../core/detect.js';

export const nodeFileSystem: FileSystemPort = {
  isDirectory(path: string): boolean {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },

  exists(path: string): boolean {
    try {
      statSync(path);
      return true;
    } catch {
      return false;
    }
  },

  readDir(dir: string): readonly string[] {
    // Return absolute paths so callers never re-join and never depend on cwd.
    return readdirSync(dir).map((entry) => join(dir, entry));
  },

  readFile(file: string): string {
    return readFileSync(file, 'utf8');
  },
};

/** Normalises a user-supplied path to an absolute one, for stable output. */
export function toAbsolute(path: string): string {
  return resolve(path);
}

/**
 * Reads an installed package's version and its `@angular/core` peer range.
 *
 * Returns undefined when the package is not installed, which is the normal state during
 * an upgrade — callers must distinguish "not installed" from "no Angular peer".
 */
export function readInstalledPeer(
  workspaceDir: string,
  name: string,
): { version: string; peer: string | undefined } | undefined {
  try {
    const manifestPath = join(workspaceDir, 'node_modules', name, 'package.json');
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return undefined;

    const record = parsed as Record<string, unknown>;
    const version = typeof record['version'] === 'string' ? record['version'] : 'unknown';
    const peers = record['peerDependencies'];
    const peer =
      typeof peers === 'object' && peers !== null
        ? (peers as Record<string, unknown>)['@angular/core']
        : undefined;

    return { version, peer: typeof peer === 'string' ? peer : undefined };
  } catch {
    return undefined;
  }
}
