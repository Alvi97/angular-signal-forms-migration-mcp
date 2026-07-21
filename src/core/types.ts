/**
 * Single source of truth for every shape crossing a tool boundary.
 *
 * Rule: define the zod schema, then derive the TypeScript type with `z.infer`.
 * Never hand-write a type that duplicates a schema — they drift.
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
 * Every construct the detector can emit.
 *
 * A construct here must resolve to a recipe (directly or through an alias), or be listed
 * as a documented gap in the recipe-coverage test. See ROADMAP.md.
 */
export const DETECTED_CONSTRUCTS = [
  'FormControl',
  'FormGroup',
  'FormBuilder',
  'FormBuilder.group',
  'FormBuilder.control',
  'Validators.required',
  'Validators.requiredTrue',
  'Validators.email',
  'Validators.min',
  'Validators.max',
  'Validators.minLength',
  'Validators.maxLength',
  'Validators.pattern',
  'Validators.compose',
  'customValidator',
  'AbstractControl.get',

  // M2 — dynamic and async
  'FormArray',
  'FormBuilder.array',
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

  'valueChanges',
  'statusChanges',
] as const;

export type Construct = (typeof DETECTED_CONSTRUCTS)[number];

/**
 * `mechanical` — a direct, low-risk transliteration the agent can apply confidently.
 * `judgment`   — the shape changes enough that a human must decide the target design.
 */
export const classificationSchema = z.enum(['mechanical', 'judgment']);
export type Classification = z.infer<typeof classificationSchema>;

export const findingSchema = z.object({
  /** The Reactive Forms construct found, e.g. `Validators.required`. */
  construct: z.string(),
  /** 1-based line number within the file. */
  line: z.number().int().positive(),
  /** Trimmed source text of the line, for the agent to locate the site. */
  snippet: z.string(),
  classification: classificationSchema,
  /** Why it was classified that way — shown to the user, so keep it plain. */
  reason: z.string(),
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
 * Where a recipe's syntax came from.
 *
 * Required on every recipe — a recipe without a source is indistinguishable from one
 * written out of a model's memory, which is exactly the failure mode this project keeps
 * hitting. `npm run docs:audit` reads these fields to turn a version upgrade into a
 * checklist instead of an archaeology exercise.
 */
export const provenanceSchema = z.object({
  /** Angular major version whose docs were read, e.g. 22. */
  verifiedAgainstVersion: z.number().int().positive(),
  /** ISO date (YYYY-MM-DD) the docs were retrieved. */
  retrievedISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Exact doc URLs consulted. Must be non-empty — see the CI test. */
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
  /**
   * Anything the agent must not assume. A recipe whose syntax could not be
   * confirmed against official docs MUST carry
   * `"UNVERIFIED — confirm on <exact URL>"` here.
   */
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
});
export type MigrationComplexity = z.infer<typeof migrationComplexitySchema>;

/* -------------------------------------------------------------------------- */
/* Tool inputs                                                                 */
/* -------------------------------------------------------------------------- */

export const findFormCandidatesInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe('Absolute path to a .ts file or a directory to scan recursively.'),
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
export const findFormCandidatesOutputSchema = z.object({
  files: z.array(fileFindingsSchema),
  totalFindings: z.number().int().nonnegative(),
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
