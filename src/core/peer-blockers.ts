/**
 * Third-party packages that will block an Angular upgrade (pure). Any installed package with
 * an `@angular/core` peer range is knowable up front, so this reports them instead of leaving
 * them to be found one ERESOLVE at a time. Conservative: only "blocking" when the range parses
 * cleanly and excludes the target, else "unknown".
 */

export interface PeerPackage {
  readonly name: string;
  readonly installed: string;
  readonly peerRange: string;
}

export interface PeerBlockerReport {
  /** Packages whose declared range clearly excludes the target major. */
  readonly blocking: PeerPackage[];
  /** Packages whose range clearly includes it. */
  readonly compatible: PeerPackage[];
  /** Angular-peered packages whose range could not be parsed; judge these by hand. */
  readonly unknown: PeerPackage[];
  /** How many package manifests were actually readable. Zero means nothing was checked. */
  readonly inspected: number;
}

/** What a reader supplies per package: its installed version and Angular peer range. */
export type PeerReader = (
  name: string,
) => { version: string; peer: string | undefined } | undefined;

const MAX_MAJOR = 99;

/**
 * The Angular majors a peer range admits. Handles the shapes libraries use (`^19.0.0`, `||`
 * unions, `>=18.0.0 <21.0.0`, `19.x`, `~20.1.0`); anything else returns empty, which callers
 * treat as "unknown", never "incompatible".
 */
export function majorsInRange(range: string): Set<number> {
  const majors = new Set<number>();
  const trimmed = range.trim();
  if (trimmed === '' || trimmed === '*' || /^(latest|workspace:)/.test(trimmed)) return majors;

  for (const clause of trimmed.split('||')) {
    const part = clause.trim();
    if (part === '') continue;

    // Bounded form: >=18.0.0 <21.0.0
    const lower = /(?:>=?)\s*(\d+)\./.exec(part);
    const upper = /<\s*(\d+)\./.exec(part);
    if (lower?.[1] !== undefined && upper?.[1] !== undefined) {
      const from = Number.parseInt(lower[1], 10);
      const to = Number.parseInt(upper[1], 10);
      for (let major = from; major < to && major <= MAX_MAJOR; major++) majors.add(major);
      continue;
    }

    // Caret, tilde, x-range or exact: ^19.0.0, ~20.1.0, 19.x, 19.2.6
    const single = /^[\^~]?\s*(\d+)(?:\.|$)/.exec(part);
    if (single?.[1] !== undefined) {
      majors.add(Number.parseInt(single[1], 10));
      continue;
    }

    // A lone lower bound (>=19.0.0) is too open to enumerate; treat as unparseable.
    if (lower?.[1] !== undefined) return new Set<number>();
  }

  return majors;
}

export function findPeerBlockers(
  packageNames: readonly string[],
  targetMajor: number,
  read: PeerReader,
): PeerBlockerReport {
  const blocking: PeerPackage[] = [];
  const compatible: PeerPackage[] = [];
  const unknown: PeerPackage[] = [];
  let inspected = 0;

  for (const name of packageNames) {
    const manifest = read(name);
    if (manifest === undefined) continue;
    inspected += 1;

    // No Angular peer means the Angular version cannot constrain it.
    if (manifest.peer === undefined) continue;

    const entry: PeerPackage = {
      name,
      installed: manifest.version,
      peerRange: manifest.peer,
    };
    const majors = majorsInRange(manifest.peer);

    if (majors.size === 0) unknown.push(entry);
    else if (majors.has(targetMajor)) compatible.push(entry);
    else blocking.push(entry);
  }

  const byName = (a: PeerPackage, b: PeerPackage): number => a.name.localeCompare(b.name);
  return {
    blocking: blocking.sort(byName),
    compatible: compatible.sort(byName),
    unknown: unknown.sort(byName),
    inspected,
  };
}
