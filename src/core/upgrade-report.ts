/**
 * Renders an upgrade plan as markdown — pure.
 *
 * Every step's text is Angular's own, reproduced verbatim. This file arranges and frames
 * them; it never rewrites them, and it always links back to the official guide so the
 * output can be checked against the source it came from.
 */
import { MIN_SIGNAL_FORMS_VERSION } from './angular-version.js';
import type { UpgradePlan } from './upgrade.js';

const LEVEL_NAMES: Readonly<Record<number, string>> = {
  1: 'Basic',
  2: 'Medium',
  3: 'Advanced',
};

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

  /* ---- What the answers did ------------------------------------------------ */

  const answered = (['ngUpgrade', 'material', 'windows'] as const).map((option) => {
    const impact = plan.optionImpact[option];
    if (impact.applicable === 0) {
      return `- \`${option}\` — cannot affect this version range; your answer changes nothing.`;
    }
    if (impact.includedByAnswer > 0) {
      return `- \`${option}\` — you said **yes**, so ${String(impact.includedByAnswer)} step(s) are INCLUDED below.`;
    }
    if (impact.excludedByAnswer > 0) {
      return `- \`${option}\` — you said **no**, so ${String(impact.excludedByAnswer)} step(s) were EXCLUDED. Re-run with \`${option}: true\` if that is wrong.`;
    }
    return `- \`${option}\` — no applicable steps at this complexity level.`;
  });

  lines.push('## What your answers changed');
  lines.push('');
  lines.push(...answered);
  lines.push('');

  /* ---- The steps, grouped by hop ------------------------------------------- */

  if (plan.byMajor.length > 1) {
    lines.push('## Steps, grouped by hop');
    lines.push('');
    lines.push(
      'Each group is one `ng update`. A step only becomes reachable once you are on the ' +
        'major that requires it, so working the whole span as one flat list does not work. ' +
        'Within each hop, Node and TypeScript requirements are listed first: they gate the ' +
        '`ng update` itself, but Angular records steps roughly in the order the breaking ' +
        'changes landed, not in the order you act on them.',
    );
    lines.push('');
  }

  for (const group of plan.byMajor) {
    lines.push(`## → v${String(group.major)} (${String(group.steps.length)} steps)`);
    lines.push('');
    for (const step of group.steps) {
      lines.push(`### ${step.step}`);
      lines.push('');
      lines.push(step.action);
      lines.push('');
    }
    lines.push(`**Gate:** build and test before moving past v${String(group.major)}.`);
    lines.push('');
  }

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
