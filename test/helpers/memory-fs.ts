import type { FileSystemPort } from '../../src/core/detect.js';

/** In-memory filesystem: keys are absolute paths, values are file contents. */
export function memoryFs(files: Readonly<Record<string, string>>): FileSystemPort {
  const paths = Object.keys(files);
  const directories = new Set<string>();
  for (const path of paths) {
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i++) directories.add(segments.slice(0, i).join('/'));
  }

  return {
    exists: (path) => path in files || directories.has(path),
    isDirectory: (path) => directories.has(path),
    readDir: (dir) => {
      if (!directories.has(dir)) throw new Error(`ENOENT: ${dir}`);
      const children = new Set<string>();
      for (const path of [...paths, ...directories]) {
        if (path.startsWith(`${dir}/`)) {
          const rest = path.slice(dir.length + 1).split('/')[0];
          if (rest !== undefined && rest !== '') children.add(`${dir}/${rest}`);
        }
      }
      return [...children];
    },
    readFile: (file) => {
      const content = files[file];
      if (content === undefined) throw new Error(`EACCES: ${file}`);
      return content;
    },
  };
}
