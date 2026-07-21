/**
 * Verifies every angular.dev URL this server cites actually resolves to a real page.
 *
 * WHY THIS IS NOT A STATUS-CODE CHECK: angular.dev serves HTTP 200 for URLs that do not
 * exist. A request for /errors/NG8022 — a page that is absent from the sitemap — returns
 * 200 with `<title>Home • Angular</title>`. An earlier audit here "confirmed" a dozen
 * source URLs by their status codes and confirmed nothing at all.
 *
 * So the test is the <title>. A real page is titled after itself ("Validation • Angular");
 * the catch-all is titled "Home • Angular". A citation that lands on the catch-all is a
 * dead link dressed up as a live one, which is worse than no citation.
 *
 * Network-dependent, so this is a script rather than a vitest case: the unit suite must
 * stay offline and deterministic.
 *
 * Usage: npm run docs:links
 */
import { allRecipes } from '../dist/core/recipes.js';

const CATCH_ALL = /^home\b/i;
const TIMEOUT_MS = 25_000;

/** Every angular.dev URL we cite: provenance sources plus any URL quoted in a caveat. */
function citedUrls() {
  const found = new Map(); // url -> where it came from
  const note = (url, origin) => {
    const existing = found.get(url);
    if (existing === undefined) found.set(url, [origin]);
    else if (!existing.includes(origin)) existing.push(origin);
  };

  for (const recipe of allRecipes()) {
    for (const source of recipe.provenance.sources) note(source, `${recipe.construct} (source)`);
    for (const caveat of recipe.caveats) {
      for (const match of caveat.matchAll(/https:\/\/angular\.dev\/[^\s`."')\]]+/g)) {
        note(match[0], `${recipe.construct} (caveat)`);
      }
    }
  }
  // Extra URLs may be passed on the command line to check a citation before encoding it —
  // and to prove this script can still go red:
  //   npm run docs:links -- https://angular.dev/errors/NG8022
  for (const argument of process.argv.slice(2)) {
    if (argument.startsWith('https://angular.dev/')) note(argument, 'command line');
  }
  return found;
}

async function titleOf(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const html = await response.text();
    const match = /<title>([^<]*)<\/title>/i.exec(html);
    return { status: response.status, title: match?.[1]?.trim() ?? '' };
  } finally {
    clearTimeout(timer);
  }
}

const urls = citedUrls();
process.stderr.write(`checking ${String(urls.size)} cited angular.dev URLs\n\n`);

const dead = [];
for (const [url, origins] of [...urls].sort()) {
  let result;
  try {
    result = await titleOf(url);
  } catch (error) {
    dead.push({ url, origins, reason: error instanceof Error ? error.message : 'fetch failed' });
    process.stderr.write(`  UNREACHABLE  ${url}\n`);
    continue;
  }

  // The title is the real signal; the status is recorded only to show why it is not.
  const isCatchAll = CATCH_ALL.test(result.title);
  if (isCatchAll || result.title === '') {
    dead.push({
      url,
      origins,
      reason:
        `HTTP ${String(result.status)} but title "${result.title}" — this is the ` +
        'angular.dev catch-all, meaning the page does not exist',
    });
    process.stderr.write(`  DEAD         ${url}\n`);
  } else {
    process.stderr.write(
      `  ok           ${result.title.replace(/ • Angular$/, '').padEnd(34)} ${url}\n`,
    );
  }
}

if (dead.length > 0) {
  process.stderr.write(`\n${String(dead.length)} citation(s) do not resolve to a real page:\n\n`);
  for (const entry of dead) {
    process.stderr.write(
      `  ${entry.url}\n    ${entry.reason}\n    cited by: ${entry.origins.join(', ')}\n\n`,
    );
  }
  process.exit(1);
}

process.stderr.write(`\nall ${String(urls.size)} citations resolve to real pages.\n`);
