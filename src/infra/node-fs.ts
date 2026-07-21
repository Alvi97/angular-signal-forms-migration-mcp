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
