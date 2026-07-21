/**
 * Vendors Angular's own update-guide data into this package.
 *
 * angular.dev/update-guide is client-rendered, so its steps cannot be scraped. They come
 * from RECOMMENDATIONS in the Angular repo, which is the authoritative source and is what
 * this script reads. Nothing here is authored — inventing upgrade steps would be exactly
 * the failure this project exists to prevent.
 *
 * Parsed with the TypeScript compiler API rather than regex, because the actions contain
 * backticks, nested quotes and HTML.
 *
 * Run: npm run data:update-steps
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO = 'angular/angular';
const PATH = 'adev/src/app/features/update/recommendations.ts';
const RAW = `https://raw.githubusercontent.com/${REPO}/main/${PATH}`;
const API = `https://api.github.com/repos/${REPO}/commits?path=${PATH}&per_page=1`;

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'src', 'data', 'angular-update-steps.json');

/** ApplicationComplexity in the source: Basic = 1, Medium = 2, Advanced = 3. */
const LEVELS = { Basic: 1, Medium: 2, Advanced: 3 };

/** Reads one object-literal property, returning a JS value or undefined. */
function readProperty(node, name) {
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
      ? property.name.text
      : undefined;
    if (key !== name) continue;

    const value = property.initializer;
    if (ts.isNumericLiteral(value)) return Number(value.text);
    if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
    // level: ApplicationComplexity.Advanced
    if (ts.isPropertyAccessExpression(value)) return LEVELS[value.name.text];
    // Actions are occasionally built by concatenating string literals.
    if (ts.isBinaryExpression(value)) {
      const parts = [];
      const walk = (n) => {
        if (ts.isBinaryExpression(n)) {
          walk(n.left);
          walk(n.right);
        } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
          parts.push(n.text);
        }
      };
      walk(value);
      return parts.join('');
    }
  }
  return undefined;
}

const [sourceText, commit] = await Promise.all([
  fetch(RAW).then((r) => {
    if (!r.ok) throw new Error(`fetch ${RAW}: ${String(r.status)}`);
    return r.text();
  }),
  fetch(API, { headers: { accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []),
]);

const sourceFile = ts.createSourceFile(PATH, sourceText, ts.ScriptTarget.Latest, true);
const steps = [];

const visit = (node) => {
  if (ts.isObjectLiteralExpression(node)) {
    const possibleIn = readProperty(node, 'possibleIn');
    const necessaryAsOf = readProperty(node, 'necessaryAsOf');
    const level = readProperty(node, 'level');
    const step = readProperty(node, 'step');
    const action = readProperty(node, 'action');

    if (
      typeof possibleIn === 'number' &&
      typeof necessaryAsOf === 'number' &&
      typeof level === 'number' &&
      typeof step === 'string' &&
      typeof action === 'string'
    ) {
      const entry = { possibleIn, necessaryAsOf, level, step, action };
      // Optional flags are tri-state: absent, true (requires) or false (excludes).
      for (const flag of ['ngUpgrade', 'material', 'pwa', 'angularCLI', 'windows']) {
        const value = readProperty(node, flag);
        if (typeof value === 'boolean') entry[flag] = value;
      }
      steps.push(entry);
    }
  }
  ts.forEachChild(node, visit);
};
visit(sourceFile);

if (steps.length < 100) throw new Error(`parsed only ${String(steps.length)} steps — parser broke`);

const payload = {
  provenance: {
    source: `https://github.com/${REPO}/blob/main/${PATH}`,
    raw: RAW,
    commit: commit[0]?.sha ?? 'unknown',
    committedISO: commit[0]?.commit?.committer?.date ?? 'unknown',
    retrievedISO: new Date().toISOString().slice(0, 10),
    note: 'Angular’s own update-guide data, vendored verbatim. Not authored here.',
  },
  steps,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);

const versions = [...new Set(steps.map((s) => s.necessaryAsOf))].sort((a, b) => a - b);
console.log(`wrote ${String(steps.length)} steps to src/data/angular-update-steps.json`);
console.log(`  commit ${payload.provenance.commit.slice(0, 10)} (${payload.provenance.committedISO})`);
console.log(`  covers v${String(versions[0] / 100)} .. v${String(versions.at(-1) / 100)}`);
