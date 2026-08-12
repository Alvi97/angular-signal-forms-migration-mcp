/**
 * The SECOND prerequisite (pure).
 *
 * `@angular/forms/signals` is a package-EXPORTS subpath. TypeScript's legacy `node` resolution
 * does not read an exports map, so it cannot resolve the entry point at all — every import
 * fails with TS2307 and the migration cannot compile, on any Angular version.
 *
 * Found by running a real migration: the report said "Angular 22.0.7 — Signal Forms is
 * available", which was true about the version and false about the project. An earlier attempt
 * in the same repo had hit the identical wall and fixed it by hand. This is a harder blocker
 * than the version gate precisely because the version looks fine.
 */
import type { FileSystemPort } from './detect.js';

/** Resolution modes that read a package exports map. */
const EXPORTS_AWARE: ReadonlySet<string> = new Set(['bundler', 'node16', 'nodenext']);

export type ModuleResolution =
  | {
      readonly known: true;
      /** The value as written, e.g. "bundler". */
      readonly resolution: string;
      /** False when this setting cannot resolve `@angular/forms/signals` at all. */
      readonly supported: boolean;
      /** Absolute path of the tsconfig the value came from. */
      readonly from: string;
    }
  | { readonly known: false; readonly reason: string };

export function resolutionSupportsSignalForms(resolution: string): boolean {
  return EXPORTS_AWARE.has(resolution.toLowerCase());
}

/** Strips `//` and block comments and trailing commas — real tsconfigs are jsonc. */
function parseJsonc(text: string): Record<string, unknown> | undefined {
  const withoutComments = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'\\])\/\/.*$/gm, '$1');
  const withoutTrailingCommas = withoutComments.replace(/,(\s*[}\]])/g, '$1');
  try {
    const parsed: unknown = JSON.parse(withoutTrailingCommas);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function parentOf(path: string): string | undefined {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return index <= 0 ? undefined : path.slice(0, index);
}

/** Resolves a relative `extends` against the config that declared it. */
function resolveExtends(from: string, target: string): string {
  const base = parentOf(from) ?? from;
  const segments = `${base}/${target}`.split(/[\\/]/);
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  const joined = out.join('/');
  return from.startsWith('/') ? `/${joined}` : joined;
}

function readCompilerOption(
  configPath: string,
  fs: FileSystemPort,
  depth = 0,
): { value: string; from: string } | undefined {
  if (depth > 8 || !fs.exists(configPath)) return undefined;

  let config: Record<string, unknown> | undefined;
  try {
    config = parseJsonc(fs.readFile(configPath));
  } catch {
    return undefined;
  }
  if (config === undefined) return undefined;

  const options = config['compilerOptions'];
  if (typeof options === 'object' && options !== null) {
    const value = (options as Record<string, unknown>)['moduleResolution'];
    // The nearest config wins, which is exactly how a workspace fixes this for one library.
    if (typeof value === 'string') return { value, from: configPath };
  }

  const extended = config['extends'];
  if (typeof extended !== 'string') return undefined;
  const target = extended.endsWith('.json') ? extended : `${extended}.json`;
  return readCompilerOption(resolveExtends(configPath, target), fs, depth + 1);
}

/**
 * Nearest `tsconfig.json` at or above `startPath`, following `extends`.
 *
 * Unknown is reported as unknown. Assuming success when no config is found would put this
 * back in the shape the whole prerequisite exists to prevent: silence reading as a pass.
 */
export function detectModuleResolution(startPath: string, fs: FileSystemPort): ModuleResolution {
  const start =
    fs.exists(startPath) && !fs.isDirectory(startPath) ? parentOf(startPath) : startPath;

  let current: string | undefined = start;
  let sawConfig = false;

  while (current !== undefined && current !== '') {
    const configPath = `${current}/tsconfig.json`;
    if (fs.exists(configPath)) {
      sawConfig = true;
      const found = readCompilerOption(configPath, fs);
      if (found !== undefined) {
        return {
          known: true,
          resolution: found.value,
          supported: resolutionSupportsSignalForms(found.value),
          from: found.from,
        };
      }
    }
    current = parentOf(current);
  }

  return {
    known: false,
    reason: sawConfig
      ? 'A tsconfig.json was found but declares no `moduleResolution`, and it could not be ' +
        'traced through `extends`. Confirm it is `bundler`, `node16` or `nodenext` before ' +
        'migrating: `@angular/forms/signals` is a package-exports subpath and legacy `node` ' +
        'resolution cannot import it at all.'
      : 'No tsconfig.json was found at or above the scanned path, so the module resolution ' +
        'mode is unknown. `@angular/forms/signals` needs `bundler`, `node16` or `nodenext`.',
  };
}

/** The blocking message, when resolution is known to be wrong. */
export function moduleResolutionBlocker(detected: ModuleResolution): string | undefined {
  if (!detected.known || detected.supported) return undefined;
  return (
    `\`moduleResolution: "${detected.resolution}"\` (from \`${detected.from}\`) CANNOT resolve ` +
    '`@angular/forms/signals`. That entry point is declared through the package exports map, ' +
    'which legacy `node` resolution does not read — every import fails with TS2307 regardless ' +
    'of your Angular version. Set `moduleResolution` to `bundler` (or `node16` / `nodenext`) ' +
    'in that tsconfig BEFORE migrating. In an Nx or multi-project workspace the fix often ' +
    "belongs in the library's own tsconfig rather than the base one."
  );
}
