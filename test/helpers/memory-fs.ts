import type { FileSystemPort } from '../../src/core/detect.js';

/**
 * Normalise to forward slashes, the way a real filesystem does.
 *
 * Node on win32 accepts `C:\proj/package.json` — it does not care which separator joined the
 * segments. A mock that compares raw strings is STRICTER than the thing it stands in for,
 * which makes it fail on code that would work and pass on code that would not. Normalising
 * here keeps the fixture honest: a win32-shaped path in a test then exercises the production
 * path-walking logic rather than this helper's string equality.
 */
const normalise = (path: string): string => path.replace(/\\/g, '/');

/** In-memory filesystem: keys are absolute paths, values are file contents. */
export function memoryFs(files: Readonly<Record<string, string>>): FileSystemPort {
  const contents = new Map<string, string>();
  for (const [path, content] of Object.entries(files)) contents.set(normalise(path), content);

  const paths = [...contents.keys()];
  const directories = new Set<string>();
  for (const path of paths) {
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i++) directories.add(segments.slice(0, i).join('/'));
  }

  return {
    exists: (path) => contents.has(normalise(path)) || directories.has(normalise(path)),
    isDirectory: (path) => directories.has(normalise(path)),
    readDir: (dir) => {
      const key = normalise(dir);
      if (!directories.has(key)) throw new Error(`ENOENT: ${dir}`);
      const children = new Set<string>();
      for (const path of [...paths, ...directories]) {
        if (path.startsWith(`${key}/`)) {
          const rest = path.slice(key.length + 1).split('/')[0];
          if (rest !== undefined && rest !== '') children.add(`${key}/${rest}`);
        }
      }
      return [...children];
    },
    readFile: (file) => {
      const content = contents.get(normalise(file));
      if (content === undefined) throw new Error(`EACCES: ${file}`);
      return content;
    },
  };
}
