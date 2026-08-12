import { describe, expect, it } from 'vitest';
import { buildUpgradePlan } from '../src/core/upgrade.js';
import type { UpgradeOptions, UpgradePlan } from '../src/core/upgrade.js';
import { buildUpgradeReport } from '../src/core/upgrade-report.js';

/**
 * 274 lines producing the entire text payload of get_angular_upgrade_plan, with no tests at
 * all. These assert what a user would ACT on — the commands they paste, the counts they
 * trust, and the claims the report makes about them — not that some string is present.
 */

/** Advanced complexity, no options, unless a case overrides — the guide's own defaults. */
function plan(from: number, to: number, over: Partial<UpgradeOptions> = {}): UpgradePlan {
  return buildUpgradePlan(from, to, {
    level: 3,
    ngUpgrade: false,
    material: false,
    windows: false,
    ...over,
  });
}

/** `19 → 20: \`cmd\`` lines, in order. */
function hops(markdown: string): { from: number; to: number; command: string }[] {
  return [...markdown.matchAll(/^(\d+) → (\d+): (.+)$/gm)].map((match) => ({
    from: Number(match[1]),
    to: Number(match[2]),
    command: match[3] ?? '',
  }));
}

function answerBullet(markdown: string, option: string): string {
  const line = markdown.split('\n').find((l) => l.startsWith(`- \`${option}\``));
  if (line === undefined) throw new Error(`no bullet for ${option}`);
  return line;
}

describe('the upgrade commands are the thing a user pastes', () => {
  const md = buildUpgradeReport(plan(19, 22), true);

  it('emits one hop per major, in sequence', () => {
    expect(hops(md).map((h) => [h.from, h.to])).toEqual([
      [19, 20],
      [20, 21],
      [21, 22],
    ]);
  });

  it('pins every version in a hop command to that hop TARGET, not the source', () => {
    // An off-by-one here sends the user to the wrong major and survives any toContain check.
    for (const hop of hops(md)) {
      expect(hop.command).toBe(
        `\`npx @angular/cli@${String(hop.to)} update @angular/core@${String(hop.to)} ` +
          `@angular/cli@${String(hop.to)}\``,
      );
    }
  });

  it('a single-major upgrade does not tell you to go one at a time', () => {
    const single = buildUpgradeReport(plan(21, 22), true);
    expect(hops(single)).toHaveLength(1);
    expect(single).not.toContain('Upgrade one major at a time');
  });
});

describe('an Nx workspace is never told to run ng update', () => {
  const md = buildUpgradeReport(plan(19, 22), true, [], [], {
    isNxWorkspace: true,
  });

  it('uses nx migrate', () => {
    for (const hop of hops(md)) expect(hop.command).toContain('nx migrate');
  });

  it('never emits an Angular CLI update command', () => {
    // The failure this guards is a broken migration, not a cosmetic one.
    expect(md).not.toMatch(/npx @angular\/cli@\d+ update/);
  });
});

describe('the answer bullets agree with the plan and with reality', () => {
  it('the stated count is the number the plan actually excluded', () => {
    const withoutMaterial = plan(8, 9, { material: false });
    const md = buildUpgradeReport(withoutMaterial, false);

    const stated = /(\d+) step\(s\) tagged/.exec(answerBullet(md, 'material'))?.[1];
    expect(Number(stated)).toBe(withoutMaterial.optionImpact.material.excludedByAnswer);
  });

  /**
   * Measured on v8→v9: 3 steps are tagged `material`, but enabling it adds only 2 — one is
   * gated by complexity as well. So the bullet must not read as "flip this and get 3 back".
   */
  it('does not promise that enabling the option returns exactly that many steps', () => {
    const off = plan(8, 9, { material: false });
    const on = plan(8, 9, { material: true });
    const excluded = off.optionImpact.material.excludedByAnswer;

    expect(on.total - off.total).toBeLessThan(excluded);
    const bullet = answerBullet(buildUpgradeReport(off, false), 'material');
    expect(bullet).toContain('may add fewer');
    expect(bullet).not.toMatch(/\d+ step\(s\) were EXCLUDED/);
  });

  /**
   * `windows` is never inferable — package.json says nothing about anyone's operating system
   * — so the old binary attribution ("inferred ? detected : you answered") claimed the user
   * answered a question they were never asked. Reproduced before the fix on a v8→v9 plan.
   */
  it('does not claim you answered a question that was never asked', () => {
    const md = buildUpgradeReport(plan(8, 9), false);
    expect(answerBullet(md, 'windows')).not.toContain('you answered');
    expect(answerBullet(md, 'windows')).toContain('not asked');
  });

  it('says "you answered" only when the caller actually answered', () => {
    const md = buildUpgradeReport(plan(8, 9), false, [], [], {
      answered: ['windows'],
    });
    expect(answerBullet(md, 'windows')).toContain('you answered');
  });

  it('says "detected from package.json" for an inferred option', () => {
    const md = buildUpgradeReport(plan(8, 9), false, [], ['material']);
    expect(answerBullet(md, 'material')).toContain('detected from package.json');
  });

  it('an option that cannot matter says so instead of reporting an impact', () => {
    const md = buildUpgradeReport(plan(19, 22), true);
    expect(answerBullet(md, 'ngUpgrade')).toContain('cannot affect this version range');
  });
});

describe('a no-op range', () => {
  it('renders exactly, with no trailing space', () => {
    // Only an exact assertion catches this; toContain never would.
    expect(buildUpgradeReport(plan(22, 22), false)).toBe(
      '# Angular upgrade plan: v22 → v22\n\nNothing to do — v22 already satisfies the target.',
    );
  });

  it('adds the Signal Forms sentence when that is the goal', () => {
    const md = buildUpgradeReport(plan(22, 22), true);
    expect(md.endsWith('so you can migrate.')).toBe(true);
    expect(md).not.toMatch(/ \n|\s$/);
  });
});

describe('step accounting matches the plan', () => {
  const upgrade = plan(19, 22);
  const md = buildUpgradeReport(upgrade, true);

  it('renders exactly as many steps as the plan counts', () => {
    expect((md.match(/^### /gm) ?? []).length).toBe(upgrade.total);
  });

  it('declares each hop group with its real step count', () => {
    for (const group of upgrade.byMajor) {
      expect(md).toContain(`## → v${String(group.major)} (${String(group.steps.length)} steps)`);
    }
  });
});

/**
 * One sweep across many plans — the only assertion covering every branch at once, since a
 * template hole rendering `undefined` is the classic prose-layer failure.
 *
 * Scoped to OUR rendering. The step bodies are Angular's own published text, vendored
 * verbatim, and it legitimately contains "not nullable", "`any` type", trailing spaces after
 * a link, and a few surviving http:// URLs. Asserting over the whole document would be
 * asserting about Angular's prose, which this project neither owns nor may silently rewrite.
 */
describe('no plan renders a placeholder in a slot we generate', () => {
  const plans = [
    buildUpgradeReport(plan(2, 22, { level: 1 }), true),
    buildUpgradeReport(plan(8, 9), false),
    buildUpgradeReport(plan(14, 17, { level: 2 }), false),
    buildUpgradeReport(plan(16, 18), true),
    buildUpgradeReport(plan(19, 22), true, [], [], { isNxWorkspace: true }),
    buildUpgradeReport(plan(21, 22, { level: 2 }), true),
    buildUpgradeReport(plan(22, 22), true),
  ];

  /** Interpolation slots: a version, a parenthesised value, a count, an object. */
  const HOLES: readonly RegExp[] = [
    /v(?:undefined|NaN|null)\b/,
    /\((?:undefined|NaN)\)/,
    /\b(?:undefined|NaN|null) steps?\b/,
    /\[object Object\]/,
    /\*\*(?:undefined|NaN|null)\*\*/,
  ];

  it.each(HOLES.map((r) => [r.source, r] as const))('never renders %s', (_label, pattern) => {
    for (const md of plans) expect(md).not.toMatch(pattern);
  });

  /** Lines this module composes: headings, answer bullets, hop commands, gates. */
  const ours = (md: string): string[] =>
    md
      .split('\n')
      .filter(
        (line) =>
          line.startsWith('#') ||
          line.startsWith('- `') ||
          /^\d+ → \d+: /.test(line) ||
          line.startsWith('**Gate:**'),
      );

  it('leaves no trailing whitespace on a line it composes', () => {
    for (const md of plans) {
      expect(ours(md).filter((line) => line !== line.trimEnd())).toEqual([]);
    }
  });

  it('every heading is non-empty', () => {
    for (const md of plans) {
      for (const line of ours(md).filter((l) => l.startsWith('#'))) {
        expect(line.replace(/^#+\s*/, '').trim()).not.toBe('');
      }
    }
  });
});
