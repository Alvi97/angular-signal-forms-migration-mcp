/**
 * Renders an upgrade plan as markdown — pure.
 *
 * Every step's text is Angular's own, reproduced verbatim. This file arranges and frames
 * them; it never rewrites them, and it always links back to the official guide so the
 * output can be checked against the source it came from.
 */
import { MIN_SIGNAL_FORMS_VERSION } from './angular-version.js';
import type { UpgradePlan } from './upgrade.js';
import type { UpgradeStep } from './types.js';

const LEVEL_NAMES: Readonly<Record<number, string>> = {
  1: 'Basic',
  2: 'Medium',
  3: 'Advanced',
};

function renderSteps(title: string, blurb: string, steps: readonly UpgradeStep[]): string[] {
  if (steps.length === 0) return [];
  const lines = [`## ${title} (${String(steps.length)})`, '', blurb, ''];
  for (const step of steps) {
    lines.push(`### ${step.step}`);
    lines.push('');
    // Angular's own action text, verbatim — markdown and inline HTML as published.
    lines.push(step.action);
    lines.push('');
  }
  return lines;
}

export function buildUpgradeReport(plan: UpgradePlan, signalFormsGoal: boolean): string {
  const lines: string[] = [];
  const level = LEVEL_NAMES[plan.level] ?? String(plan.level);

  lines.push(`# Angular upgrade plan: v${String(plan.fromMajor)} → v${String(plan.toMajor)}`);
  lines.push('');

  if (plan.total === 0) {
    lines.push(
      `Nothing to do — v${String(plan.fromMajor)} already satisfies the target. ` +
        (signalFormsGoal
          ? `Signal Forms needs v${String(MIN_SIGNAL_FORMS_VERSION)}+, so you can migrate.`
          : ''),
    );
    return lines.join('\n');
  }

  if (signalFormsGoal) {
    lines.push(
      `**Why this comes first:** \`@angular/forms/signals\` does not exist below Angular ` +
        `v${String(MIN_SIGNAL_FORMS_VERSION)}. Until this upgrade lands, no Signal Forms ` +
        'recipe will compile. This is the prerequisite, not part of the form migration.',
    );
    lines.push('');
  }

  lines.push(
    `Complexity: **${level}** · ${String(plan.total)} steps · ` +
      `[check against the official guide](${plan.guideUrl})`,
  );
  lines.push('');

  /* ---- One major at a time ------------------------------------------------ */

  if (plan.majorSteps.length > 1) {
    lines.push('## Upgrade one major at a time');
    lines.push('');
    lines.push(
      `Angular supports upgrading a single major per \`ng update\`. You are crossing ` +
        `${String(plan.majorSteps.length)} majors, so run them in sequence, building and ` +
        'testing between each:',
    );
    lines.push('');
    let previous = plan.fromMajor;
    for (const major of plan.majorSteps) {
      lines.push(
        `${String(previous)} → ${String(major)}: ` +
          `\`npx @angular/cli@${String(major)} update @angular/core@${String(major)} ` +
          `@angular/cli@${String(major)}\``,
      );
      previous = major;
    }
    lines.push('');
    lines.push(
      'The steps below are the full set for the whole span. Re-run this tool after each ' +
        'major to see only what remains.',
    );
    lines.push('');
  }

  /* ---- Which questions actually mattered ---------------------------------- */

  if (plan.irrelevantOptions.length > 0) {
    lines.push('## Options that do not affect this plan');
    lines.push('');
    lines.push(
      'The official guide asks about all of these for every upgrade. For **your** version ' +
        'range these have no applicable steps, so the answer cannot change the plan:',
    );
    lines.push('');
    for (const option of plan.irrelevantOptions) {
      lines.push(`- \`${option}\``);
    }
    lines.push('');
    const relevant = (['ngUpgrade', 'material', 'windows'] as const).filter(
      (option) => plan.optionRelevance[option] > 0,
    );
    if (relevant.length > 0) {
      lines.push(
        `Still relevant: ${relevant
          .map((o) => `\`${o}\` (${String(plan.optionRelevance[o])} steps)`)
          .join(', ')}. Answer those accurately.`,
      );
      lines.push('');
    }
  }

  /* ---- The steps ----------------------------------------------------------- */

  lines.push(
    ...renderSteps(
      'Before you update',
      'You could have done these already; they were not yet mandatory. Do them first — they ' +
        'reduce what breaks during the update itself.',
      plan.before,
    ),
  );
  lines.push(
    ...renderSteps(
      'During the update',
      'These become necessary within the version range you are crossing.',
      plan.during,
    ),
  );
  lines.push(
    ...renderSteps(
      'After the update',
      'Possible once you are on the target version; not required to get there.',
      plan.after,
    ),
  );

  /* ---- Provenance ---------------------------------------------------------- */

  lines.push('## Where these steps come from');
  lines.push('');
  lines.push(
    `Every step above is Angular's own, reproduced verbatim from ` +
      `[${plan.provenance.source}](${plan.provenance.source}) — the data that powers ` +
      'angular.dev/update-guide. None of it is written by this tool.',
  );
  lines.push('');
  lines.push(
    `Vendored from commit \`${plan.provenance.commit.slice(0, 10)}\` ` +
      `(${plan.provenance.committedISO.slice(0, 10)}), retrieved ${plan.provenance.retrievedISO}. ` +
      `If Angular has published newer guidance since, [the live guide](${plan.guideUrl}) is ` +
      'authoritative.',
  );

  return lines.join('\n');
}
