/**
 * Packages that constrain an Angular upgrade (pure). The update guide models Angular, but
 * real workspaces are gated by things it never mentions (Nx's own Angular support, webpack
 * builders v22 deprecates). This invents no compatibility matrix; it reports what's installed,
 * why it's coupled to Angular, and where the authoritative answer lives.
 */

export type CompanionCategory =
  /** Versioned with Angular itself; `ng update` normally carries it along. */
  | 'release-train'
  /** Build tooling the target version changes or deprecates. */
  | 'build-tooling'
  /** Outside Angular's guidance entirely; has its own compatibility matrix. */
  | 'external';

export interface Companion {
  readonly name: string;
  readonly installed: string;
  readonly category: CompanionCategory;
  readonly note: string;
  /** Build tooling no supplied config references. Only true when configs were provided. */
  readonly unused: boolean;
}

interface CompanionRule {
  readonly match: RegExp;
  readonly category: CompanionCategory;
  readonly note: string;
}

const RULES: readonly CompanionRule[] = [
  {
    match: /^nx$|^@nx\//,
    category: 'external',
    note:
      'Nx pins which Angular versions it supports, and Angular’s update guide does not ' +
      'cover it. Nx must be upgraded in lockstep — check its own compatibility matrix and ' +
      'run `nx migrate` alongside each Angular hop.',
  },
  {
    match: /^@angular\/(material|cdk)$/,
    category: 'release-train',
    note:
      'Ships on the same release train as Angular and must move to the same major. ' +
      '`ng update` normally handles it; verify it did.',
  },
  {
    match: /^@angular\/(ssr|animations|platform-server|upgrade|elements|service-worker)$/,
    category: 'release-train',
    note: 'Part of the Angular release train — same major as @angular/core.',
  },
  {
    match: /^@angular-builders\//,
    category: 'build-tooling',
    note:
      'A third-party builder wrapping the Angular build. It tracks Angular majors on its ' +
      'own schedule, and Angular v22 deprecates webpack builders in favour of ' +
      '`@angular/build` — check the builder supports your target before starting.',
  },
  {
    match: /^@angular-devkit\/build-angular$/,
    category: 'build-tooling',
    note:
      'The webpack-based builder. Angular v22 deprecates it in favour of `@angular/build` ' +
      '(esbuild/application). Deprecated, not removed — but plan the move.',
  },
  {
    match: /^zone\.js$/,
    category: 'release-train',
    note: 'Version is tied to the Angular major; `ng update` adjusts it.',
  },
];

/** All dependency sections of a package.json, tolerant of anything malformed. */
function allDependencies(manifest: unknown): Record<string, string> {
  const merged: Record<string, string> = {};
  if (typeof manifest !== 'object' || manifest === null) return merged;

  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = (manifest as Record<string, unknown>)[section];
    if (typeof deps !== 'object' || deps === null || Array.isArray(deps)) continue;
    for (const [name, range] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof range === 'string') merged[name] = range;
    }
  }
  return merged;
}

/** Every dependency name declared in the manifest, across all sections. */
export function declaredDependencyNames(manifest: unknown): string[] {
  return Object.keys(allDependencies(manifest)).sort((a, b) => a.localeCompare(b));
}

export function detectCompanions(
  manifest: unknown,
  /** Raw contents of angular.json / project.json files, if available. */
  buildConfigs: readonly string[] = [],
): Companion[] {
  const deps = allDependencies(manifest);
  const found: Companion[] = [];
  const configText = buildConfigs.join('\n');

  for (const [name, installed] of Object.entries(deps)) {
    const rule = RULES.find((candidate) => candidate.match.test(name));
    if (rule === undefined) continue;

    // A builder nothing references is dead weight that will fight the upgrade install.
    // Only claim that when config was actually inspected.
    const unused =
      rule.category === 'build-tooling' && configText !== '' && !configText.includes(name);

    found.push({
      name,
      installed,
      category: rule.category,
      unused,
      note: unused
        ? `Declared but NOT referenced by any builder or executor in your build config. ` +
          'It is dead weight pinning old Angular peers, and will fight the upgrade ' +
          'install — remove it rather than upgrading it.'
        : rule.note,
    });
  }

  // Group by category, then alphabetically, so the output is stable and readable.
  const order: Record<CompanionCategory, number> = {
    external: 0,
    'build-tooling': 1,
    'release-train': 2,
  };
  return found.sort(
    (a, b) => order[a.category] - order[b.category] || a.name.localeCompare(b.name),
  );
}

/** Answers the guide's optional-dependency questions (Material, ngUpgrade) from the manifest. */
export function inferUpgradeOptions(manifest: unknown): {
  material: boolean;
  ngUpgrade: boolean;
} {
  const deps = allDependencies(manifest);
  return {
    material: '@angular/material' in deps,
    ngUpgrade: '@angular/upgrade' in deps,
  };
}

export interface CompanionGroup {
  readonly category: CompanionCategory;
  readonly note: string;
  /** Every installed package sharing this advice, with its range. */
  readonly names: string[];
  readonly ranges: Record<string, string>;
}

/** Collapses packages that share advice into one entry (a dozen @nx/* packages, one note). */
export function groupCompanions(companions: readonly Companion[]): CompanionGroup[] {
  const groups = new Map<string, CompanionGroup>();

  for (const companion of companions) {
    const key = `${companion.category}::${companion.note}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        category: companion.category,
        note: companion.note,
        names: [companion.name],
        ranges: { [companion.name]: companion.installed },
      });
      continue;
    }
    existing.names.push(companion.name);
    existing.ranges[companion.name] = companion.installed;
  }

  return [...groups.values()].map((group) => ({
    ...group,
    names: [...group.names].sort((a, b) => a.localeCompare(b)),
  }));
}
