/**
 * The only place that touches the real filesystem. Keeping it out of src/core keeps
 * detection pure and testable with an in-memory FileSystemPort.
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
 * Reads an installed package's version and `@angular/core` peer range. Undefined when the
 * package isn't installed; callers distinguish that from "no Angular peer".
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

/**
 * Build configs naming builders/executors, so an unreferenced dependency is distinguishable
 * from a used one. Best-effort; absent config yields nothing, which callers treat as "unknown".
 */
export function readBuildConfigs(workspaceDir: string): string[] {
  const found: string[] = [];

  for (const name of ['angular.json', 'workspace.json', 'nx.json']) {
    try {
      found.push(readFileSync(join(workspaceDir, name), 'utf8'));
    } catch {
      // Absent is normal in an Nx workspace using per-project files.
    }
  }

  // Per-project configs one level down, the common Nx layout.
  try {
    for (const entry of readdirSync(workspaceDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue;
      }
      try {
        found.push(readFileSync(join(workspaceDir, entry.name, 'project.json'), 'utf8'));
      } catch {
        // Not every directory is a project.
      }
    }
  } catch {
    // Unreadable workspace root: return whatever was gathered.
  }

  return found;
}
