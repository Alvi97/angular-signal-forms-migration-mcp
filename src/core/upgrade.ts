/**
 * Angular upgrade planning — pure.
 *
 * Signal Forms needs Angular 21+, so for most callers the first real task is an upgrade,
 * not a migration. Rather than author upgrade advice — which would be exactly the failure
 * this project exists to prevent — this reproduces Angular's own update guide against
 * Angular's own data, vendored from the repo by scripts/fetch-update-steps.mjs.
 *
 * The filter and bucketing below are transcribed from
 * adev/src/app/features/update/update.component.ts. Keep them faithful: if the official
 * logic changes, this must change with it, not diverge into a second opinion.
 */
import { createRequire } from 'node:module';
import type { ApplicationComplexity, UpgradeStep, UpgradeStepData } from './types.js';

const require = createRequire(import.meta.url);
const data = require('../data/angular-update-steps.json') as UpgradeStepData;

/** Options the official guide exposes. `pwa` and `angularCLI` exist in the data but the
 * guide never filters on them, so neither do we — faithfulness over tidiness. */
const FILTERED_OPTIONS = ['ngUpgrade', 'material', 'windows'] as const;

export interface UpgradeOptions {
  /** 1 = Basic, 2 = Medium, 3 = Advanced — the guide's "Application complexity". */
  readonly level: ApplicationComplexity;
  /** "I use ngUpgrade to combine AngularJS & Angular". */
  readonly ngUpgrade: boolean;
  /** "I use Angular Material". */
  readonly material: boolean;
  /** "I use Windows" — swaps in cmd-compatible commands. */
  readonly windows: boolean;
}

export interface UpgradePlan {
  readonly fromMajor: number;
  readonly toMajor: number;
  /** Each major to pass through. Angular supports one major at a time. */
  readonly majorSteps: number[];
  readonly level: ApplicationComplexity;
  readonly before: UpgradeStep[];
  readonly during: UpgradeStep[];
  readonly after: UpgradeStep[];
  readonly total: number;
  /**
   * How many steps in this version range each optional dependency can affect.
   *
   * The guide always asks all three questions; for a modern upgrade most of them change
   * nothing — Windows-specific steps stop at v9, and ngUpgrade steps at v19. Saying so
   * saves the caller from agonising over a checkbox that cannot alter the plan.
   */
  readonly optionRelevance: Readonly<Record<'ngUpgrade' | 'material' | 'windows', number>>;
  /** The options above with zero applicable steps, for a plain "this does not matter" note. */
  readonly irrelevantOptions: string[];
  readonly guideUrl: string;
  readonly coverage: DataCoverage;
  readonly provenance: UpgradeStepData['provenance'];
}

export interface DataCoverage {
  readonly minMajor: number;
  readonly maxMajor: number;
}

/**
 * The Angular majors the vendored data actually knows about.
 *
 * Computed from the data rather than hardcoded, so refreshing it with
 * `npm run data:update-steps` widens the range automatically.
 */
export function dataCoverage(): DataCoverage {
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (const step of data.steps) {
    min = Math.min(min, step.possibleIn, step.necessaryAsOf);
    max = Math.max(max, step.possibleIn, step.necessaryAsOf);
  }
  return { minMajor: Math.floor(min / 100), maxMajor: Math.floor(max / 100) };
}

/**
 * Rejects ranges that cannot mean anything, returning a message or undefined.
 *
 * A downgrade previously returned an empty plan, which reads as "nothing to do" — the
 * most dangerous possible answer to "how do I go from 22 to 19".
 */
export function validateUpgradeRange(fromMajor: number, toMajor: number): string | undefined {
  if (!Number.isInteger(fromMajor) || fromMajor < 1) {
    return `"${String(fromMajor)}" is not a valid Angular major version.`;
  }
  if (!Number.isInteger(toMajor) || toMajor < 1) {
    return `"${String(toMajor)}" is not a valid Angular major version.`;
  }
  if (fromMajor === toMajor) {
    return `The project is already on v${String(fromMajor)}; there is nothing to upgrade.`;
  }
  if (fromMajor > toMajor) {
    return (
      `Cannot plan a downgrade from v${String(fromMajor)} to v${String(toMajor)}. ` +
      'Angular publishes upgrade guidance only in the forward direction.'
    );
  }

  // Beyond the data is beyond Angular: the vendored file tracks released versions, so a
  // target above it does not exist yet. Producing a partial plan that looked complete was
  // the worse answer. The message names the staleness possibility so a real new release
  // is a data refresh rather than a dead end.
  const { minMajor, maxMajor } = dataCoverage();
  if (toMajor > maxMajor) {
    return (
      `Angular v${String(toMajor)} is not a known release — the newest this data covers is ` +
      `v${String(maxMajor)} (vendored ${data.provenance.retrievedISO}). If v${String(toMajor)} ` +
      'has since shipped, refresh with `npm run data:update-steps`.'
    );
  }
  if (fromMajor < minMajor) {
    return (
      `Angular v${String(fromMajor)} predates the published update guidance, which starts ` +
      `at v${String(minMajor)}.`
    );
  }

  return undefined;
}

/** The guide numbers versions as major * 100 — v19.0 is 1900. */
export function majorToVersionCode(major: number): number {
  return major * 100;
}

/** The official deep link, so a caller can check this plan against angular.dev. */
export function updateGuideUrl(
  fromMajor: number,
  toMajor: number,
  level: ApplicationComplexity,
): string {
  return `https://angular.dev/update-guide?v=${String(fromMajor)}.0-${String(toMajor)}.0&l=${String(level)}`;
}

/**
 * True when a step should be hidden given the user's options.
 *
 * Transcribed from the official logic, which is tri-state: a truthy flag means the step
 * REQUIRES that option, and an explicit `false` means the step must be hidden when the
 * option IS set (that is how Windows and POSIX command variants are kept apart).
 */
function isSkipped(step: UpgradeStep, options: UpgradeOptions): boolean {
  for (const option of FILTERED_OPTIONS) {
    const required = step[option];
    const selected = options[option];
    if (required === true && !selected) return true;
    if (required === false && selected) return true;
  }
  return false;
}

export function buildUpgradePlan(
  fromMajor: number,
  toMajor: number,
  options: UpgradeOptions,
): UpgradePlan {
  const from = majorToVersionCode(fromMajor);
  const to = majorToVersionCode(toMajor);

  const before: UpgradeStep[] = [];
  const during: UpgradeStep[] = [];
  const after: UpgradeStep[] = [];

  for (const step of data.steps) {
    // Official gate: within the requested complexity, and not already mandatory before
    // the version the user is starting from.
    if (step.level > options.level || step.necessaryAsOf <= from) continue;
    if (isSkipped(step, options)) continue;

    if (step.possibleIn <= from && step.necessaryAsOf >= from) {
      // Could have been done already, but was not yet mandatory.
      before.push(step);
    } else if (step.possibleIn > from && step.necessaryAsOf <= to) {
      during.push(step);
    } else if (step.possibleIn <= to) {
      after.push(step);
    }
  }

  const majorSteps: number[] = [];
  for (let major = fromMajor + 1; major <= toMajor; major++) majorSteps.push(major);

  // Count steps in range that carry each flag at all, regardless of what was selected.
  const relevance = { ngUpgrade: 0, material: 0, windows: 0 };
  for (const step of data.steps) {
    if (step.level > options.level || step.necessaryAsOf <= from) continue;
    if (step.possibleIn > to) continue;
    for (const option of FILTERED_OPTIONS) {
      if (option in step) relevance[option] += 1;
    }
  }

  return {
    fromMajor,
    toMajor,
    majorSteps,
    level: options.level,
    before,
    during,
    after,
    total: before.length + during.length + after.length,
    optionRelevance: relevance,
    irrelevantOptions: FILTERED_OPTIONS.filter((option) => relevance[option] === 0),
    guideUrl: updateGuideUrl(fromMajor, toMajor, options.level),
    coverage: dataCoverage(),
    provenance: data.provenance,
  };
}
