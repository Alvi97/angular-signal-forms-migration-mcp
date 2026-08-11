# Implementation brief — M12 → M15

Ground rules that bind every section: the server **never writes to user source** (CLAUDE.md rule 1); core stays pure and unit-testable without the MCP runtime, `src/server.ts` only adapts (`src/core/types.ts:11-29` `Result`); no `console.log` (only `logToStderr`, `src/server.ts:71-73`); a behavioural claim about Angular cites shipped source, never the presence/absence of a doc sentence (CLAUDE.md rule 2).

Everything below was re-verified against the working tree at 0.6.0. Angular claims are against `verify/node_modules/@angular/forms` **22.0.7** (confirmed). SDK is `@modelcontextprotocol/sdk` **1.29.0**, zod **4.4.3**.

**Two live defects found while verifying, not in the research, that change the plan:**

1. **The prose says inline templates are not scanned. They are.** `collectInlineTemplates` ships (`src/core/detect.ts:274`, called at `:257`, M11 T2) but three prose sites still deny it: `src/server.ts:119-120` ("Inline templates in a .ts `template:` string and CSS/SCSS are NOT scanned"), `src/core/report.ts:297-299` (the zero-findings branch), `src/core/report.ts:449-450` (Scope section). `grep` over `test/` finds **no** test asserting either way. This is exactly M14's target class — fix it in M14, not opportunistically.
2. **`USAGE` omits a shipped tool.** `src/server.ts:364-365` lists four tools; `get_angular_upgrade_plan` is registered at `:268` and missing from the list. M13 adds a sixth tool, so fix the list once, in M14, with a test.

---

## M12 — report scale and agent ergonomics

Three independent wins, descending value: **dedupe** (lossless), **paginate + filter** (lossy, so it must announce itself), **stop double-emitting** (free). Ship in that order — dedupe alone takes the report from 385 KB to ~43 KB on the 60-component fixture, and pagination without dedupe still spends ~66% of every page re-stating 20-odd sentences.

### File-by-file

**`src/core/report.ts`** — replace the per-file judgment listing with per-decision grouping.

Delete `MAX_LISTED_JUDGMENTS` (`:13-14`) and `judgmentLines` (`:68-82`). The current call site (`:429-441`) walks `complexity.suggestedOrder` and emits one full `reason` per finding; on the fixture that is 1,296 findings printing 28 distinct `(construct, reason)` pairs, 364,296 of the report's 385,302 bytes (94.5%).

Key on the **pair**, not on `construct` alone — `Template.nativeAttribute` legitimately has three reasons because the reason names the attribute (`required`/`minlength`/`maxlength`); grouping on construct would silently drop two of three.

```ts
/** Sites listed per decision before the remainder is counted rather than printed. */
const MAX_LISTED_SITES = 20;

interface JudgmentGroup {
  readonly construct: string;
  readonly reason: string;
  readonly sites: { readonly file: string; readonly line: number }[];
}

function groupJudgments(
  byPath: ReadonlyMap<string, FileFindings>,
  order: readonly string[],
): JudgmentGroup[] {
  const groups = new Map<string, JudgmentGroup>();
  // Walk in suggested order so each site list reads in migration sequence.
  for (const file of order) {
    const entry = byPath.get(file);
    if (entry === undefined) continue;
    for (const finding of entry.findings) {
      if (finding.classification !== 'judgment') continue;
      const key = `${finding.construct}\u0000${finding.reason}`;
      let group = groups.get(key);
      if (group === undefined) {
        group = { construct: finding.construct, reason: finding.reason, sites: [] };
        groups.set(key, group);
      }
      group.sites.push({ file, line: finding.line });
    }
  }
  return [...groups.values()].sort(
    (a, b) => b.sites.length - a.sites.length || a.construct.localeCompare(b.construct),
  );
}

function judgmentSection(groups: readonly JudgmentGroup[], root: string): string[] {
  if (groups.length === 0) return [];
  const total = groups.reduce((sum, group) => sum + group.sites.length, 0);
  const lines = ['## Judgment calls', ''];
  lines.push(
    `${String(total)} judgment finding(s), but only ${String(groups.length)} distinct ` +
      'decision(s) — the reason is stated once per decision and every site needing it is ' +
      'listed under it. Decide the shape once, then apply it at each site.',
  );
  lines.push('');
  for (const group of groups) {
    lines.push(`### \`${group.construct}\` — ${String(group.sites.length)} site(s)`);
    lines.push('');
    lines.push(group.reason);
    lines.push('');
    for (const site of group.sites.slice(0, MAX_LISTED_SITES)) {
      lines.push(`- \`${shortPath(site.file, root)}:${String(site.line)}\``);
    }
    const hidden = group.sites.length - MAX_LISTED_SITES;
    if (hidden > 0) {
      // Never a bare cut: state the residual AND the exact call that returns it.
      lines.push(
        `- …and ${String(hidden)} more site(s) with this same reason — get them with ` +
          `\`find_form_candidates { "path": "<this path>", "constructs": ["${group.construct}"], ` +
          '"classification": "judgment" }`.',
      );
    }
    lines.push('');
  }
  return lines;
}
```

Call site (`report.ts:429-441`, heading lines 430-433 go away with it):

```ts
  if (complexity.judgmentCount > 0) {
    lines.push(...judgmentSection(groupJudgments(byPath, complexity.suggestedOrder), root));
  }
```

The bug section (`report.ts:281-285`) has the same shape and is left alone: 0 occurrences of `deadValidatorOption` in the fixture, so it has not earned the complexity.

**`src/core/paginate.ts`** (new) — the window belongs in core, per "pure core, thin shell".

```ts
export function pageFindings(
  files: readonly FileFindings[],
  options: PageOptions,
): { files: PagedFileFindings[]; page: PageInfo; reasons: Record<string, string> };
```

Window over **findings**, not files: paginating by file bounds nothing — one 400-finding component blows any file-based page. A file may come back partial, and says so via `matchedInFile` + `partial`.

**`src/core/types.ts`** — new schemas. Define `pagedFindingSchema` / `pagedFileFindingsSchema` **alongside** `fileFindingsSchema` (`:164-169`), do not mutate it: that is the detector's own output type, consumed by `detect.ts`, `complexity.ts` and `report.ts`, and it should stay a complete record. The `reasonId` projection is an adapter concern.

```ts
export const pagedFindingSchema = findingSchema.omit({ reason: true }).extend({
  /** Key into the response's `reasons` map. The reason is identical at every site sharing it. */
  reasonId: z.string(),
});

export const pagedFileFindingsSchema = z.object({
  file: z.string(),
  findings: z.array(pagedFindingSchema),
  /** Findings in this file matching the filters, BEFORE the page window. */
  matchedInFile: z.number().int().nonnegative(),
  /** True when `findings` is a slice of this file rather than all of it. */
  partial: z.boolean(),
});

/** Pagination state. Present whether or not anything was cut, so its absence never means "complete". */
export const pageInfoSchema = z.object({
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  returned: z.number().int().nonnegative(),
  /** Matching the filters across the whole scan, ignoring the window. */
  totalMatched: z.number().int().nonnegative(),
  /** Before ANY filter — so a narrow filter can't read as the whole picture. */
  totalUnfiltered: z.number().int().nonnegative(),
  truncated: z.boolean(),
  nextOffset: z.number().int().nonnegative().nullable(),
});

export const findFormCandidatesOutputSchema = z.object({
  /**
   * FIRST KEY DELIBERATELY. Non-null means the list below is INCOMPLETE. An agent that reads
   * only the head of a long payload still sees it; a trailing boolean would not survive that.
   */
  incomplete: z.string().nullable(),
  page: pageInfoSchema,
  /** Echoed back so a filtered result can never be mistaken for an unfiltered one. */
  filters: z.object({
    constructs: z.array(z.string()).nullable(),
    classification: classificationSchema.nullable(),
  }),
  files: z.array(pagedFileFindingsSchema),
  reasons: z.record(z.string(), z.string()),
  /** Unchanged meaning: every finding in the scan, unfiltered. */
  totalFindings: z.number().int().nonnegative(),
});
```

Inputs (`findFormCandidatesInputSchema` is at `types.ts:249-254`): add `limit` (int, positive, max 2000, `.default(200)`), `offset` (`.default(0)`), `constructs` (`z.array(z.string().min(1)).min(1).optional()`), `classification` (`classificationSchema.optional()`, `classificationSchema` is at `:125`). `analyzeMigrationComplexityInputSchema` (`:294-299`) gets `limit`/`offset` over `suggestedOrder` only — **no** `constructs` there, because `byConstruct` is the aggregate and filtering it makes the totals lie. `getMigrationReportInputSchema` (`:302-307`) gets `constructs` only; markdown does not paginate usefully and the grouping fix removes the volume problem. `getSignalFormsRecipeInputSchema` unchanged (11 KB, fixed).

Put `incompleteNotice` in **core**, not the adapter, so it is testable without the runtime:

```ts
export function incompleteNotice(page: PageInfo, filtered: boolean): string | null {
  if (!page.truncated && !filtered) return null;
  const parts: string[] = [];
  if (page.truncated) {
    parts.push(
      `INCOMPLETE RESULT — findings ${String(page.offset + 1)}-${String(page.offset + page.returned)} ` +
        `of ${String(page.totalMatched)}. This is NOT the full set of edit sites: do not report ` +
        `the migration complete from it, and do not conclude a construct is absent. Next page: ` +
        `{ "offset": ${String(page.nextOffset ?? 0)} }.`,
    );
  }
  if (filtered) {
    parts.push(
      `FILTERED — ${String(page.totalMatched)} of ${String(page.totalUnfiltered)} findings in ` +
        'this scan match the constructs/classification you asked for. The rest still exist.',
    );
  }
  return parts.join(' ');
}
```

**`src/server.ts`** — the double emission.

`jsonResult` (`:75-80`) emits the identical payload twice; `get_migration_report` (`:260-265`) and `get_angular_upgrade_plan` (`:331-334`) open-code the same thing by hand. Measured on real stdio frames: `get_migration_report` at 776,069 bytes = 385,302 text + 387,995 structured. Exactly 2×.

Direction is forced by the spec, and it goes the way that keeps `content`: the 2025-06-18 tools spec says *"a tool that returns structured content SHOULD also return the serialized JSON in a TextContent block."* There is no reciprocal SHOULD protecting `structuredContent`. So emitting `content` only, with no `outputSchema`, is fully conformant; emitting `structuredContent` with `content: []` violates that SHOULD. Nothing in the SDK forces both — `content` is `z.array(ContentBlockSchema).default([])`, commented "this field is always present, but it may be empty" (`node_modules/@modelcontextprotocol/sdk/dist/esm/types.js:1291-1296`), and `validateToolOutput` demands `structuredContent` **only** when an `outputSchema` is set (`dist/esm/server/mcp.js:189-197`).

- `get_migration_report` / `get_angular_upgrade_plan`: delete `outputSchema:` (`server.ts:242`, `:280`), return `{ content: [{ type: 'text', text: markdown }] }` only. Delete `getMigrationReportOutputSchema` (`types.ts:310-314`), `getAngularUpgradePlanOutputSchema` (`types.ts:387-390`) and the now-false comment at `types.ts:310`. Those schemas are `{ markdown: string }` — a contract carrying zero information a caller can act on.
- The three JSON tools keep both channels; `outputSchema` there is a real contract. Drop the pretty-printer instead (measured −20% on the text half, 1,670,811 → 1,337,658):

```ts
function jsonResult<T extends Record<string, unknown>>(payload: T, notice?: string): CallToolResult {
  // The notice goes FIRST so an agent that reads only the head of a long blob still sees it.
  const json = JSON.stringify(payload);
  return {
    content: [{ type: 'text', text: notice === undefined ? json : `${notice}\n\n${json}` }],
    structuredContent: payload,
  };
}
```

The `T extends Record<string, unknown>` constraint also removes the unchecked `payload as Record<string, unknown>` cast at `:78`.

### Order (TDD)

1. `test/report.test.ts` — grouped judgment section. Assert: every distinct `(construct, reason)` pair present appears exactly once; `Σ group.sites.length === complexity.judgmentCount`; the residual line **is emitted whenever `sites.length > MAX_LISTED_SITES`** and names the retrieving call. Watch fail → implement `groupJudgments` + `judgmentSection`.
2. `test/paginate.test.ts` (new) — pure core, no MCP. Two properties: (a) `incomplete === null` **iff** `returned === totalMatched && totalMatched === totalUnfiltered`; (b) concatenating every page at a given limit reproduces the unpaginated finding list exactly, in order. That second one is what makes `nextOffset` trustworthy. Watch fail → implement `pageFindings` + `incompleteNotice`.
3. Types + server wiring. Update `test/report-consistency.test.ts` (`:162-187` asserts recipe naming per construct; `:155-158` sums the per-file findings column) — those will churn.
4. Double emission last: it is the smallest diff and the one most likely to need a real-client check.

### Verify at build time, do not trust this brief

- **zod v4 `.default()` through `registerTool(..., { inputSchema: schema.shape })`.** Unproven end to end. Confirm (a) the default survives into the advertised JSON Schema in `tools/list`, and (b) a `tools/call` that **omits** `limit` parses to `200` rather than `undefined` or an error. Probe over stdio. `exactOptionalPropertyTypes` bites here: `.default()` makes the inferred output non-optional, `.optional()` does not, and the handler destructure must match.
- **`T extends Record<string, unknown>` actually accepts the three payloads.** `z.infer` produces type *aliases* (implicit index signature) so it should hold, but `GetSignalFormsRecipeOutput` has optional members under `exactOptionalPropertyTypes` — compile it, don't assume.
- **A real client still sees the output** after `structuredContent` is dropped from the two markdown tools. The recommendation rests on one spec sentence, not on an observation of Claude Code. If any client renders only `structuredContent`, the whole direction inverts.
- **Re-measure the ratios on a real Angular repo.** The 16.9× report reduction comes from 60 *identical* generated components (3,655 findings, 57 distinct reasons) and is an **upper bound**. The 3-component run (17,629 → 8,052, 2.2×) is the honest lower bound. Do not quote 16.9× anywhere user-facing.

### Stated plainly

- The `reasons` legend + `page` envelope is a **breaking** change to `findFormCandidatesOutputSchema` on a package published at 0.6.0. Needs a version bump, a README/SPEC note, and ROADMAP.md:210 moved from deferred to shipped. If breaking is unacceptable this milestone, ship report grouping + pagination and defer the legend — but say so in ROADMAP rather than silently dropping it.
- **Rejected, with the measurement:** root-relative file paths. Absolute paths are 22,087 of 34,885 bytes (63%) of the complexity payload, and relativising measures 22,087 → 4,307. Rejected anyway: the number is inflated by a ~140-char scratchpad root, and absolute paths are what the calling agent feeds straight into Read/Edit. `shortPath` (`report.ts:47-49`) already does this at the display layer, which is the right place.
- `MAX_LISTED_SITES = 20` **is** truncation. It only stays honest because the residual line is mandatory — hence the test in step 1.
- `SERVER_INSTRUCTIONS` (`server.ts:90-130`) tells agents to migrate in suggested order; the grouped section is ordered by frequency instead. Add one sentence saying site lists within a decision follow the suggested order. Note `test/instructions.test.ts:26` caps the whole block at 2500 chars.

---

## M13 — `verify_migration`

Post-migration defect detection. **Eight checks ship, one is rejected outright, one is refused without a `before` tree.** The organising principle: only check what *compiles and is still wrong*. Anything `tsc` already reports is noise.

### The rejection, stated first

**Do not ship a general `f.invalid()` / `f.email.value()` check.** `FieldTree<TModel>` is `(() => …FieldState…) & (… Subfields<TModel> …)` (`verify/node_modules/@angular/forms/types/_structure-chunk.d.ts:208`), and `Subfields` maps only the model's keys (`:224-228`). A state member accessed straight off the tree does not exist: `TS2339`. The build already says it.

The **one** silent variant: a model key colliding with a `FieldState` member name (`interface M { value: string; invalid: boolean }` → `f.invalid` resolves to the child `FieldTree<boolean>`, always truthy, zero diagnostics). Ship that only if the model interface is in the same file, and measure it on the 50-repo corpus first — if it never fires, put the rejection in `disclaimer` and build nothing.

### Checks that ship

| check | severity | why the compiler misses it | evidence |
|---|---|---|---|
| `signalNotCalled` | error | `f().invalid` is a `Signal<boolean>`; TS2774 fires in *some* positions only | `_structure-chunk.d.ts:265-418` |
| `deprecatedLogicShape` | warning | v22 keeps the bare-callback overload as `@deprecated`, so it compiles | `types/signals.d.ts:32-40` |
| `preReleaseApiName` | error | `import { Field }` compiles (it is still a type alias); fails only at AOT | `_structure-chunk.d.ts:192`, `:1307` |
| `staleErrorKey` | error | `ValidationError.kind` is `string`, not a union | `_structure-chunk.d.ts:1556-1561`, `:471-474` |
| `schemaConstructionTimeRead` | warning | schema fn runs once, outside any reactive context | `fesm2022/_validation_errors-chunk.mjs:514-528` |
| `nativeAttributeCollision` | error | AOT-only (NG8022) | `src/core/detect-template.ts:180-219` (before-state twin) |
| `orphanFieldRisk` | warning | destructuring the tree typechecks | `_validation_errors-chunk.mjs:1121`, `:1123` |
| `controlInSignalFormModel` | error | `FieldTree` has an `AbstractControl` branch, so it typechecks | `_validation_errors-chunk.mjs:884` |
| `leftoverReactiveForms` / `reactiveFormsModuleImport` | error / info | not a type error at all | `package.json` exports; `types/signals-compat.d.ts:252` |

**`signalNotCalled` — where TS2774 slips.** Compiled one statement per line against 22.0.7:

```ts
if (f().invalid) …                    // TS2774  caught
if (!f().invalid) …                   // NO ERROR  <-- slips
if (f().touched() && f().invalid) …   // TS2774  caught
f().invalid ? 1 : 0                   // TS2774  caught
while (f().invalid) …                 // NO ERROR  <-- slips
!!f().invalid                         // NO ERROR  <-- slips
f().invalid || false                  // NO ERROR  <-- slips
const v = f().invalid; if (v) …       // TS2774  caught
```

Also uncaught: template-literal interpolation, `JSON.stringify`, passing to an `unknown`/generic parameter, and `{{ f().invalid }}` in a template. Assignment to a declared `boolean` **is** caught (TS2322).

Detection: a `PropertyAccessExpression` whose expression is a `CallExpression`, whose name is in `FIELD_STATE_SIGNALS`, and whose parent is not a `CallExpression` with it as callee.

```ts
const FIELD_STATE_SIGNALS = new Set([
  'value','controlValue','disabled','max','maxLength','min','minLength','name','pattern',
  'readonly','required','touched','dirty','hidden','disabledReasons','errors','errorSummary',
  'valid','invalid','pending','submitting','keyInParent','formFieldBindings',
]);
const SIGNAL_OK_SUFFIX = new Set(['set','update','asReadonly']); // f.email().value.set(v) is correct
```

Four guards, all load-bearing: allow `.set`/`.update`/`.asReadonly` after `value`/`controlValue`; allow the whole expression as an argument to `computed`/`effect`/`toObservable`/`linkedSignal`; only run in files importing `@angular/forms/signals`; require the receiver root to be bound to `form(`/`compatForm(` via the existing name-binding pass.

**`deprecatedLogicShape`.** v22 declares both shapes; the bare one is deprecated, not removed:

```ts
declare function disabled<…>(path, config?: { when?: string | LogicFn<…> }): void;
/** @deprecated Passing a function or string directly to `disabled` is deprecated. Use `{ when: ... }` instead. */
declare function disabled<…>(path, logic?: string | LogicFn<…>): void;
```

(`types/signals.d.ts:32-40`; `hidden` at `:66-74`.) v21.0.0's `signals.d.ts:316` has **only** the bare declaration — so SPEC.md rule 6's version claim is confirmed from shipped source, as rule 2 requires. Skip when `arguments[1]` is an `Identifier` or `ObjectLiteralExpression`: an identifier cannot be judged without types, and refusing beats guessing.

**`preReleaseApiName` — the premise in the research corrects a project belief.** `[field]` is **not** a hallucination. It shipped:

| package | class | selector | token |
|---|---|---|---|
| 21.0.0 | `Field` | `"[field]"` | `FIELD` |
| 21.2.19 | `FormField` | `"[formField]"` | `FORM_FIELD` |
| 22.0.7 | `FormField` | `"[formField]"` | `FORM_FIELD` |

Confirmed for 22.0.7 at `_structure-chunk.d.ts:1307`. `Control` / `[control]` appears in **none** of the three — and yet v22's own JSDoc still prints `<input id="email" type="email" [control]="email" />` at `types/signals.d.ts:50`, the only `[control]` occurrence in the whole v22 type surface and a plausible contamination source for the "no Control export" warning already in `SERVER_INSTRUCTIONS` (`server.ts:127-130`). The message must not claim `[field]` was never real.

**`leftoverReactiveForms` must be gated on the compat entry point** or it flags the documented migration path. The package exports `.`, `./signals`, `./signals/compat` (confirmed from `verify/node_modules/@angular/forms/package.json`), `SignalFormControl extends AbstractControl` (`types/signals-compat.d.ts:252`), and `compatForm` overloads at `:52`, `:87`, `:121`. Run the check only when the file imports `@angular/forms/signals` **and not** `@angular/forms/signals/compat`, and names neither `compatForm` nor `SignalFormControl`. When compat *is* present, emit one `info`: "Interop file — Reactive Forms constructs here are expected while the compat layer is in use."

**`schemaConstructionTimeRead`.** `SchemaImpl.compile()` memoises and invokes `this.schemaFn(path.fieldPathProxy)` in a plain try/finally — no `computed`, no `effect` (`fesm2022/_validation_errors-chunk.mjs:514-528`). So `form(m, (p) => { if (isAdmin()) required(p.ssn); })` bakes the value in permanently and compiles clean. Detect a zero-argument `CallExpression` whose **immediately enclosing function is the schema callback itself** (not a nested arrow) — that exclusion is what keeps `validate(p.x, ({ stateOf }) => stateOf(p.y).touched())` out of the results, which matters because M15's cross-field recipe uses exactly that shape. Severity `warning`, and the message must say the tool cannot tell a signal read from a plain method call.

**Adjudication between researchers — `orphanFieldRisk`.** The M13 pass proposes flagging **only** array-item field references (NG01904). The M15 FormRecord pass *executed* the record case and observed **NG01902** ("Orphan field, looking for property 'carol' of \<root\>") after `delete`-ing a record key. Both throw from the same `keyInParent` computed (`_validation_errors-chunk.mjs:1121` and `:1123`). The shipped source settles it: widen the rule to a held field reached by **an index into an array-valued field OR a dynamic key into a `Record`-typed field**, and keep fixed-shape object keys out (a fixed key never leaves the model, and flagging every `const { email } = f` is pure noise). Do not flag `@for` template locals — `@for (field of form.emails; track field)` is the documented idiom.

**Bonus check, source-verified:** `form(signal({ first: '', last: new FormControl('') }))` typechecks (the `[TModel] extends [AbstractControl]` branch of `FieldTree`, `_structure-chunk.d.ts:208`) and throws at the first rule that reads the value — `RuntimeError 1907: "Tried to read an 'AbstractControl' value from a 'form()'. Did you mean to use 'compatForm()' instead?"` (`_validation_errors-chunk.mjs:884`). Statically decidable within one file.

### The refusal

**`droppedConstraint` is not decidable from the after-state.** The M9 case — a template carried `minlength="8"` as the only statement of the constraint, the agent deleted it to avoid NG8022, added no schema rule — leaves a field with no rule, indistinguishable from the thousands of fields that legitimately have none. Do not ship a heuristic.

What *is* sound is differential, and it stays read-only: an optional `before` input naming a pre-migration copy (a git worktree, `git archive`). Restrict pairing to same-named paths and emit an `info` "could not pair" rather than inventing a match. When `before` is absent the output **must** carry:

```ts
checksSkipped: [{ check: 'droppedConstraint', reason:
  'Requires a pre-migration copy; pass `before`. A dropped constraint leaves no trace in ' +
  'the migrated file, so this cannot be inferred.' }]
```

Silence would read as a pass. Do not describe the tool as a diff-and-fix tool; it reads two trees and writes neither.

### Schemas (`src/core/types.ts`)

`severity` is deliberately a **new** vocabulary, not `mechanical | judgment` — that pair grades migration *work*, and grading a defect "mechanical" is a category error.

```ts
export const VERIFY_CHECKS = [
  'leftoverReactiveForms', 'reactiveFormsModuleImport', 'signalNotCalled',
  'deprecatedLogicShape', 'preReleaseApiName', 'staleErrorKey',
  'schemaConstructionTimeRead', 'nativeAttributeCollision', 'orphanFieldRisk',
  'controlInSignalFormModel', 'droppedConstraint',
] as const;
export const verifyCheckSchema = z.enum(VERIFY_CHECKS);

/** `error`: will not build, or is a silent runtime defect. `warning`: compiles and may be
 *  wrong; the tool cannot decide without types. `info`: expected in this file's mode. */
export const verifySeveritySchema = z.enum(['error', 'warning', 'info']);

export const verifyFindingSchema = z.object({
  check: verifyCheckSchema,
  severity: verifySeveritySchema,
  line: z.number().int().positive(),
  snippet: z.string(),
  message: z.string(),
  /** What backs the claim: shipped `file:line`, a doc URL, or 'runtime-only'. Never empty. */
  evidence: z.string().min(1),
});

export const verifyMigrationOutputSchema = z.object({
  files: z.array(verifiedFileSchema),
  errorCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  infoCount: z.number().int().nonnegative(),
  notMigratedFiles: z.array(z.string()),
  checksRun: z.array(verifyCheckSchema),
  /** Non-empty whenever a check could not run; silence must never read as a pass. */
  checksSkipped: z.array(skippedCheckSchema),
  angularVersion: z.string().nullable(),
  /** Always present. This tool proves the ABSENCE OF KNOWN DEFECTS, not correctness. */
  disclaimer: z.string(),
});
```

Core signature, matching `findFormCandidates` (`detect.ts`, `FileSystemPort` at `:22-31`):

```ts
export function verifyMigration(
  rootPath: string,
  fileSystem: FileSystemPort,
  options: VerifyMigrationOptions,
): Result<VerifyMigrationOutput>
```

Server registration mirrors the five existing tools including `annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }` (`server.ts:148`, `:173`, `:208`, `:243`, `:281`).

### Order (TDD)

1. Types + a `verifyMigration` that returns `ok` with zero findings and a populated `checksSkipped`. Register the tool. This gets the shell and the disclaimer landed before any check exists.
2. Then one check per commit, cheapest and highest-confidence first: `preReleaseApiName` → `staleErrorKey` → `deprecatedLogicShape` → `reactiveFormsModuleImport` → `leftoverReactiveForms` (with the compat gate) → `nativeAttributeCollision` (reuses `MIRRORED_ATTRS`, `detect-template.ts:180-219`) → `controlInSignalFormModel` → `signalNotCalled` → `orphanFieldRisk` → `schemaConstructionTimeRead` (last: highest false-positive rate).
3. Each check: a fixture that *should* fire, a fixture that must **not** (the compat-interop file, the `f.email().value.set(v)` write path, the `computed(() => f().invalid)` pass-through), then implement.
4. **`test/verify-recipes-clean.test.ts`** — for every recipe whose `after` contains `from '@angular/forms/signals'`, `verifyMigration` must report zero `error`-severity findings. This is the cheapest possible guard against both a false-positive check and a stale recipe, and it will immediately catch the `schemaConstructionTimeRead` nesting rule if it is wrong.

### Verify at build time

- **Template type-checking is UNVERIFIED.** `verify/node_modules` has only `@angular/{common,core,forms,platform-browser}` — no `@angular/compiler-cli`, so `ngtsc` never ran. Every TS2774/TS2339 result above is plain `tsc` on `.ts` files. Whether `strictTemplates` reports the same inside a template expression is **unknown**, and it decides whether the template half of `signalNotCalled` is signal or noise. Add `@angular/compiler-cli` to `verify/` and compile a fixture component.
- The exact v21 release where `Field`→`FormField` landed is **unknown**. Two tarballs were compared (21.0.0, 21.2.19); the intervening patches were not bisected. State it as "present in 21.0.0, gone by 21.2.19", never as a specific release.
- `SERVER_INSTRUCTIONS` is capped at 2500 chars by `test/instructions.test.ts:26`. Adding `verify_migration` guidance will press against it; budget the edit.
- `USAGE` (`server.ts:364-365`) already omits `get_angular_upgrade_plan`. Adding a sixth tool without fixing that ships a list wrong by two.

### Inherited limits — restate, do not re-derive

`leftoverReactiveForms` reuses `detectInSource` and inherits the import gate (ROADMAP.md:117-120): a file importing only `@angular/forms/signals` that reaches Reactive Forms through a service is not scanned. That is the intended precision trade-off, so `leftoverReactiveForms` cannot claim completeness. Same for the no-`ts.Program` receiver binding (ROADMAP.md:121-136).

---

## M14 — tests for the prose layer

`src/core/upgrade-report.ts` is 274 lines of user-facing text with **zero** tests (`grep -rhoE "from '\.\./src/[^']+'" test | sort -u` — no test imports it, `src/infra/node-fs.ts`, or `src/cli/docs-audit.ts`). `src/server.ts` has only `SERVER_NAME`, `SERVER_VERSION`, `resolveCliAction` under test.

### Prerequisite: the entrypoint guard

`main()` runs unconditionally at module scope (`src/server.ts:393-396`). Reproduced: `npx vitest run test/server-identity.test.ts` prints `[angular-signal-forms-migration-mcp] v0.6.0 ready on stdio` — the test process really does hand vitest's stdio to a `StdioServerTransport` and fire `checkForUpdate` (`src/infra/update-notifier.ts`), which does a live fetch and writes a cache into `os.tmpdir()`. No handler is testable until this changes.

```ts
/**
 * True only when this module IS the process entrypoint. Importing it (tests) must not start
 * a transport or fire the update check.
 *
 * Compares realpaths on both sides: npm installs the bin as a symlink, so argv[1] is
 * node_modules/.bin/angular-signal-forms-migration-mcp while import.meta.url is dist/server.js.
 * A plain URL comparison is false there and the published server would never start.
 */
function isEntrypoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  main().catch((cause: unknown) => {
    logToStderr(`fatal: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exit(1);
  });
}
```

Add `realpathSync` to the existing `node:fs` import (`server.ts:7`); `fileURLToPath` is already imported (`:8`). `main` is a hoisted declaration so the `if` stays at the bottom. **Realpath is mandatory, not defensive**: measured on node 24, symlink invocation gives naive `false` / realpathed `true`. A guard that gets this wrong makes the published server start-but-do-nothing, which is worse than the current unconditional start.

### Two defects the tests must be written against

**1. The `windows` bullet claims the user answered when nothing was asked.** `src/server.ts:309` defaults `windows: windows ?? false`, and `inferredOptions` (`:320-323`) is built from `material`/`ngUpgrade` only — so `windows` can never be marked inferred and always falls through to `'you answered'` at `upgrade-report.ts:212`. Rendered on a v8→v9 plan with no `windows` argument: `` - `windows` — **no** (you answered), so 4 step(s) were EXCLUDED. `` Adding `windows` to `inferredOptions` is **not** the fix — it would then claim "detected from package.json", and package.json says nothing about anyone's OS. A third attribution is needed:

```ts
export type AnswerSource = 'answered' | 'inferred' | 'default';
const SOURCE_TEXT: Readonly<Record<AnswerSource, string>> = {
  answered: 'you answered',
  inferred: 'detected from package.json',
  default: 'not asked — assumed no',
};
const said = SOURCE_TEXT[sources[option] ?? 'answered'];
```

Carry `sources` on `UpgradeReportContext` (`upgrade-report.ts:107-111`), **not** as a sixth positional argument — the positional list is already five long (`:113-120`) and that is how this confusion arose. Related, weaker: when `findAngularManifest` returns `undefined`, `inferUpgradeOptions(undefined)` yields `material: false` and the report still says "detected from package.json" — detection that never happened.

**2. A companion group prints one package's range as the group's.** `upgrade-report.ts:45` reads `group.ranges[group.names[0] ?? '']` — the alphabetically first name — and `:47-49` labels it as the whole group's. For `nx@19.8.0, @nx/angular@19.8.4, @nx/js@18.0.0, @nx/devkit@19.8.4, @nx/eslint@19.8.4, @nx/workspace@19.8.4`:

```
- `@nx/angular`, `@nx/devkit`, `@nx/eslint`, `@nx/js` +2 more (6 packages, 19.8.4)
```

`@nx/js` is a whole major behind and is named under a range it does not have. Fix, no new data:

```ts
const ranges = new Set(group.names.map((n) => group.ranges[n]));
const rangeText =
  ranges.size === 1 ? [...ranges][0] : `${String(ranges.size)} different versions installed`;
```

**3. Cosmetic but exactly-assertable:** `buildUpgradeReport(buildUpgradePlan(22, 22, ADVANCED), false)` returns `"…already satisfies the target. "` — a trailing space from concatenating `''` at `:127-134`. Only an exact-equality assertion catches it; `toContain` never would.

**4. Dead branch.** `upgrade-report.ts:220` is reachable only when `applicable > 0 && includedByAnswer === 0 && excludedByAnswer === 0`, and brute-forcing every plan the vendored data admits (from 4..21 × to × 3 levels × 8 option combos, ≈8,200 plans) never hits it. Its text would also be self-contradictory if it fired. Either delete it, or keep it and add the brute force as a **guard test** so a `npm run data:update-steps` refresh that makes it reachable fails loudly. Same brute force establishes that no plan with `fromMajor < toMajor` has `total === 0`, so "Nothing to do" can never fire while the user is genuinely below target.

### `test/upgrade-report.test.ts`

Fixtures from two sources: real plans via `buildUpgradePlan` (19→22 multi-hop, 21→22 single-hop, 8→9 for the windows era, 16→18 for a non-default target) so the tests stay coupled to Angular's actual vendored data; plus **one** hand-built `UpgradePlan` literal for states the data cannot produce (`majorSteps: []` with `total > 0`; an out-of-range `level` for the `LEVEL_NAMES[plan.level] ?? String(plan.level)` fallback at `:122`, which is unreachable from a valid plan since `ApplicationComplexity` is `1|2|3`, `types.ts:321`).

Three parsers keep assertions structural:

```ts
/** `19 → 20: \`cmd\`` lines, in order. */
function hops(markdown: string): Array<{ from: number; to: number; command: string }> {
  return [...markdown.matchAll(/^(\d+) → (\d+): (.+)$/gm)].map((m) => ({
    from: Number(m[1]), to: Number(m[2]), command: m[3] ?? '',
  }));
}

/** Each `## → vN (K steps)` hop with its declared count and the `### ` titles under it. */
function hopSections(markdown: string): Array<{ major: number; declared: number; titles: string[] }> {
  const out: Array<{ major: number; declared: number; titles: string[] }> = [];
  for (const line of markdown.split('\n')) {
    const head = /^## → v(\d+) \((\d+) steps\)$/.exec(line);
    if (head) { out.push({ major: Number(head[1]), declared: Number(head[2]), titles: [] }); continue; }
    if (line.startsWith('## ')) { if (out.length > 0) out.push({ major: -1, declared: -1, titles: [] }); continue; }
    if (line.startsWith('### ')) out.at(-1)?.titles.push(line.slice(4));
  }
  return out.filter((s) => s.major !== -1);
}

function answerBullet(markdown: string, option: string): string {
  const line = markdown.split('\n').find((l) => l.startsWith(`- \`${option}\``));
  if (line === undefined) throw new Error(`no bullet for ${option}`);
  return line;
}
```

Assertions, none presence-only:

1. **Commands — the thing a user pastes.** `expect(hops(md).map(h => [h.from, h.to])).toEqual([[19,20],[20,21],[21,22]])`, then per hop `` expect(h.command).toBe(`\`npx @angular/cli@${h.to} update @angular/core@${h.to} @angular/cli@${h.to}\``) `` — every major equals the hop's **target** (`upgrade-report.ts:177-178`). An off-by-one using `previous` survives any `toContain('npx @angular/cli')`.
2. **Nx driver** (`:172-176`): each command `toContain('nx migrate')`, plus the negative that carries the risk — `expect(md).not.toMatch(/npx @angular\/cli@\d+ update/)`. An Nx workspace told to run `ng update` gets a broken migration.
3. **Single hop**: heading is `## The upgrade command` (`:157`), `hops(md)` length 1, `not.toContain('Upgrade one major at a time')`.
4. **Answer bullets agree with `plan.optionImpact`**, then with the world: `const n = Number(/(\d+) step\(s\) were EXCLUDED/.exec(answerBullet(md,'material'))![1]); expect(n).toBe(withMaterial.total - withoutMaterial.total)`.
5. **Attribution** (post-fix): material omitted → `'detected from package.json'`; material passed → `'you answered'`; windows omitted → **neither**, asserted on the 8→9 plan where the bullet is non-trivial.
6. **Step accounting**: `expect((md.match(/^### /gm) ?? []).length).toBe(plan.total)`; per hop `expect(s.titles).toEqual(plan.byMajor.find(g => g.major === s.major)!.steps.map(x => x.step))` — order included, so a regrouping regression fails; one `**Gate:**` line per hop (`:252`).
7. **`total === 0`**: full-string `toBe` for both `signalFormsGoal` values.
8. **Peers** (`:61-105`): `peers: undefined` → no 'Third-party' heading (silence, never a false all-clear); `inspected: 0` → the refusal section *and* `expect(section).not.toMatch(/compatible|no blockers|all clear/i)`; blocking present → every name and its `peerRange` rendered, heading names `plan.toMajor` — assert on a 16→18 plan so a hardcoded 22 fails.
9. **Companions** (`:23-55`): `[]` → no heading; the 6-package Nx group → `shown.length + extra === 6`, and post-fix no single range stated when ranges differ; category headings in `external, build-tooling, release-train` order, at most once each.
10. **Provenance** (`:266-271`): extract the backticked commit, `expect(plan.provenance.commit.startsWith(shown) && shown.length === 10)`.
11. **Hygiene sweep over ~12 plans**: no `'undefined'`, `'NaN'`, `'[object Object]'`, `'null'`; no trailing whitespace on any line; every markdown link URL starts with `https://`. Cheap, and the only assertion covering all branches at once.
12. **Guard test** for the dead branch (above).

### `test/server-tools.test.ts`

`InMemoryTransport.createLinkedPair()` exists on the installed SDK (`node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.d.ts:19`) and the whole approach was driven end-to-end before being written down.

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, SERVER_INSTRUCTIONS, SERVER_NAME, SERVER_VERSION } from '../src/server.js';

async function connect() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: async (): Promise<void> => { await client.close(); await server.close(); } };
}
```

- Tool names `.sort()` `toEqual` the exact set. A lost or silently added tool fails.
- **Every** tool's `annotations` `toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false })`. CLAUDE.md rule 1 is currently asserted **nowhere** in the suite.
- Schema shape without duplicating zod: per tool, `Object.keys(inputSchema.properties)` `toEqual` the keys of the corresponding zod `.shape` — that pins `types.ts` and the registration together. Plus `get_angular_upgrade_plan.inputSchema.required` `toEqual(['path'])` and `level` as an anyOf of consts 1|2|3 (`types.ts:321`).
- Handshake: `client.getServerVersion()` and `client.getInstructions()` `toBe(SERVER_INSTRUCTIONS)` — `test/instructions.test.ts` checks the string's content but never that it reaches the wire.
- Error paths, all confirmed to return results rather than throw: nonexistent path → `isError`, `Path does not exist: …`; `path: 42` → `Input validation error`, **and a subsequent valid call on the same connection still succeeds** (a bad argument must not poison the session); `{ fromMajor: 22, toMajor: 19 }` → `Cannot plan a downgrade…` (`server.ts:297-298`); unknown tool → `Tool nope not found`.
- The never-throw rule: `get_signalforms_recipe { construct: 'NotAThing' }` → `isError` undefined, `found === false`, non-empty `availableConstructs`.
- Happy paths need real files (handlers hardcode `nodeFileSystem`, `server.ts:151/212/247/284`): `mkdtempSync(join(tmpdir(), 'sfm-'))` with a package.json and one component. Assert `totalFindings` equals the summed `files[].findings.length` — `server.ts:156` computes it and nothing checks it.
- The version gate, logic that exists **only** in `server.ts:221-226`: `@angular/core: ^19.2.0` → `blockingPrerequisite` non-null and mentioning v21; `^22.0.0` → null and `signalFormsAvailable === true`.

### The prose defects found during verification

Fix in M14, each with a test:

- **Inline templates.** `src/server.ts:119-120`, `src/core/report.ts:297-299`, `src/core/report.ts:449-450` all state inline `template:` strings are not scanned. `collectInlineTemplates` (`detect.ts:274`) ships and runs (`detect.ts:257`). Test: a fixture whose only form lives in an inline `template:` must produce `Template.*` findings **and** the report must not claim they would be missed. Note the deliberate exception that must survive the rewrite (ROADMAP.md:190-194): templates containing `${substitutions}` are skipped, because the text is not the text the compiler sees.
- **`USAGE`** (`server.ts:364-365`) omits `get_angular_upgrade_plan`. Test it against the registered tool list from `server-tools.test.ts`.

### Prettier

`npx prettier --check .` fails on exactly 7 files: `CLAUDE.md` (6 diff lines), `README.md` (18), `REVERIFICATION.md` (12), `ROADMAP.md` (74), `docs/superpowers/plans/2026-08-11-m11-tier-a-coverage.md` (64), `scripts/fetch-update-steps.mjs` (15, real reflow), `verify/generate.mjs` (7, real reflow). 196 lines total, ~120 whitespace-only; the only content-looking edits are three `*emphasis*` → `_emphasis_` swaps that render identically. All six long-lived files already failed at bca6504 and fcf245d — pre-existing debt, not M11 fallout.

Land `npm run format` as **one mechanical commit of its own** so the M14 test diff stays reviewable, then change `package.json:29` from `"check": "npm run typecheck && npm run lint && npm run test"` to include `npm run format:check`. CI already runs `npm run check`. Cost worth naming: prettier pads markdown tables to the widest cell, so every future ROADMAP table edit produces a wide re-padding diff unless contributors run `npm run format`.

### Order (TDD)

1. Entrypoint guard + a test that importing `src/server.js` produces no stderr and no transport. Everything else depends on it.
2. `test/upgrade-report.test.ts` against **current** behaviour for the assertions that already pass; write the attribution and companion-range assertions **failing**, then fix `upgrade-report.ts` + `server.ts`.
3. Exact-string `total === 0` test → fix the trailing space.
4. Dead-branch brute-force guard.
5. `test/server-tools.test.ts`.
6. Inline-template prose fix + `USAGE` fix, each test-first.
7. `npm run format` as its own commit; then the `check` script change.

### Verify at build time

- **Smoke-test the guard on the real published bin** before release: `npm pack`, install into a scratch project, run `--version` and then as an MCP server.
- If `mkdtemp` I/O proves flaky in CI, the alternative is injecting a `FileSystemPort` into `createServer` — a wider change than M14 should carry, and it would stop exercising `src/infra/node-fs.ts` (101 lines, imported by no test; `readInstalledPeer` and `readBuildConfigs` swallow every error and return `undefined`/`[]`, and those silent paths decide whether the report says "not checked" or nothing at all).
- Exact-string assertions are intentionally brittle. Say so in a comment on each, or someone will "fix" them with `toContain`.
- The dead-branch and zero-total findings are properties of the **currently vendored** step data (commit 3b8bb7219b, retrieved 2026-07-21). `npm run data:update-steps` can invalidate both — hence guards, not deletions.

---

## M15 — Tier B recipes

Three recipes closing ROADMAP.md:208-209, each with the detector work that makes it reachable.

### The hard sequencing constraint (not in the research)

`test/recipes.test.ts:77-90` runs `it.each(DETECTED_CONSTRUCTS.filter(c => !DEFERRED.includes(c)))` asserting `getSignalFormsRecipe(construct).found === true`, and then `expect(DEFERRED).toEqual([])`. **A new construct in `DETECTED_CONSTRUCTS` (`types.ts:39-117`) without a recipe fails the suite, and `DEFERRED` cannot be used to park it.** Detector + recipe must land in the same commit, per construct.

`test/sufficiency.test.ts:46-53` runs `it.each([...CROSS_FILE_CONSTRUCTS])` and asserts `matching.length > 0` against a fixed two-file fixture. **Adding `controlSubclass` to `CROSS_FILE_CONSTRUCTS` (`types.ts:144`) without extending that fixture fails with "fixture exercises controlSubclass".**

And M12 must land first: M15 adds constructs, which changes report totals, and the grouped judgment section is where those new judgment reasons will surface.

### 1. `crossFieldValidator` — do this one first

Highest value, and the only one where the *detector gap is itself a silent under-report of the M5/M11 class*. There is no handler for the plural `validators:` key anywhere in `src/core`. `collectFromDeadValidatorOption` (`detect.ts:1011-1035`) fires only on the singular `validator`/`asyncValidator`; `collectFromAsyncValidatorsOption` (`:1050-1063`) only on `asyncValidators`; `collectCustomValidatorDeclaration` (`:1066-1099`) fires at the validator's **declaration**, so it cannot know what the validator was attached to, and fires not at all when the validator is imported. Measured: the same cross-field form reports **3 findings including 1 judgment** when the validator is local, and **2 findings, 0 judgment** when it is imported. A form whose entire difficulty is a cross-field rule reports as fully mechanical.

**Detector.** New `collectFromValidatorsOption` firing on key `validators` when the enclosing object literal is **argument index 1** of either `new FormGroup`/`new FormArray` or `<fb>.group(...)`/`.array(...)`. `isConstructorOptionsObject` (`detect.ts:1037-1048`) is the starting point but must be tightened — it currently accepts any `CONTROL_TYPES` member including `FormControl`, and checks no argument position. Also handle the positional legacy form `new FormGroup({...}, passwordsMatch)` (second ctor arg is `ValidatorFn | ValidatorFn[] | AbstractControlOptions | null`). Emit `groupValidator`, `judgment`. A control-level `validators: [x]` stays out — already covered by `Validators.*` / `customValidator`.

**The behaviour, from shipped source.** `_runValidator()` assigns to `this.errors` on the control it was attached to; `_calculateStatus()` reads `this.errors`. Nothing writes to children. Observed on 22.0.7 with a mismatched `new FormGroup({password, confirmPassword}, {validators:[match]})`: `group.errors = {passwordMismatch: true}`, `confirm.errors = null`, `confirm.invalid = false`. So the `before` template can only read the group.

**Signal Forms has three placements with three different destinations**, all four observed at runtime on 22.0.7:

| shape | error lands on | root |
|---|---|---|
| `validate(path.confirmPassword, …)` | `f.confirmPassword().errors()` | `errorSummary` yes, `invalid` true |
| `validateTree(path, … fieldTree: fieldTreeOf(path.confirmPassword))` | `f.confirmPassword().errors()` | same |
| `validate(path, …)` at the group path | `f().errors()` **only** | `f.confirmPassword().invalid()` stays **false** |

Mechanism: `addDefaultField` sets `error.fieldTree ??= ctx.fieldTree`; tree errors propagate **downward** from the bound node and each node keeps only `err.fieldTree === this.node.fieldTree`. `errors()` is own-errors; `errorSummary()` is own + descendants (`_structure-chunk.d.ts:353-360`). **Where the error lands is the migration** — a "faithful" port to the group path keeps `form.invalid` working while every per-field `@if` block goes silent.

Two type-level constraints, verified by compilation:

- **`validate()` structurally cannot target another field.** `FieldValidator` returns `ValidationError.WithoutFieldTree`, which declares `readonly fieldTree?: never` (`_structure-chunk.d.ts:1599-1604`; it also declares `formField?: never`). Setting it is `TS2322: Type 'ReadonlyFieldTree<…>' is not assignable to type 'undefined'`. Only `validateTree` (`types/signals.d.ts:495`) takes `WithOptionalFieldTree` with `fieldTree?: ReadonlyFieldTree<unknown>`.
- **A reusable cross-field rule takes `SchemaPathTree<T>`, not `SchemaPath<T>`** — the latter has no subfield properties (`TS2339`). The existing `customValidator` recipe's `SchemaPath<string>` is correct for a *leaf* and wrong here.

**Undocumented footgun to encode as a caveat.** `fieldTree` is typed `ReadonlyFieldTree<unknown>`, so the compiler accepts *any* field — but a `validateTree` error whose target is not a **descendant** of the bound path matches nowhere and is silently discarded, form reporting valid. Observed: `validateTree(path.nested, … fieldTree: fieldTreeOf(path.password))` → all `errors()` empty, `root.invalid` **false**. Rule: bind at the lowest common ancestor of every field targeted. Write this as *observed v22 behaviour with the file:line*, not as an API contract.

The `after` (compile-verified against 22.0.7), default answer — error on the field the user must fix:

```ts
readonly f = form(this.model, (path) => {
  required(path.password);
  required(path.confirmPassword);

  validate(path.confirmPassword, ({ value, valueOf, stateOf }) => {
    if (!stateOf(path.password).touched()) return null;
    return value() === valueOf(path.password)
      ? null
      : { kind: 'passwordMismatch', message: 'Passwords do not match' };
  });
});
```

Hoisted, many targets:

```ts
export function dateRangeRule(path: SchemaPathTree<Booking>): void {
  validateTree(path, ({ value, fieldTreeOf }) => {
    const { dateFrom, dateTo } = value();
    if (dateFrom <= dateTo) return null;
    const message = 'From date must be on or before the to date';
    return [
      { kind: 'dateRange', message, fieldTree: fieldTreeOf(path.dateFrom) },
      { kind: 'dateRange', message, fieldTree: fieldTreeOf(path.dateTo) },
    ];
  });
}
```

`versionSensitive: false` — **but only because no cross-version claim is made.** The v21/v22 diff for `validate`/`validateTree` was **not** performed. Per CLAUDE.md rule 2 that diff is required before any version-sensitivity flag, so author the recipe with no cross-version prose at all, or do the diff first. Do not restate the `disabled()` divergence here; it does not appear in this recipe.

**Independent fix in the same file:** `src/core/recipes.ts:2129-2133` says the callback "receives a FieldContext (`{ value, valueOf, state, field, ... }`)". There is **no `field` property**. Shipped `RootFieldContext` (`_structure-chunk.d.ts:779-798`) is exactly `value`, `state`, `fieldTree`, `valueOf()`, `stateOf()`, `fieldTreeOf()`, `pathKeys`; `ctx.field` is `TS2339`. The v22 Validation guide's FieldContext table lists `field`, and this recipe copied the docs' error. **Source wins, and say so.** If Angular fixes the page, the correction note must not become a claim the docs are still wrong — cite the shipped type as the authority.

Docs search **did not** come back empty here: `search_documentation` at `version: 22` returned the cross-field-logic page with `searchedVersion: 22` for both queries.

### 2. `FormRecord`

**Detection is a total silent miss today.** `FormRecord` appears nowhere in `src/`: absent from `CONTROL_TYPES` (`detect.ts:90-95`), `REPORTED_CONTROL_TYPES` (`:98-102`), and `record` is absent from the three FormBuilder method gates (`:532`, `:619`, `:1220`). Because it never binds a name to a form, everything downstream is invisible. Measured on a hand-written fixture: **6 findings, all mechanical**, while `new FormRecord<…>`, `fb.record({...})`, `addControl`/`removeControl`, `.getRawValue()`, `.get(key)`, `Object.keys(.controls)` and `.invalid` were all missed.

Minimum surface: add `'FormRecord'` to `CONTROL_TYPES` + `REPORTED_CONTROL_TYPES`; add `'record'` alongside `'group'|'array'|'control'` at `:532`, `:619`, `:1220`; map it to a `FormBuilder.record` construct beside the existing `.array`/`.control`/`.group` branches (`:1220-1250`).

**The API facts, from shipped source.** `class FormRecord extends FormGroup {}` — empty body, `fesm2022/forms.mjs:2612`. The entire difference is type-level (homogeneous control type, open key set). Signal Forms has **no** record-named export; the counterpart is a `Record<string, T>` model: `FieldTree` routes through `Subfields`, a mapped type over `keyof TModel`, which for `Record<string, T>` collapses to an index signature (`_structure-chunk.d.ts:208`, `:224-228`). At runtime children are enumerated with `for (const key of Object.keys(value))` (`_validation_errors-chunk.mjs:1162`), so keys added after `form()` get fields. `applyEach` applies one schema to every key: the second overload is `applyEach<TValue extends Object>(path, SchemaOrSchemaFn<ItemType<TValue>, PathKind.Child>)` with `type ItemType<T> = T extends ReadonlyArray<any> ? T[number] : T[keyof T]` (`_structure-chunk.d.ts:1979-1980`, `:820`).

Runtime-observed on 22.0.7: keys added after creation get the full schema; `ctx.key()` inside a validator returns the record key; `f['k']().value.set(v)` writes through; deleting a key makes a held reference throw NG01902.

**Docs gap, stated plainly.** angular.dev's `applyEach` page says only *"Applies a schema to each item of an array"* and **both** of its usage notes — one under each overload — are the same array example. There is no record example anywhere. `search_documentation("applyEach dynamic keys record model", version: 22)` returns `{"results":[],"searchedVersion":22}`; so does `"FormRecord signal forms migration"`. **This is the `getError` situation again: the API demonstrably ships and works, the docs do not describe this use.** The caveat must say so, and REVERIFICATION.md should carry a re-probe on each Angular minor.

The documented half **is** citable: the Dynamic Forms with JSON guide states *"The model uses `Record<string, …>` because the keys are not known ahead of time"*, shows `model.update(c => ({...c, [name]: …}))`, and documents the accessor pattern with its reason (*"Template type-checking treats `dynamicForm[name]` as an independent expression"*). `DOCS.dynamicJson` already exists at `src/core/recipes.ts:34`.

**Under this project's own strictness** (`noUncheckedIndexedAccess`) `f[key]` is `FieldTree<T> | undefined` — TS2322 when assigned to `Field<T>` — and it really can be `undefined` at runtime (the field proxy returns `undefined` for an absent key). So the `after` must route through the docs' accessor, and the cast described honestly as an assertion the caller owes a runtime guarantee for:

```ts
fieldFor(key: string): Field<string> {
  return this.f[key] as unknown as Field<string>;
}
```

**Not version-sensitive, established by diffing shipped tarballs** (21.2.19 vs 22.0.7), not docs: the `FormRecord` class body, both `applyEach` overloads, the `applyEach` runtime, `Subfields` with its object `[Symbol.iterator]`, and the whole field-proxy handler are identical. The only delta in this area is v22's `TMode` readonly-view parameter, which is orthogonal.

New `DOCS` keys (add to the constant at `recipes.ts:24-49`, do not inline): `applyEachApi`, `subfieldsApi`, `formRecordApi`.

### 3. `controlSubclass`

**There is nothing to extend.** `FieldTree` is a mapped/conditional type alias, no class, no constructor (`_structure-chunk.d.ts:208`); `Schema` is a branded object. And "keep the class as the model" fails twice: methods are mapped **out** of the field tree (`Subfields`'s `as TModel[K] extends Function ? never : K`, `:224-228`), and the first child write spreads the object — `valueForWrite` is a plain `{...sourceValue, [prop]: newPropValue}` (`_validation_errors-chunk.mjs:992-1003`) — so the prototype is dropped. That is the **source** evidence for the sentence already in `MODEL_SHAPE` (`recipes.ts:151-164`, rule 3, currently doc-only).

Reactive-side facts: `FormGroup extends AbstractControl` (`forms.mjs:2447`), `FormArray` (`:3784`), `FormRecord` (`:2612`). `extends FormControl<T>` with a free `T` is **TS2510** ("Base constructors must all have the same return type") because `FormControl` is `declare const FormControl: ɵFormControlCtor` over an interface whose `new` overloads return `FormControl<T>` and `FormControl<T | null>`. `extends AbstractControl` typechecks and **throws at runtime** — `AbstractControl` calls `this._updateValue()`, `this._allControlsDisabled()`, `this._anyControls()`, `this._forEachChild()`, none of which it defines; observed `TypeError: this._allControlsDisabled is not a function`.

**The migration is a redesign that splits one class into four destinations**: structure → interface + empty-value constant; constructor validator wiring → `schema()`; domain methods → plain functions over the model type; derived getters → `computed()` on the owning component. Each destination is documented individually (model-design guide, schemas guide, custom-controls "Making controls reusable"). **The mapping from subclass member to destination is INFERRED** — `search_documentation(version: 22)` returns zero results for subclassing in either direction. That must be a `NOT DOCUMENTED` caveat, per the project's refuse-rather-than-fabricate stance.

The documented **staging** step (not the destination): `compatForm()` takes a model whose properties are `AbstractControl` instances, and `CompatFieldState<TControl>` declares `control: Signal<TControl>` (`_structure-chunk.d.ts:496-498`) — so the declared subclass type survives and `f.shippingAddress().control().formatOneLine()` compiles. The migration guide documents this shape for a plain `FormGroup`; that the *subclass* type is preserved is a compile check, not a documented statement. Offer it for a subclass instantiated in many places; it defers the redesign rather than performing it.

**Detector.** Wire into the existing class branch (`detect.ts:710-713`) beside `collectControlValueAccessor` (`:727-754`, the pattern to mirror, including reporting once per class). The walker (`detect.ts:248-252`) recurses independently of `collectFromNode`'s early returns, so the `new FormControl(...)` calls inside `super({...})` are still found separately and keep `definesForm: true` — the subclass finding itself is `definesForm: false`.

```ts
/** Reactive Forms base classes real codebases subclass. Superset of CONTROL_TYPES. */
const SUBCLASSABLE_CONTROL_TYPES: ReadonlySet<string> = new Set([
  'AbstractControl', 'FormControl', 'FormGroup', 'FormArray', 'FormRecord',
  'UntypedFormControl', 'UntypedFormGroup', 'UntypedFormArray',
]);
```

Name it `controlSubclass`, matching the existing camelCase design-change constructs (`dynamicControls`, `asyncValidator`, `formStateRead`). **Not** `AbstractControl.subclass` — every `AbstractControl.*` key in `types.ts:76-107` is a member access aliasing to `formStateRead`/`formStateWrite`, so it would read as one of those.

Add `'controlSubclass'` to `VALIDATOR_CONSTRUCTS` (`complexity.ts:9`, and consider renaming it `SHARED_PRIMITIVE_CONSTRUCTS`): a subclass is a shared primitive exactly like a shared validator, decide it early. Without it, a getters-only subclass file can land in role `reference` and sort **last** — the `roles-section-formio` defect ROADMAP.md:73-75 records.

Known misses to state, not paper over: `class X extends someMixin(FormGroup)` (heritage expression is a `CallExpression`), and `const FG = FormGroup; class X extends FG` (local re-binding, already out of scope by choice, ROADMAP.md:206-207).

### Adjudication: the two detector passes overlap

The FormRecord pass wants `FormRecord` in `CONTROL_TYPES`; the subclass pass wants a separate `SUBCLASSABLE_CONTROL_TYPES` including `Untyped*`. Do the `CONTROL_TYPES` widening **once**, in the FormRecord slice, and derive `SUBCLASSABLE = CONTROL_TYPES ∪ {FormRecord, UntypedFormControl, UntypedFormGroup, UntypedFormArray}`. Then **decide `Untyped*` deliberately**: today `grep -n 'Untyped' src/core/detect.ts` returns nothing, so shipping the subclass check alone means `class X extends UntypedFormGroup` is reported while `new UntypedFormGroup(...)` is not — a silent under-report of exactly the kind M11 was written to eliminate. Either widen `CONTROL_TYPES` to cover `Untyped*` in the same change, or drop them from `SUBCLASSABLE`. Add a test either way.

### Order (TDD)

Per recipe, one commit, in this order — `crossFieldValidator`, `FormRecord`, `controlSubclass` (descending by measured miss-rate and ascending by detector surface):

1. Detector test first: the fixture that reports 0 judgment findings today must report the new construct. For `crossFieldValidator`, add the **differential** test in the M11 spirit — the same form with the validator local vs imported must both report `groupValidator`.
2. Watch fail. Implement the collector.
3. `test/recipes.test.ts` now fails on the new `DETECTED_CONSTRUCTS` entry (`:77-90`). Write the recipe, with `sources` and caveats, in the **same commit**.
4. If the construct joins `CROSS_FILE_CONSTRUCTS` (`controlSubclass` should — the instantiation sites are in other files), extend `test/sufficiency.test.ts`'s fixture, or `it.each` fails on "fixture exercises controlSubclass".
5. Add a `verify/src/` fixture and run `npm run verify:recipes` (`package.json:36`). A green `tsc` is the gate on every `after` snippet.
6. `test/report-consistency.test.ts:162-187` and the complexity/report snapshots will churn from the new constructs and the `VALIDATOR_CONSTRUCTS` addition. Confirm the "decide first" role label still reads correctly when the finding is a class rather than a validator function.

### Verify at build time

- **Templates are not compile-checked.** `npm run verify:recipes` runs plain `tsc`, which does not typecheck an inline `template:` string, and `verify/` has no `@angular/compiler-cli`. The `[formField]` / `@for` markup in the FormRecord and cross-field recipes is **UNVERIFIED** and must carry that caveat until `ngtsc` can run. This is the same gap M13's `signalNotCalled` depends on — fix it once, for both.
- `@for (entry of f; track entry[0])` over the field tree typechecks in plain TS and the object `Symbol.iterator` executes, but was **not** verified inside an Angular template, and `track` on a live proxy pair is a plausible failure. The recipe iterates `keys()` instead. Do not promote the iteration form without an AOT check.
- `applyEach(p.someString, …)` **compiles** (because `string extends Object` in TS), so the compile harness cannot catch a misapplied `applyEach`. Do not rely on it to.
- Before committing to `controlSubclass`, count `FormRecord` and control subclassing on the 50-repo corpus. The 6-findings-all-mechanical measurement comes from one hand-written fixture: it proves the miss is total, not that it is frequent. Five sites in `detect.ts` change for it.
- The Signal Forms `after` snippets and the `compatForm` escape hatch are **compile-verified only**; `form()` needs an app-level injector, so behaviour under real change detection was not exercised anywhere in this research. A green `tsc` is not behavioural proof.