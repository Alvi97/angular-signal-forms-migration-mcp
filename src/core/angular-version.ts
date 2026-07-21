/**
 * Target-project Angular version detection — pure.
 *
 * Exists because the server happily produced a 653-finding migration plan for a codebase
 * on Angular 20, where `@angular/forms/signals` does not exist at all. Every recipe in
 * that plan was unusable. The version is the first thing a report must establish.
 *
 * All filesystem access goes through the injected `FileSystemPort`, so this stays
 * unit-testable without touching disk.
 */
import type { FileSystemPort } from './detect.js';

/** The first Angular release that ships `@angular/forms/signals`. */
export const MIN_SIGNAL_FORMS_VERSION = 21;

export type AngularVersion =
  | {
      readonly known: true;
      /** Exact version string, e.g. "20.3.25" or the declared range's resolved major. */
      readonly raw: string;
      readonly major: number;
      /** Where the number came from — installed beats declared. */
      readonly source: 'node_modules' | 'package.json';
      /** Absolute path of the file the version was read from. */
      readonly from: string;
    }
  | { readonly known: false; readonly reason: string };

export function signalFormsAvailable(major: number): boolean {
  return major >= MIN_SIGNAL_FORMS_VERSION;
}

/** Parses a major version out of anything npm might legally put in a dependency range. */
function parseMajor(range: string): number | undefined {
  // Strips ^ ~ >= <= = v and whitespace, then takes the leading integer.
  const match = /^[\s^~>=<v]*(\d+)\./.exec(range) ?? /^[\s^~>=<v]*(\d+)$/.exec(range);
  if (match?.[1] === undefined) return undefined;
  const major = Number.parseInt(match[1], 10);
  return Number.isNaN(major) ? undefined : major;
}

function readJson(path: string, fs: FileSystemPort): Record<string, unknown> | undefined {
  if (!fs.exists(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(fs.readFile(path));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    // A malformed package.json is the user's problem, not a reason to fail the scan.
    return undefined;
  }
}

function dependencyRange(pkg: Record<string, unknown>, name: string): string | undefined {
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = pkg[section];
    if (typeof deps !== 'object' || deps === null) continue;
    const range = (deps as Record<string, unknown>)[name];
    if (typeof range === 'string') return range;
  }
  return undefined;
}

function parentOf(path: string): string | undefined {
  const index = path.lastIndexOf('/');
  if (index <= 0) return undefined;
  return path.slice(0, index);
}

/**
 * Directories from `startPath` up to the filesystem root.
 *
 * Walking up matters for monorepos: a scan of `libs/frontend/src/lib` has to reach the
 * workspace root where package.json actually lives.
 */
function ancestors(startPath: string, fs: FileSystemPort): string[] {
  const start =
    fs.exists(startPath) && !fs.isDirectory(startPath) ? parentOf(startPath) : startPath;
  const chain: string[] = [];
  let current: string | undefined = start;
  while (current !== undefined && current !== '') {
    chain.push(current);
    current = parentOf(current);
  }
  return chain;
}

/**
 * The nearest package.json declaring @angular/core, walking up from `startPath`.
 *
 * Shared with companion detection so both read the SAME manifest — reading a different
 * one would let the version and the dependency list disagree.
 */
export function findAngularManifest(startPath: string, fs: FileSystemPort): unknown {
  for (const dir of ancestors(startPath, fs)) {
    const pkg = readJson(`${dir}/package.json`, fs);
    if (pkg === undefined) continue;
    if (dependencyRange(pkg, '@angular/core') !== undefined) return pkg;
  }
  return undefined;
}

export function detectAngularVersion(startPath: string, fs: FileSystemPort): AngularVersion {
  let sawPackageJson = false;

  for (const dir of ancestors(startPath, fs)) {
    const packageJsonPath = `${dir}/package.json`;
    const pkg = readJson(packageJsonPath, fs);
    if (pkg === undefined) continue;
    sawPackageJson = true;

    const declared = dependencyRange(pkg, '@angular/core');
    if (declared === undefined) continue;

    // The installed version is the truth; the range is only what was asked for.
    const installedPath = `${dir}/node_modules/@angular/core/package.json`;
    const installed = readJson(installedPath, fs);
    const installedVersion =
      typeof installed?.['version'] === 'string' ? installed['version'] : undefined;

    if (installedVersion !== undefined) {
      const major = parseMajor(installedVersion);
      if (major !== undefined) {
        return {
          known: true,
          raw: installedVersion,
          major,
          source: 'node_modules',
          from: installedPath,
        };
      }
    }

    const major = parseMajor(declared);
    if (major !== undefined) {
      return { known: true, raw: declared, major, source: 'package.json', from: packageJsonPath };
    }

    return {
      known: false,
      reason:
        `Found @angular/core in ${packageJsonPath} but could not parse a version from ` +
        `"${declared}". Confirm the project's Angular version manually before migrating.`,
    };
  }

  return {
    known: false,
    reason: sawPackageJson
      ? 'No @angular/core dependency was found in any package.json above the scanned path. ' +
        'If this is an Angular project, confirm its version manually before migrating.'
      : 'No package.json was found above the scanned path, so the Angular version is unknown. ' +
        'Confirm it manually before migrating.',
  };
}
