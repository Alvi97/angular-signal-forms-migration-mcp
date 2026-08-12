/**
 * Every shape crossing a tool boundary. Define the zod schema, derive the type with
 * `z.infer`; never hand-write a type that duplicates a schema.
 */
import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Result — discriminated union. Core functions never throw across a boundary. */
/* -------------------------------------------------------------------------- */

export interface Ok<T> {
  readonly ok: true;
  readonly data: T;
}

export interface Err {
  readonly ok: false;
  readonly error: string;
}

export type Result<T> = Ok<T> | Err;

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

export function err(error: string): Err {
  return { ok: false, error };
}

/* -------------------------------------------------------------------------- */
/* Detection                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every construct the detector can emit. Each must resolve to a recipe (directly or via an
 * alias) or be a documented gap in the recipe-coverage test.
 */
export const DETECTED_CONSTRUCTS = [
  'FormControl',
  'FormGroup',
  'FormBuilder',
  'FormBuilder.group',
  'FormBuilder.control',
  'Validators.required',
  'Validators.requiredTrue',
  'groupValidator',
  'Validators.email',
  'Validators.min',
  'Validators.max',
  'Validators.minLength',
  'Validators.maxLength',
  'Validators.pattern',
  'Validators.compose',
  'customValidator',
  'AbstractControl.get',
  // Keyed and indexed lookups (`items.at(i)` reaches one FormArray entry).
  'AbstractControl.at',
  'AbstractControl.contains',

  // M2: dynamic and async
  'FormArray',
  'FormBuilder.array',
  'FormRecord',
  'FormBuilder.record',
  'FormGroup.addControl',
  'FormGroup.removeControl',
  'FormGroup.setControl',
  'FormGroup.registerControl',
  'FormArray.push',
  'FormArray.removeAt',
  'FormArray.insert',
  'FormArray.clear',
  'FormArray.setControl',
  'asyncValidator',
  'deadValidatorOption',

  // M5: reading and writing form state
  'AbstractControl.value',
  'AbstractControl.valid',
  'AbstractControl.invalid',
  'AbstractControl.errors',
  'AbstractControl.touched',
  'AbstractControl.dirty',
  'AbstractControl.pristine',
  'AbstractControl.pending',
  'AbstractControl.controls',
  'AbstractControl.length',
  'AbstractControl.defaultValue',
  'AbstractControl.status',
  'AbstractControl.setValue',
  'AbstractControl.patchValue',
  'AbstractControl.reset',
  'AbstractControl.getRawValue',
  'AbstractControl.hasError',
  'AbstractControl.markAsTouched',
  'AbstractControl.markAllAsTouched',
  'AbstractControl.markAsUntouched',
  'AbstractControl.markAsDirty',
  'AbstractControl.markAsPristine',
  'AbstractControl.markAsPending',
  'AbstractControl.setErrors',
  'AbstractControl.updateValueAndValidity',
  'AbstractControl.enable',
  'AbstractControl.disable',
  'AbstractControl.setValidators',
  'AbstractControl.addValidators',
  'AbstractControl.removeValidators',
  'AbstractControl.clearValidators',
  'AbstractControl.setAsyncValidators',

  // M3: deep judgment
  'ControlValueAccessor',
  'controlSubclass',
  'valueChanges',
  'statusChanges',
  'valueChangesPipeline',
  'statusChangesPipeline',
  'valueChangesAsyncPipeline',
  'statusChangesAsyncPipeline',
] as const;

export type Construct = (typeof DETECTED_CONSTRUCTS)[number];

/**
 * `mechanical`: a direct, low-risk transliteration the agent can apply confidently.
 * `judgment`: the shape changes enough that a human must decide the target design.
 */
export const classificationSchema = z.enum(['mechanical', 'judgment']);
export type Classification = z.infer<typeof classificationSchema>;

/**
 * Constructs whose correct action cannot be decided from the file they appear in.
 *
 * `mechanical` is a claim about SUFFICIENCY, not just about syntax: it promises that
 * applying the advice finishes the job. The agent applying a finding sees only that file,
 * so advice depending on a fact stored elsewhere cannot be sufficient — however small the
 * edit looks. Anything listed here is `judgment` by construction, and `test/sufficiency`
 * enforces it.
 *
 * `Template.nativeAttribute` is the motivating case. A hardcoded `minlength="8"` on a
 * form-bound input must be deleted when the component declares a matching rule, and must
 * NOT be deleted when the attribute is the only place the constraint is stated — deleting
 * it there silently drops the validation. Nothing in the template distinguishes the two.
 * Every symbol in the old advice was correct and the compile harness was green, which is
 * exactly the failure a compile harness cannot see.
 */
export const CROSS_FILE_CONSTRUCTS: ReadonlySet<string> = new Set([
  'Template.nativeAttribute',
  // A control subclass is instantiated in OTHER files. Whether a given site is safe to change
  // cannot be decided from the file that declares the class.
  'controlSubclass',
]);

export const findingSchema = z.object({
  /** The Reactive Forms construct found, e.g. `Validators.required`. */
  construct: z.string(),
  /** 1-based line number within the file. */
  line: z.number().int().positive(),
  /** Trimmed source text of the line, for the agent to locate the site. */
  snippet: z.string(),
  classification: classificationSchema,
  /** Why it was classified that way; shown to the user, so keep it plain. */
  reason: z.string(),
  /**
   * True when this finding constructs a form (`new FormGroup`, `fb.group(...)`) rather than
   * referencing one. A file with no defining findings can't be migrated alone.
   */
  definesForm: z.boolean(),
});
export type Finding = z.infer<typeof findingSchema>;

export const fileFindingsSchema = z.object({
  /** Absolute path to the file. */
  file: z.string(),
  findings: z.array(findingSchema),
});
export type FileFindings = z.infer<typeof fileFindingsSchema>;

/* -------------------------------------------------------------------------- */
/* Recipes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Where a recipe's syntax came from. Required on every recipe, so advice can't be confused
 * with model memory; `npm run docs:audit` reads these fields.
 */
export const provenanceSchema = z.object({
  /** Angular major version whose docs were read, e.g. 22. */
  verifiedAgainstVersion: z.number().int().positive(),
  /** ISO date (YYYY-MM-DD) the docs were retrieved. */
  retrievedISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Exact doc URLs consulted; must be non-empty. */
  sources: z.array(z.string().url()).min(1),
  /** True when behaviour differs across Angular versions; the caveats must say how. */
  versionSensitive: z.boolean(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

export const recipeSchema = z.object({
  construct: z.string(),
  description: z.string(),
  before: z.string(),
  after: z.string(),
  /** Anything the agent must not assume; unconfirmed syntax carries an `UNVERIFIED` note. */
  caveats: z.array(z.string()),
  provenance: provenanceSchema,
});
export type Recipe = z.infer<typeof recipeSchema>;

/** Lookup result. Unknown construct is a value, not an exception. */
export type RecipeLookup =
  | (Recipe & { readonly found: true })
  | {
      readonly found: false;
      readonly construct: string;
      readonly availableConstructs: readonly string[];
    };

/* -------------------------------------------------------------------------- */
/* Complexity                                                                  */
/* -------------------------------------------------------------------------- */

export const migrationComplexitySchema = z.object({
  totalFindings: z.number().int().nonnegative(),
  /** Occurrences per construct, e.g. `{ "Validators.required": 23 }`. */
  byConstruct: z.record(z.string(), z.number().int().nonnegative()),
  mechanicalCount: z.number().int().nonnegative(),
  judgmentCount: z.number().int().nonnegative(),
  /**
   * Files in the order they should be migrated, simplest first: all-mechanical files
   * before any that need judgment, then fewest judgment calls, then smallest.
   */
  suggestedOrder: z.array(z.string()),
  /** Files that only reference a form defined elsewhere; sorted last, can't migrate alone. */
  referenceOnlyFiles: z.array(z.string()),
  /** Files defining reusable validators; their error shape gates consumers, so design early. */
  sharedValidatorFiles: z.array(z.string()),
});

/** What `analyze_migration_complexity` returns: the analysis plus the version gate. */
export const analyzeMigrationComplexityOutputSchema = migrationComplexitySchema.extend({
  /** Detected Angular version of the scanned project, or null if undetermined. */
  angularVersion: z.string().nullable(),
  signalFormsAvailable: z.boolean().nullable(),
  /** Non-null when the project cannot use Signal Forms at all yet. */
  blockingPrerequisite: z.string().nullable(),
});
export type AnalyzeMigrationComplexityOutput = z.infer<
  typeof analyzeMigrationComplexityOutputSchema
>;
export type MigrationComplexity = z.infer<typeof migrationComplexitySchema>;

/* -------------------------------------------------------------------------- */
/* Tool inputs                                                                 */
/* -------------------------------------------------------------------------- */

export const findFormCandidatesInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe('Absolute path to a .ts file or a directory to scan recursively.'),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Index of the first finding to return. Defaults to 0. Page with page.nextOffset.'),
  limit: z
    .number()
    .int()
    .positive()
    .max(2000)
    .optional()
    .describe(
      'Maximum findings to return. Defaults to 200. A whole workspace can be far larger than ' +
        'one context window, so the response is a window and says so when it is.',
    ),
  constructs: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Return only these construct names (e.g. ["FormArray.push"]). Use it to pull one ' +
        'decision at a time. Filtering is announced in `incomplete`.',
    ),
  classification: classificationSchema
    .optional()
    .describe('Return only "mechanical" or only "judgment" findings.'),
});
export type FindFormCandidatesInput = z.infer<typeof findFormCandidatesInputSchema>;

export const getSignalFormsRecipeInputSchema = z.object({
  construct: z
    .string()
    .min(1)
    .describe(
      'Reactive Forms construct to look up, e.g. "FormControl", "FormBuilder.group", "Validators.required".',
    ),
});
export type GetSignalFormsRecipeInput = z.infer<typeof getSignalFormsRecipeInputSchema>;

/* -------------------------------------------------------------------------- */
/* Tool outputs                                                                */
/* -------------------------------------------------------------------------- */

/**
 * MCP requires `structuredContent` to be a JSON object, so the findings array is
 * wrapped in `files` rather than returned bare.
 */
/* -------------------------------------------------------------------------- */
/* verify_migration                                                            */
/* -------------------------------------------------------------------------- */

export const VERIFY_CHECKS = [
  'leftoverReactiveForms',
  'reactiveFormsModuleImport',
  'templateDrivenModuleImport',
  'signalNotCalled',
  'deprecatedLogicShape',
  'preReleaseApiName',
  'schemaConstructionTimeRead',
  'controlInSignalFormModel',
  'droppedConstraint',
] as const;
export const verifyCheckSchema = z.enum(VERIFY_CHECKS);
export type VerifyCheck = (typeof VERIFY_CHECKS)[number];

/**
 * Deliberately NOT `mechanical | judgment`. That pair grades migration WORK; grading a defect
 * "mechanical" is a category error.
 *
 * `error`: will not build, or is a silent runtime defect. `warning`: compiles and may be
 * wrong, and the tool cannot decide without type information. `info`: expected in this file's
 * mode, reported so its absence is not mistaken for a finding.
 */
export const verifySeveritySchema = z.enum(['error', 'warning', 'info']);
export type VerifySeverity = z.infer<typeof verifySeveritySchema>;

export const verifyFindingSchema = z.object({
  check: verifyCheckSchema,
  severity: verifySeveritySchema,
  line: z.number().int().positive(),
  snippet: z.string(),
  message: z.string(),
  /** What backs the claim: a shipped `file:line`, a doc URL, or 'runtime-only'. Never empty. */
  evidence: z.string().min(1),
});
export type VerifyFinding = z.infer<typeof verifyFindingSchema>;

export const verifiedFileSchema = z.object({
  file: z.string(),
  findings: z.array(verifyFindingSchema),
});

export const skippedCheckSchema = z.object({
  check: verifyCheckSchema,
  reason: z.string().min(1),
});

export const verifyMigrationInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe('Absolute path to an ALREADY-MIGRATED .ts file, or a directory to scan.'),
});
export type VerifyMigrationInput = z.infer<typeof verifyMigrationInputSchema>;

export const verifyMigrationOutputSchema = z.object({
  files: z.array(verifiedFileSchema),
  errorCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  infoCount: z.number().int().nonnegative(),
  /** Scanned files that import no Signal Forms at all — nothing to verify there yet. */
  notMigratedFiles: z.array(z.string()),
  checksRun: z.array(verifyCheckSchema),
  /** Non-empty whenever a check could not run. Silence must never read as a pass. */
  checksSkipped: z.array(skippedCheckSchema),
  /** Always present. This proves the ABSENCE OF KNOWN DEFECTS, not correctness. */
  disclaimer: z.string(),
});
export type VerifyMigrationOutput = z.infer<typeof verifyMigrationOutputSchema>;

export const pagedFileFindingsSchema = fileFindingsSchema.extend({
  matchedInFile: z
    .number()
    .int()
    .nonnegative()
    .describe('Findings in this file matching the filters, before the page window.'),
  partial: z.boolean().describe('True when `findings` is a slice of this file, not all of it.'),
});

export const pageInfoSchema = z.object({
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  returned: z.number().int().nonnegative(),
  totalMatched: z.number().int().nonnegative().describe('Matching the filters across the scan.'),
  totalUnfiltered: z.number().int().nonnegative().describe('Findings in the scan before filters.'),
  truncated: z.boolean().describe('True when this page is not the whole matched set.'),
  nextOffset: z.number().int().nonnegative().nullable(),
});

export const findFormCandidatesOutputSchema = z.object({
  /**
   * FIRST KEY DELIBERATELY. Non-null means the list below is INCOMPLETE, and names the call
   * that returns the rest. An agent that reads only the head of a long payload still sees it;
   * a trailing flag would not survive that. Null means this is the whole picture — nothing
   * else in the response carries that guarantee.
   */
  incomplete: z
    .string()
    .nullable()
    .describe(
      'Non-null when this response is NOT the full result, with the call that returns the ' +
        'rest. Null means complete. Never treat a filtered or paged list as the whole job.',
    ),
  files: z.array(pagedFileFindingsSchema),
  totalFindings: z.number().int().nonnegative().describe('Findings in the whole scan, unfiltered.'),
  page: pageInfoSchema,
});
export type FindFormCandidatesOutput = z.infer<typeof findFormCandidatesOutputSchema>;

export const getSignalFormsRecipeOutputSchema = z.object({
  construct: z.string(),
  found: z.boolean(),
  description: z.string().optional(),
  before: z.string().optional(),
  after: z.string().optional(),
  caveats: z.array(z.string()).optional(),
  /** Surfaced to the agent so it can judge how current the advice is. */
  provenance: provenanceSchema.optional(),
  availableConstructs: z.array(z.string()).optional(),
});
export type GetSignalFormsRecipeOutput = z.infer<typeof getSignalFormsRecipeOutputSchema>;

export const analyzeMigrationComplexityInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe('Absolute path to a .ts file or a directory to scan recursively.'),
});
export type AnalyzeMigrationComplexityInput = z.infer<typeof analyzeMigrationComplexityInputSchema>;

export const getMigrationReportInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe('Absolute path to a .ts file or a directory to scan recursively.'),
});
export type GetMigrationReportInput = z.infer<typeof getMigrationReportInputSchema>;

/** The report is a markdown string; MCP structuredContent must be an object, so it wraps. */
export const getMigrationReportOutputSchema = z.object({
  markdown: z.string(),
});
export type GetMigrationReportOutput = z.infer<typeof getMigrationReportOutputSchema>;

/* -------------------------------------------------------------------------- */
/* Angular upgrade guide                                                       */
/* -------------------------------------------------------------------------- */

/** Application complexity, matching Angular's own enum: Basic 1, Medium 2, Advanced 3. */
export const applicationComplexitySchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type ApplicationComplexity = z.infer<typeof applicationComplexitySchema>;

/**
 * One step from Angular's update guide, vendored verbatim.
 *
 * `action` is markdown/HTML exactly as Angular publishes it. Optional flags are tri-state:
 * absent, `true` (the step requires that option) or `false` (hide when the option is set).
 */
export const upgradeStepSchema = z.object({
  possibleIn: z.number().int(),
  necessaryAsOf: z.number().int(),
  level: z.number().int(),
  step: z.string(),
  action: z.string(),
  ngUpgrade: z.boolean().optional(),
  material: z.boolean().optional(),
  pwa: z.boolean().optional(),
  angularCLI: z.boolean().optional(),
  windows: z.boolean().optional(),
});
export type UpgradeStep = z.infer<typeof upgradeStepSchema>;

export const upgradeStepDataSchema = z.object({
  provenance: z.object({
    source: z.string().url(),
    raw: z.string().url(),
    commit: z.string(),
    committedISO: z.string(),
    retrievedISO: z.string(),
    note: z.string(),
  }),
  steps: z.array(upgradeStepSchema),
});
export type UpgradeStepData = z.infer<typeof upgradeStepDataSchema>;

export const getAngularUpgradePlanInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe(
      'Absolute path inside the Angular project. The current version is read from its package.json.',
    ),
  fromMajor: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Override the detected current major version.'),
  toMajor: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Target major. Defaults to the version the recipes are verified against.'),
  level: applicationComplexitySchema
    .optional()
    .describe(
      'Application complexity, as on angular.dev/update-guide: 1 Basic, 2 Medium, 3 Advanced. Defaults to 3.',
    ),
  ngUpgrade: z.boolean().optional().describe('"I use ngUpgrade to combine AngularJS & Angular."'),
  material: z.boolean().optional().describe('"I use Angular Material."'),
  windows: z.boolean().optional().describe('"I use Windows." Swaps in cmd-compatible commands.'),
});
export type GetAngularUpgradePlanInput = z.infer<typeof getAngularUpgradePlanInputSchema>;

export const getAngularUpgradePlanOutputSchema = z.object({
  markdown: z.string(),
});
export type GetAngularUpgradePlanOutput = z.infer<typeof getAngularUpgradePlanOutputSchema>;
