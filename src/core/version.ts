/**
 * Single source of truth for the Angular version these recipes were verified against.
 *
 * A version upgrade starts by changing this one line. See REVERIFICATION.md for the
 * full procedure; `npm run docs:audit` then lists every recipe that has fallen behind
 * along with the exact doc URLs to re-query.
 */
export const VERIFIED_ANGULAR_VERSION = 22;

/**
 * The docs host for a given major version. angular.dev always serves the current
 * release; older versions live on a `vN.` subdomain.
 *
 * Used by REVERIFICATION.md tooling and by the audit output, so that a maintainer
 * re-verifying on v23 can tell at a glance whether a recorded source URL points at
 * the current docs or an archived version.
 */
export function docsOrigin(version: number): string {
  return version === VERIFIED_ANGULAR_VERSION
    ? 'https://angular.dev'
    : `https://v${String(version)}.angular.dev`;
}
