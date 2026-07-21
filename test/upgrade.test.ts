import { describe, expect, it } from 'vitest';
import {
  buildUpgradePlan,
  dataCoverage,
  majorToVersionCode,
  updateGuideUrl,
  validateUpgradeRange,
  type UpgradeOptions,
} from '../src/core/upgrade.js';

const ADVANCED: UpgradeOptions = {
  level: 3,
  ngUpgrade: false,
  material: false,
  windows: false,
};

describe('majorToVersionCode', () => {
  it.each([
    [19, 1900],
    [20, 2000],
    [22, 2200],
  ])('v%i -> %i', (major, code) => {
    expect(majorToVersionCode(major)).toBe(code);
  });
});

describe('buildUpgradePlan reproduces the official filter', () => {
  it('produces the same 19 -> 22 advanced plan the update guide does', () => {
    const plan = buildUpgradePlan(19, 22, ADVANCED);
    // Counted directly from Angular's own RECOMMENDATIONS with their filter logic.
    expect(plan.during.length).toBe(83);
    expect(plan.before.length).toBe(0);
    expect(plan.after.length).toBe(0);
  });

  it('includes fewer steps at a lower complexity level', () => {
    const advanced = buildUpgradePlan(19, 22, ADVANCED);
    const basic = buildUpgradePlan(19, 22, { ...ADVANCED, level: 1 });
    const medium = buildUpgradePlan(19, 22, { ...ADVANCED, level: 2 });

    expect(basic.total).toBeLessThan(medium.total);
    expect(medium.total).toBeLessThan(advanced.total);
  });

  it('never returns a step above the requested level', () => {
    for (const level of [1, 2, 3] as const) {
      const plan = buildUpgradePlan(19, 22, { ...ADVANCED, level });
      for (const step of [...plan.before, ...plan.during, ...plan.after]) {
        expect(step.level).toBeLessThanOrEqual(level);
      }
    }
  });

  it('omits steps already necessary before the starting version', () => {
    const plan = buildUpgradePlan(19, 22, ADVANCED);
    for (const step of [...plan.before, ...plan.during, ...plan.after]) {
      expect(step.necessaryAsOf).toBeGreaterThan(1900);
    }
  });
});

describe('optional dependency flags', () => {
  it('adds Angular Material steps only when Material is selected', () => {
    const without = buildUpgradePlan(19, 22, ADVANCED);
    const with_ = buildUpgradePlan(19, 22, { ...ADVANCED, material: true });

    expect(with_.total).toBeGreaterThan(without.total);
    const all = [...without.before, ...without.during, ...without.after];
    expect(all.every((s) => s.material !== true)).toBe(true);
  });

  it('adds ngUpgrade steps only when ngUpgrade is selected', () => {
    const without = buildUpgradePlan(19, 22, ADVANCED);
    const with_ = buildUpgradePlan(19, 22, { ...ADVANCED, ngUpgrade: true });
    expect(with_.total).toBeGreaterThanOrEqual(without.total);
  });

  it('reports which optional dependencies can actually change this plan', () => {
    // The guide asks all three questions for every upgrade. For 19 -> 22 only Material
    // has any applicable steps: Windows variants stop at v9 and ngUpgrade at v19. Saying
    // so is more useful than letting a user agonise over an inert checkbox.
    const plan = buildUpgradePlan(19, 22, ADVANCED);

    expect(plan.optionImpact.windows.applicable).toBe(0);
    expect(plan.optionImpact.ngUpgrade.applicable).toBe(0);
    expect(plan.optionImpact.material.applicable).toBeGreaterThan(0);
    expect(plan.irrelevantOptions).toEqual(expect.arrayContaining(['windows', 'ngUpgrade']));
    expect(plan.irrelevantOptions).not.toContain('material');
  });

  it('selecting Windows does not change a modern plan, because no such steps remain', () => {
    const posix = buildUpgradePlan(19, 22, ADVANCED);
    const windows = buildUpgradePlan(19, 22, { ...ADVANCED, windows: true });
    expect(windows.total).toBe(posix.total);
  });

  it('but Windows still swaps commands for an old upgrade, where those steps exist', () => {
    // v8 -> v9 is inside the range where the guide really does branch on Windows. The
    // variants come in matched pairs — one `windows: true`, one `windows: false` — so the
    // COUNT is identical and only the command text differs. Asserting on totals would
    // have quietly passed for the wrong reason.
    const posix = buildUpgradePlan(8, 9, { ...ADVANCED, windows: false });
    const windows = buildUpgradePlan(8, 9, { ...ADVANCED, windows: true });

    expect(windows.total).toBe(posix.total);
    expect(windows.optionImpact.windows.applicable).toBeGreaterThan(0);

    const posixActions = posix.during.map((s) => s.action).join('\n');
    const windowsActions = windows.during.map((s) => s.action).join('\n');
    expect(windowsActions).not.toBe(posixActions);
    // The Windows variants use cmd-style invocations.
    expect(windowsActions).toContain('cmd /C');
    expect(posixActions).not.toContain('cmd /C');
  });
});

describe('plan shape', () => {
  const plan = buildUpgradePlan(19, 22, ADVANCED);

  it('reports the versions it planned for', () => {
    expect(plan.fromMajor).toBe(19);
    expect(plan.toMajor).toBe(22);
  });

  it('warns that Angular is upgraded one major at a time', () => {
    expect(plan.majorSteps).toEqual([20, 21, 22]);
  });

  it('carries the provenance of the vendored data', () => {
    expect(plan.provenance.source).toContain('github.com/angular/angular');
    expect(plan.provenance.commit).toMatch(/^[0-9a-f]{7,40}$/);
  });

  it('links back to the official guide with the same parameters', () => {
    expect(updateGuideUrl(19, 22, 3)).toBe('https://angular.dev/update-guide?v=19.0-22.0&l=3');
  });

  it('is empty and harmless when already current', () => {
    const current = buildUpgradePlan(22, 22, ADVANCED);
    expect(current.total).toBe(0);
    expect(current.majorSteps).toEqual([]);
  });
});

/**
 * The data covers a finite version range. Outside it the planner must say so rather than
 * return an empty or partial plan that reads as "nothing to do" — a plan that silently
 * omits three majors is worse than a refusal.
 */
describe('version ranges outside the vendored data', () => {
  it('exposes what the data actually covers', () => {
    expect(dataCoverage().minMajor).toBeLessThanOrEqual(4);
    expect(dataCoverage().maxMajor).toBeGreaterThanOrEqual(22);
  });

  it('rejects a downgrade', () => {
    expect(validateUpgradeRange(22, 19)).toMatch(/downgrade|lower|before/i);
  });

  it('rejects a no-op range', () => {
    expect(validateUpgradeRange(19, 19)).toMatch(/already|same/i);
  });

  it.each([[0], [-3]])('rejects a nonsensical major (%i)', (major) => {
    expect(validateUpgradeRange(major, 22)).toBeDefined();
  });

  it('accepts any real forward range', () => {
    const ranges: ReadonlyArray<readonly [number, number]> = [
      [4, 22],
      [8, 12],
      [14, 17],
      [16, 22],
      [21, 22],
    ];
    for (const [from, to] of ranges) {
      expect(validateUpgradeRange(from, to), `${String(from)}->${String(to)}`).toBeUndefined();
    }
  });

  it('refuses a target beyond the newest known Angular', () => {
    // v25 does not exist. Producing the v22 plan with an "incomplete" note was still the
    // wrong answer — it is not a partial plan, it is a nonsense target.
    const message = validateUpgradeRange(19, 25);
    expect(message).toBeDefined();
    expect(message).toContain('25');
    expect(message).toContain(String(dataCoverage().maxMajor));
    // But it must not be a dead end if Angular really has shipped it since.
    expect(message).toMatch(/data:update-steps/);
  });

  it('refuses a start below the published guidance', () => {
    expect(validateUpgradeRange(1, 22)).toMatch(/predates|starts at/i);
  });

  it('accepts the newest known version as a target', () => {
    expect(validateUpgradeRange(19, dataCoverage().maxMajor)).toBeUndefined();
  });
});

describe('plans across the whole supported history', () => {
  it.each([
    [4, 22],
    [8, 12],
    [12, 16],
    [14, 17],
    [16, 22],
    [17, 21],
    [21, 22],
  ])('v%i -> v%i produces a usable plan', (from, to) => {
    const plan = buildUpgradePlan(from, to, ADVANCED);

    expect(plan.total).toBeGreaterThan(0);
    expect(plan.majorSteps[0]).toBe(from + 1);
    expect(plan.majorSteps.at(-1)).toBe(to);
    expect(plan.guideUrl).toContain(`v=${String(from)}.0-${String(to)}.0`);
    // Every returned step must genuinely belong to this span.
    for (const step of [...plan.before, ...plan.during, ...plan.after]) {
      expect(step.necessaryAsOf).toBeGreaterThan(from * 100);
      expect(step.possibleIn).toBeLessThanOrEqual(to * 100);
    }
  });
});

/**
 * A reader passed material:false and the report still said "Still relevant: material
 * (3 steps). Answer those accurately." They had answered. The line described the DATA,
 * not their answer, so it read as the tool ignoring them.
 */
describe('option impact reflects the answer given, not just the data', () => {
  it('reports what an answer of "no" excluded', () => {
    const plan = buildUpgradePlan(19, 22, { ...ADVANCED, material: false });
    expect(plan.optionImpact.material.applicable).toBeGreaterThan(0);
    expect(plan.optionImpact.material.excludedByAnswer).toBeGreaterThan(0);
    expect(plan.optionImpact.material.includedByAnswer).toBe(0);
  });

  it('reports what an answer of "yes" included', () => {
    const plan = buildUpgradePlan(19, 22, { ...ADVANCED, material: true });
    expect(plan.optionImpact.material.includedByAnswer).toBeGreaterThan(0);
    expect(plan.optionImpact.material.excludedByAnswer).toBe(0);
  });

  it('accounts for the difference the answer actually makes', () => {
    const off = buildUpgradePlan(19, 22, { ...ADVANCED, material: false });
    const on = buildUpgradePlan(19, 22, { ...ADVANCED, material: true });

    expect(on.total).toBeGreaterThan(off.total);
    expect(on.total - off.total).toBe(off.optionImpact.material.excludedByAnswer);
  });

  it('still reports an inapplicable option as unable to matter', () => {
    const plan = buildUpgradePlan(19, 22, ADVANCED);
    expect(plan.optionImpact.windows.applicable).toBe(0);
    expect(plan.irrelevantOptions).toContain('windows');
  });
});

/**
 * The tool told the reader to run three separate `ng update` hops, then handed them one
 * flat 83-item list spanning all three. They regrouped it by hand, correctly observing
 * that you cannot act on a v22 step while you are on v20.
 */
describe('steps are grouped by the hop they belong to', () => {
  const plan = buildUpgradePlan(19, 22, ADVANCED);

  it('splits the span into one group per major', () => {
    expect(plan.byMajor.map((g) => g.major)).toEqual([20, 21, 22]);
  });

  it('accounts for every step exactly once', () => {
    const grouped = plan.byMajor.reduce((sum, g) => sum + g.steps.length, 0);
    expect(grouped).toBe(plan.total);
  });

  it('puts each step in the major that makes it necessary', () => {
    for (const group of plan.byMajor) {
      for (const step of group.steps) {
        expect(Math.ceil(step.necessaryAsOf / 100)).toBe(group.major);
      }
    }
  });

  it('leads each hop with its toolchain prerequisites', () => {
    // Angular records steps roughly in the order breaking changes landed, so
    // `update_nodejs_version` sat 16th in the v20 list despite gating step one.
    for (const group of plan.byMajor) {
      const firstOther = group.steps.findIndex((s) => !/node|typescript/i.test(s.step));
      const lastToolchain = group.steps.reduce(
        (acc, s, i) => (/node|typescript/i.test(s.step) ? i : acc),
        -1,
      );
      if (lastToolchain >= 0 && firstOther >= 0) {
        expect(lastToolchain, group.major.toString()).toBeLessThan(firstOther);
      }
    }
  });
});
