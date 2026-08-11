import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Every tracked `*.md`. Keep in sync with `git ls-files '*.md'`. */
const TRACKED_MARKDOWN = [
  'CLAUDE.md',
  'README.md',
  'REVERIFICATION.md',
  'ROADMAP.md',
  'SPEC.md',
] as const;

/**
 * The one document whose job is to RECORD retractions, so it necessarily quotes the claims
 * it disproves. Exempting it lets the patterns below be broad enough to catch a claim in any
 * phrasing — prose, table cell, or bullet — instead of being narrowed until they only match
 * the exact sentence that was found last time. The separate test at the bottom asserts this
 * file still carries the evidence, so the exemption cannot be used to quietly drop it.
 */
const RETRACTION_RECORD = 'CLAUDE.md';

/**
 * Claims this project asserted, then disproved against shipped source.
 *
 * The v21/v22 `required()` divergence never existed: `isEmpty` is byte-identical in
 * @angular/forms 21.0.0 and 22.0.7, so v21 rejected `false` exactly as v22 does. Only the
 * docs changed. CLAUDE.md rule 2 retracts it, and src/ and test/ were corrected — but the
 * prose was not, and shipped for two releases. shared-caveat-sources.test.ts guards recipe
 * caveats; this guards the documents, which are what reach npm and what govern future
 * sessions.
 *
 * Patterns are deliberately broad. The first version of this guard only matched the prose
 * sentence and silently passed the same claim written as a table row in REVERIFICATION.md —
 * a guard narrow enough to miss a rephrasing is barely a guard at all.
 */
const RETRACTED_CLAIMS: ReadonlyArray<{ readonly name: string; readonly pattern: RegExp }> = [
  {
    name: 'required() treats false differently on v21 vs v22 (prose form)',
    pattern:
      /as (?:missing|present) on \*{0,2}v2[12]\*{0,2},? but as (?:missing|present) on \*{0,2}v2[12]/i,
  },
  {
    name: 'v21 required() accepted/passed false (table or prose form)',
    pattern: /`?required\(\)`?[^\n]{0,80}\b(?:passes|accepts|accepted)\b/i,
  },
  {
    name: 'requiredTrue is version-sensitive',
    pattern:
      /requiredTrue`? (?:between|is) a (?:one-line |mechanical )?rename and a (?:judgment )?rewrite/i,
  },
];

function read(file: string): string {
  return readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
}

describe('no tracked document asserts a retracted claim', () => {
  it.each(TRACKED_MARKDOWN.filter((f) => f !== RETRACTION_RECORD))(
    '%s is free of retracted claims',
    (file) => {
      const text = read(file);
      for (const claim of RETRACTED_CLAIMS) {
        expect(claim.pattern.test(text), `${file} asserts: ${claim.name}`).toBe(false);
      }
    },
  );

  it('CLAUDE.md still records the source-level evidence for the retraction', () => {
    expect(read('CLAUDE.md')).toMatch(
      /byte-identical in\s+`?@angular\/forms`? 21\.0\.0 and 22\.0\.7/,
    );
  });
});
