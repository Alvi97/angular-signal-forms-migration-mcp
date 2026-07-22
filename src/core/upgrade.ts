/**
 * Angular upgrade planning (pure). Signal Forms needs Angular 21+, so for most callers the
 * first task is an upgrade. Rather than author upgrade advice, this reproduces Angular's own
 * update guide against its own vendored data (scripts/fetch-update-steps.mjs). The filter and
 * bucketing are transcribed from adev's update.component.ts; keep them faithful.
 */
import { createRequire } from 'node:module';
import type { ApplicationComplexity, UpgradeStep, UpgradeStepData } from './types.js';

const require = createRequire(import.meta.url);
const data = require('../data/angular-update-steps.json') as UpgradeStepData;

/** Options the guide filters on. `pwa` and `angularCLI` exist in the data but it never uses them. */
const FILTERED_OPTIONS = ['ngUpgrade', 'material', 'windows'] as const;

export interface UpgradeOptions {
  /** 1 = Basic, 2 = Medium, 3 = Advanced — the guide's "Application complexity". */
  readonly level: ApplicationComplexity;
  /** "I use ngUpgrade to combine AngularJS & Angular". */
  readonly ngUpgrade: boolean;
  /** "I use Angular Material". */
  readonly material: boolean;
  /** "I use Windows"; swaps in cmd-compatible commands. */
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
  /** What each optional-dependency answer did to this plan. */
  readonly optionImpact: Readonly<Record<OptionName, OptionImpact>>;
  /** Options with zero applicable steps, for a "this does not matter" note. */
  readonly irrelevantOptions: string[];
  /** Steps grouped by the `ng update` hop that makes them necessary (the guide returns one flat list). */
  readonly byMajor: MajorGroup[];
  readonly guideUrl: string;
  readonly coverage: DataCoverage;
  readonly provenance: UpgradeStepData['provenance'];
}

export type OptionName = 'ngUpgrade' | 'material' | 'windows';

export interface OptionImpact {
  /** Steps in range carrying this flag; 0 means the answer can't matter. */
  readonly applicable: number;
  /** Steps present because the answer was yes. */
  readonly includedByAnswer: number;
  /** Steps withheld because the answer was no. */
  readonly excludedByAnswer: number;
}

/** One `ng update` hop: the steps that become necessary at a single major. */
export interface MajorGroup {
  readonly major: number;
  readonly steps: UpgradeStep[];
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

/** Rejects meaningless ranges (downgrade, no-op, out of data), returning a message or undefined. */
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

  // A target above the vendored data doesn't exist yet. The message names the staleness
  // possibility, so a real new release is a data refresh rather than a dead end.
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

/** The guide numbers versions as major * 100; v19.0 is 1900. */
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
 * True when a step should be hidden given the options. Tri-state, per the official logic: a
 * truthy flag means the step requires that option; `false` means hide it when the option is set
 * (how Windows and POSIX command variants stay apart).
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

  // What each answer actually did, rather than what the data merely contains.
  const impact: Record<OptionName, { applicable: number; included: number; excluded: number }> = {
    ngUpgrade: { applicable: 0, included: 0, excluded: 0 },
    material: { applicable: 0, included: 0, excluded: 0 },
    windows: { applicable: 0, included: 0, excluded: 0 },
  };

  for (const step of data.steps) {
    if (step.level > options.level || step.necessaryAsOf <= from) continue;
    if (step.possibleIn > to) continue;

    for (const option of FILTERED_OPTIONS) {
      const requirement = step[option];
      if (requirement === undefined) continue;
      impact[option].applicable += 1;

      // Mirror isSkipped, per option, so the counts explain the plan rather than the file.
      if (requirement === true) {
        if (options[option]) impact[option].included += 1;
        else impact[option].excluded += 1;
      }
    }
  }

  const optionImpact = {
    ngUpgrade: {
      applicable: impact.ngUpgrade.applicable,
      includedByAnswer: impact.ngUpgrade.included,
      excludedByAnswer: impact.ngUpgrade.excluded,
    },
    material: {
      applicable: impact.material.applicable,
      includedByAnswer: impact.material.included,
      excludedByAnswer: impact.material.excluded,
    },
    windows: {
      applicable: impact.windows.applicable,
      includedByAnswer: impact.windows.included,
      excludedByAnswer: impact.windows.excluded,
    },
  } as const;

  // Group by hop, leading each with its toolchain gates (a Node/TS requirement gates the
  // `ng update` but can appear far down the source order).
  const isToolchain = (step: UpgradeStep): boolean => /node|typescript/i.test(step.step);
  const groups = new Map<number, UpgradeStep[]>();
  for (const step of [...before, ...during, ...after]) {
    const major = Math.ceil(step.necessaryAsOf / 100);
    const bucket = groups.get(major) ?? [];
    bucket.push(step);
    groups.set(major, bucket);
  }
  const byMajor: MajorGroup[] = [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([major, steps]) => ({
      major,
      steps: [...steps.filter(isToolchain), ...steps.filter((s) => !isToolchain(s))],
    }));

  return {
    fromMajor,
    toMajor,
    majorSteps,
    level: options.level,
    before,
    during,
    after,
    total: before.length + during.length + after.length,
    optionImpact,
    irrelevantOptions: FILTERED_OPTIONS.filter((o) => optionImpact[o].applicable === 0),
    byMajor,
    guideUrl: updateGuideUrl(fromMajor, toMajor, options.level),
    coverage: dataCoverage(),
    provenance: data.provenance,
  };
}
