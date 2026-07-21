/**
 * Renders an upgrade plan as markdown — pure.
 *
 * Every step's text is Angular's own, reproduced verbatim. This file arranges and frames
 * them; it never rewrites them, and it always links back to the official guide so the
 * output can be checked against the source it came from.
 */
import { MIN_SIGNAL_FORMS_VERSION } from './angular-version.js';
import { groupCompanions, type Companion } from './companions.js';
import type { PeerBlockerReport } from './peer-blockers.js';
import type { UpgradePlan } from './upgrade.js';

const LEVEL_NAMES: Readonly<Record<number, string>> = {
  1: 'Basic',
  2: 'Medium',
  3: 'Advanced',
};

const CATEGORY_TITLES: Readonly<Record<Companion['category'], string>> = {
  external: 'Outside Angular’s guidance — must be planned separately',
  'build-tooling': 'Build tooling affected by the target version',
  'release-train': 'Moves with Angular (ng update normally handles these)',
};

/**
 * Packages that gate the upgrade but appear nowhere in Angular's own steps.
 *
 * A reader following the plan hit two of these — Nx pinning Angular support, and a custom
 * webpack builder against v22's deprecation — and had to work them out themselves.
 */
function companionLines(companions: readonly Companion[]): string[] {
  if (companions.length === 0) return [];

  const lines = ['## Other packages that constrain this upgrade', ''];
  lines.push(
    'Angular’s update guide models Angular. These are installed here, are coupled to the ' +
      'Angular version, and are **not** covered by the steps below:',
  );
  lines.push('');

  let current: Companion['category'] | undefined;
  for (const group of groupCompanions(companions)) {
    if (group.category !== current) {
      current = group.category;
      lines.push(`**${CATEGORY_TITLES[current]}**`);
      lines.push('');
    }

    // One bullet per piece of advice, listing every package it applies to — an Nx
    // workspace installs a dozen packages that all say the same thing.
    const shown = group.names.slice(0, 4).map((n) => `\`${n}\``);
    const extra = group.names.length - shown.length;
    const named = extra > 0 ? `${shown.join(', ')} +${String(extra)} more` : shown.join(', ');
    const range = group.ranges[group.names[0] ?? ''] ?? '';

    lines.push(
      `- ${named}${group.names.length > 1 ? ` (${String(group.names.length)} packages, ${range})` : ` (${range})`}`,
    );
    lines.push(`  - ${group.note}`);
    lines.push('');
  }

  return lines;
}

/**
 * Third-party packages that will refuse to install against the target.
 *
 * Discovering these through successive ERESOLVE failures costs a cycle each. They are all
 * declared up front in the installed manifests.
 */
function peerLines(peers: PeerBlockerReport | undefined, target: number): string[] {
  if (peers === undefined) return [];

  if (peers.inspected === 0) {
    return [
      '## Third-party Angular packages — not checked',
      '',
      'No installed package manifests could be read (node_modules is absent or incomplete), ' +
        'so this plan does NOT include a compatibility check of your third-party Angular ' +
        'libraries. Run `npm install` and re-run this tool: a single library capped at your ' +
        'current major will fail the upgrade install.',
      '',
    ];
  }

  if (peers.blocking.length === 0 && peers.unknown.length === 0) return [];

  const lines = [`## Third-party packages that constrain Angular v${String(target)}`, ''];

  if (peers.blocking.length > 0) {
    lines.push(
      `These declare an \`@angular/core\` peer range that **excludes v${String(target)}**. ` +
        'They will fail the install — bump or replace them as part of the upgrade, not after it:',
    );
    lines.push('');
    for (const pkg of peers.blocking) {
      lines.push(`- \`${pkg.name}\` ${pkg.installed} — peer \`${pkg.peerRange}\``);
    }
    lines.push('');
  }

  if (peers.unknown.length > 0) {
    lines.push(
      'These declare an Angular peer range that could not be parsed with confidence. ' +
        'Check them by hand rather than assuming either way:',
    );
    lines.push('');
    for (const pkg of peers.unknown) {
      lines.push(`- \`${pkg.name}\` ${pkg.installed} — peer \`${pkg.peerRange}\``);
    }
    lines.push('');
  }

  return lines;
}

export interface UpgradeReportContext {
  /** True when the workspace is Nx-driven, which changes the upgrade command entirely. */
  readonly isNxWorkspace?: boolean;
  readonly peers?: PeerBlockerReport;
}

export function buildUpgradeReport(
  plan: UpgradePlan,
  signalFormsGoal: boolean,
  companions: readonly Companion[] = [],
  /** Options answered from package.json rather than by the caller. */
  inferred: readonly string[] = [],
  context: UpgradeReportContext = {},
): string {
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

  // Rendered for a single hop too: an Nx workspace needs the right driver even for one
  // major, and that guidance used to be hidden behind a multi-hop check.
  if (plan.majorSteps.length >= 1) {
    lines.push(
      plan.majorSteps.length > 1 ? '## Upgrade one major at a time' : '## The upgrade command',
    );
    lines.push('');
    lines.push(
      plan.majorSteps.length > 1
        ? `Angular supports upgrading a single major at a time. You are crossing ` +
            `${String(plan.majorSteps.length)} majors, so run them in sequence, building and ` +
            'testing between each:'
        : 'One major to cross:',
    );
    lines.push('');
    let previous = plan.fromMajor;
    for (const major of plan.majorSteps) {
      // In an Nx workspace `ng update` is the wrong driver: nx migrate runs the Angular
      // migrations AND the Nx ones in the right order. Printing ng update here while the
      // companions section says "run nx migrate" would be the report contradicting itself.
      const command = context.isNxWorkspace
        ? '`nx migrate <nx-version-supporting-angular-' +
          String(major) +
          '>` then ' +
          '`npm install` then `nx migrate --run-migrations`'
        : `\`npx @angular/cli@${String(major)} update @angular/core@${String(major)} ` +
          `@angular/cli@${String(major)}\``;
      lines.push(`${String(previous)} → ${String(major)}: ${command}`);
      previous = major;
    }
    if (context.isNxWorkspace === true) {
      lines.push('');
      lines.push(
        '**This is an Nx workspace**, so `nx migrate` drives the upgrade rather than ' +
          '`ng update` — it sequences the Angular migrations and the Nx ones together. Nx ' +
          'majors support a moving window of Angular versions, so check which Nx version ' +
          'covers your target before each hop: ' +
          '`npm view @nx/angular@<version> peerDependencies`.',
      );
    }
    lines.push('');
    lines.push(
      'The steps below are the full set for the whole span. Re-run this tool after each ' +
        'major to see only what remains.',
    );
    lines.push('');
  }

  lines.push(...companionLines(companions));
  lines.push(...peerLines(context.peers, plan.toMajor));

  /* ---- What the answers did ------------------------------------------------ */

  const answered = (['ngUpgrade', 'material', 'windows'] as const).map((option) => {
    const impact = plan.optionImpact[option];
    if (impact.applicable === 0) {
      return `- \`${option}\` — cannot affect this version range; your answer changes nothing.`;
    }
    // Say where the answer came from. Claiming "you said" for something read out of
    // package.json misrepresents both its source and its reliability.
    const said = inferred.includes(option) ? 'detected from package.json' : 'you answered';

    if (impact.includedByAnswer > 0) {
      return `- \`${option}\` — **yes** (${said}), so ${String(impact.includedByAnswer)} step(s) are INCLUDED below.`;
    }
    if (impact.excludedByAnswer > 0) {
      return `- \`${option}\` — **no** (${said}), so ${String(impact.excludedByAnswer)} step(s) were EXCLUDED. Pass \`${option}: true\` if that is wrong.`;
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
