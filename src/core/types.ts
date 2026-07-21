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
 * Constructs detected in M1 ("basic constructs" per SPEC.md).
 *
 * `FormArray`, dynamic controls and async validators are deliberately absent —
 * they land in M2. See ROADMAP.md.
 */
export const M1_CONSTRUCTS = [
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
  'valueChanges',
  'statusChanges',
] as const;

export type Construct = (typeof M1_CONSTRUCTS)[number];

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

export const recipeSchema = z.object({
  construct: z.string(),
  description: z.string(),
  before: z.string(),
  after: z.string(),
  /**
   * Anything the agent must not assume. A recipe whose syntax could not be
   * confirmed against official docs MUST carry
   * `"UNVERIFIED — confirm on angular.dev"` here.
   */
  caveats: z.array(z.string()),
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
  availableConstructs: z.array(z.string()).optional(),
});
export type GetSignalFormsRecipeOutput = z.infer<typeof getSignalFormsRecipeOutputSchema>;
