/**
 * Reactive Forms detection — pure.
 *
 * Parsing uses the TypeScript compiler API (`ts.createSourceFile`), NOT regex.
 * We deliberately do not build a full `ts.Program`: that would require resolving
 * the user's tsconfig and node_modules on every call, which is slow and fails on
 * partial checkouts. The cost is that we have no TypeChecker, so `fb.group(...)`
 * cannot be *proven* to be a FormBuilder call. We compensate with a two-pass scan
 * that first binds local identifiers to FormBuilder, then only matches calls on
 * those names.
 *
 * All filesystem access is injected via `FileSystemPort` so the core stays pure
 * and unit-testable without touching disk.
 */
import ts from 'typescript';
import {
  err,
  ok,
  type Classification,
  type FileFindings,
  type Finding,
  type Result,
} from './types.js';

/* -------------------------------------------------------------------------- */
/* Ports                                                                       */
/* -------------------------------------------------------------------------- */

export interface FileSystemPort {
  /** True when `path` exists and is a directory. Must not throw. */
  isDirectory(path: string): boolean;
  /** True when `path` exists at all. Must not throw. */
  exists(path: string): boolean;
  /** Absolute paths of the entries directly inside `dir`. May throw; callers guard. */
  readDir(dir: string): readonly string[];
  /** UTF-8 contents of `file`. May throw; callers guard. */
  readFile(file: string): string;
}

/* -------------------------------------------------------------------------- */
/* Traversal policy                                                            */
/* -------------------------------------------------------------------------- */

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  '.angular',
  '.git',
  'out-tsc',
  'coverage',
]);

/** Angular spec files are excluded per SPEC.md — they test forms, they don't ship them. */
function isScannableFile(fileName: string): boolean {
  if (!fileName.endsWith('.ts') || fileName.endsWith('.d.ts')) return false;
  return !fileName.endsWith('.spec.ts');
}

function baseName(pathLike: string): string {
  const segments = pathLike.split(/[\\/]/);
  return segments[segments.length - 1] ?? pathLike;
}

/* -------------------------------------------------------------------------- */
/* Validator classification tables                                             */
/* -------------------------------------------------------------------------- */

/**
 * Built-in validators with a direct one-to-one Signal Forms counterpart.
 * Anything outside this set is treated as judgment: the agent must not guess.
 *
 * `requiredTrue` is here on the strength of the v22 docs only: they state that `required()`
 * "treats false as missing (invalid), matching <input type=checkbox required>". The v21 docs
 * defined empty as `null` or `''` alone, which made `false` pass — on v21 this would be a
 * judgment call needing a hand-written `validate()` rule. The recipe carries that warning.
 * Source: https://angular.dev/guide/forms/signals/validation#required
 */
const MECHANICAL_VALIDATORS: ReadonlySet<string> = new Set([
  'required',
  'requiredTrue',
  'email',
  'min',
  'max',
  'minLength',
  'maxLength',
  'pattern',
]);

/**
 * Control types that identify a variable as holding a Reactive Forms object.
 * Used both to report type-position usage and to decide whether `x.get('k')` is a
 * form accessor or an unrelated `Map`/`HttpParams` lookup.
 */
const CONTROL_TYPES: ReadonlySet<string> = new Set([
  'FormGroup',
  'FormControl',
  'FormArray',
  'AbstractControl',
]);

/** Control types reported when they appear in type position. */
const REPORTED_CONTROL_TYPES: ReadonlySet<string> = new Set([
  'FormGroup',
  'FormControl',
  'FormArray',
]);

/**
 * Methods that mutate a form's SHAPE at runtime. Signal Forms derives its field tree from
 * the model signal's type, so there is no equivalent imperative surface — the shape must
 * be expressed in the model instead. Always judgment.
 */
const GROUP_MUTATORS: ReadonlySet<string> = new Set([
  'addControl',
  'removeControl',
  'setControl',
  'registerControl',
]);

/**
 * RxJS operator tiers for a form stream.
 *
 * Scope: this analysis is rooted at `.valueChanges` / `.statusChanges` only, so it can
 * never wander into unrelated RxJS. Classifying arbitrary observables is a different
 * product — see ROADMAP.md.
 *
 * `moderate` operators are value transforms with a documented signal equivalent
 * (computed / the debounce() rule). `hard` operators coordinate other async sources, and
 * signals have no direct equivalent — the recipe says so rather than inventing one.
 */
const MODERATE_OPERATORS: ReadonlySet<string> = new Set([
  'map',
  'filter',
  'debounceTime',
  'distinctUntilChanged',
  'distinctUntilKeyChanged',
  'startWith',
  'tap',
  'pairwise',
  'skip',
  'take',
]);

const HARD_OPERATORS: ReadonlySet<string> = new Set([
  'switchMap',
  'mergeMap',
  'concatMap',
  'exhaustMap',
  'flatMap',
  'combineLatest',
  'combineLatestWith',
  'withLatestFrom',
  'forkJoin',
  'zip',
  'merge',
  'scan',
  'reduce',
]);

/**
 * AbstractControl state read directly off a form. Each has a signal counterpart on the
 * field state — `form.invalid` becomes `f().invalid()` — so these are mechanical, but they
 * are still edit sites and were previously invisible.
 */
const STATE_READS: ReadonlySet<string> = new Set([
  'value',
  'valid',
  'invalid',
  'errors',
  'touched',
  'dirty',
  'pristine',
  'pending',
  'controls',
]);

/**
 * Write APIs whose intent survives the migration, even though the call changes shape:
 * value writes go through the model signal, and reset() exists on field state.
 */
const CONTROL_WRITES_MECHANICAL: ReadonlySet<string> = new Set([
  'setValue',
  'patchValue',
  'reset',
  'getRawValue',
  'hasError',
]);

/**
 * Imperative APIs with NO Signal Forms counterpart. State is derived from rules, so these
 * become schema rules (disabled/applyWhen), submission, or nothing at all.
 */
const CONTROL_WRITES_JUDGMENT: ReadonlySet<string> = new Set([
  'markAsTouched',
  'markAllAsTouched',
  'markAsUntouched',
  'markAsDirty',
  'markAsPristine',
  'markAsPending',
  'setErrors',
  'updateValueAndValidity',
  'enable',
  'disable',
  'setValidators',
  'addValidators',
  'removeValidators',
  'clearValidators',
  'setAsyncValidators',
]);

const ARRAY_MUTATORS: ReadonlySet<string> = new Set([
  'push',
  'removeAt',
  'insert',
  'clear',
  'setControl',
]);

/* -------------------------------------------------------------------------- */
/* Per-file detection                                                          */
/* -------------------------------------------------------------------------- */

interface FindingDraft {
  construct: string;
  node: ts.Node;
  classification: Classification;
  reason: string;
}

/**
 * Detects Reactive Forms constructs in a single TypeScript source text.
 *
 * Pure: takes the text, returns findings. Never throws on malformed input —
 * the TS parser is error-tolerant and produces a best-effort tree.
 */
export function detectInSource(filePath: string, text: string): Finding[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );

  // Gate: a file that never imports @angular/forms is not a Reactive Forms file.
  // Without this, a bare `.valueChanges` matches any observable in the codebase.
  if (!importsAngularForms(sourceFile)) return [];

  const names: BoundNames = {
    formBuilders: collectFormBuilderNames(sourceFile),
    forms: collectFormLikeNames(sourceFile),
    mutated: collectMutatedNames(sourceFile),
  };
  const drafts: FindingDraft[] = [];

  const visit = (node: ts.Node): void => {
    collectFromNode(node, names, drafts);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return materialise(drafts, sourceFile, text);
}

function importsAngularForms(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text.startsWith('@angular/forms'),
  );
}

/* -------------------------------------------------------------------------- */
/* Pass 1 — bind identifiers to FormBuilder                                    */
/* -------------------------------------------------------------------------- */

/**
 * Finds every local name that holds a FormBuilder, covering both DI styles:
 *   constructor(private fb: FormBuilder) {}
 *   private readonly fb = inject(FormBuilder);
 */
/** Local names bound during pass 1, consumed by pass 2. */
interface BoundNames {
  /** Names holding a FormBuilder, so `fb.group(...)` can be matched without a TypeChecker. */
  readonly formBuilders: ReadonlySet<string>;
  /** Names holding a form object, so `form.get('k')` is distinguishable from `map.get('k')`. */
  readonly forms: ReadonlySet<string>;
  /** Names whose shape is mutated at runtime — those forms cannot be a static model. */
  readonly mutated: ReadonlySet<string>;
}

/**
 * Names that have a shape-mutating method called on them anywhere in the file.
 *
 * A `new FormArray([...])` that is only ever read is a plain list in the model signal.
 * One that is pushed to is a dynamic structure, and the migration is a design decision
 * rather than a rename — so the declaration itself has to be downgraded to judgment.
 */
function collectMutatedNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = declaredName(node.expression.name);
      if (method !== undefined && (GROUP_MUTATORS.has(method) || ARRAY_MUTATORS.has(method))) {
        const receiver = node.expression.expression;
        const name = ts.isIdentifier(receiver)
          ? receiver.text
          : ts.isPropertyAccessExpression(receiver) &&
              receiver.expression.kind === ts.SyntaxKind.ThisKeyword
            ? declaredName(receiver.name)
            : undefined;
        if (name !== undefined) names.add(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return names;
}

/** The name a `new X(...)` expression is being assigned to, if any. */
function assignedName(node: ts.Node): string | undefined {
  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined) return undefined;
  if (ts.isPropertyDeclaration(parent) || ts.isVariableDeclaration(parent)) {
    return declaredName(parent.name);
  }
  if (ts.isPropertyAssignment(parent)) return declaredName(parent.name);
  return undefined;
}

/**
 * Finds every local name that holds a Reactive Forms object, whether it was annotated
 * (`profileForm: FormGroup`) or initialised (`= fb.group({...})`, `= new FormGroup(...)`).
 *
 * Without this, reporting `x.get('key')` would also flag every `Map`, `HttpParams` and
 * `queryParamMap` lookup that happens to live in a file importing @angular/forms.
 */
function collectFormLikeNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyDeclaration(node) || ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      const name = declaredName(node.name);
      if (name !== undefined && (isControlType(node.type) || holdsFormInitializer(node))) {
        names.add(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return names;
}

function isControlType(type: ts.TypeNode | undefined): boolean {
  if (type === undefined || !ts.isTypeReferenceNode(type)) return false;
  return ts.isIdentifier(type.typeName) && CONTROL_TYPES.has(type.typeName.text);
}

/** True for `= new FormGroup(...)`, `= fb.group({...})` and their array/control siblings. */
function holdsFormInitializer(node: ts.Node): boolean {
  const initializer =
    (ts.isPropertyDeclaration(node) || ts.isVariableDeclaration(node)) && node.initializer
      ? node.initializer
      : undefined;
  if (initializer === undefined) return false;

  if (ts.isNewExpression(initializer) && ts.isIdentifier(initializer.expression)) {
    return CONTROL_TYPES.has(initializer.expression.text);
  }
  if (ts.isCallExpression(initializer) && ts.isPropertyAccessExpression(initializer.expression)) {
    const method = declaredName(initializer.expression.name);
    return method === 'group' || method === 'array' || method === 'control';
  }
  return false;
}

function collectFormBuilderNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) || ts.isPropertyDeclaration(node) || ts.isVariableDeclaration(node)) {
      const name = declaredName(node.name);
      if (name !== undefined && (isFormBuilderType(node.type) || isInjectFormBuilder(node))) {
        names.add(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return names;
}

function declaredName(name: ts.Node): string | undefined {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  return undefined;
}

function isFormBuilderType(type: ts.TypeNode | undefined): boolean {
  if (type === undefined || !ts.isTypeReferenceNode(type)) return false;
  const { typeName } = type;
  // Matches `FormBuilder` and the typed variant `NonNullableFormBuilder`.
  return ts.isIdentifier(typeName) && typeName.text.endsWith('FormBuilder');
}

function isInjectFormBuilder(node: ts.Node): boolean {
  const initializer =
    (ts.isPropertyDeclaration(node) || ts.isVariableDeclaration(node)) && node.initializer
      ? node.initializer
      : undefined;
  if (initializer === undefined || !ts.isCallExpression(initializer)) return false;
  if (!ts.isIdentifier(initializer.expression) || initializer.expression.text !== 'inject') {
    return false;
  }
  const [firstArgument] = initializer.arguments;
  return (
    firstArgument !== undefined &&
    ts.isIdentifier(firstArgument) &&
    firstArgument.text.endsWith('FormBuilder')
  );
}

/* -------------------------------------------------------------------------- */
/* Pass 2 — match constructs                                                   */
/* -------------------------------------------------------------------------- */

function collectFromNode(node: ts.Node, names: BoundNames, out: FindingDraft[]): void {
  if (ts.isNewExpression(node)) {
    collectFromNewExpression(node, names, out);
    return;
  }
  if (ts.isCallExpression(node)) {
    collectFromFormBuilderCall(node, names.formBuilders, out);
    collectFromControlGet(node, names.forms, out);
    collectFromShapeMutation(node, names.forms, out);
    collectFromControlApi(node, names.forms, out);
    return;
  }
  if (ts.isPropertyAssignment(node)) {
    collectFromAsyncValidatorsOption(node, out);
    return;
  }
  if (ts.isPropertyAccessExpression(node)) {
    collectFromPropertyAccess(node, out);
    collectFromStateRead(node, names.forms, out);
    return;
  }
  if (ts.isTypeReferenceNode(node)) {
    collectFromTypeReference(node, out);
    return;
  }
  if (ts.isClassDeclaration(node)) {
    collectControlValueAccessor(node, out);
    return;
  }
  if (ts.isFunctionLike(node)) {
    collectCustomValidatorDeclaration(node, out);
  }
  if (ts.isParameter(node)) {
    collectFormBuilderInjection(node, out);
  }
}

/**
 * A ControlValueAccessor component. v22 replaces the whole interface with
 * `FormValueControl` / `FormCheckboxControl`.
 *
 * Reported once per class, from the class declaration, because a CVA is recognisable two
 * ways — `implements ControlValueAccessor` and the `NG_VALUE_ACCESSOR` provider — and real
 * components almost always do both. Reporting each separately would double-count.
 */
function collectControlValueAccessor(node: ts.ClassDeclaration, out: FindingDraft[]): void {
  const implementsCva = (node.heritageClauses ?? []).some(
    (clause) =>
      clause.token === ts.SyntaxKind.ImplementsKeyword &&
      clause.types.some(
        (type) =>
          ts.isIdentifier(type.expression) && type.expression.text === 'ControlValueAccessor',
      ),
  );

  const providesValueAccessor = providesNgValueAccessor(node);
  if (!implementsCva && !providesValueAccessor) return;

  out.push({
    construct: 'ControlValueAccessor',
    node,
    classification: 'judgment',
    reason:
      'ControlValueAccessor is replaced by the FormValueControl / FormCheckboxControl ' +
      'interfaces. The four-method callback protocol (writeValue / registerOnChange / ' +
      'registerOnTouched / setDisabledState) collapses into a `value` model signal plus ' +
      'optional state inputs, so the component is rewritten rather than adapted.',
  });
}

/** True when the class decorator lists NG_VALUE_ACCESSOR among its providers. */
function providesNgValueAccessor(node: ts.ClassDeclaration): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(child) && child.text === 'NG_VALUE_ACCESSOR') {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  for (const modifier of node.modifiers ?? []) {
    if (ts.isDecorator(modifier)) visit(modifier);
  }
  return found;
}

/**
 * `form.get('email')` — a string-keyed lookup with no Signal Forms counterpart; the field
 * tree is reached by dot notation instead. Only matched on receivers pass 1 bound to a
 * form, so `map.get(k)` and `queryParamMap.get(k)` stay out of the report.
 */
function collectFromControlGet(
  node: ts.CallExpression,
  formNames: ReadonlySet<string>,
  out: FindingDraft[],
): void {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return;
  if (declaredName(callee.name) !== 'get') return;
  if (!isKnownReceiver(callee.expression, formNames)) return;

  const [key] = node.arguments;
  const literalKey = key !== undefined && ts.isStringLiteralLike(key);

  out.push({
    construct: 'AbstractControl.get',
    node,
    classification: literalKey ? 'mechanical' : 'judgment',
    reason: literalKey
      ? 'A literal .get("key") becomes dot notation on the field tree (form.key).'
      : 'The key is computed, so there is no single field to rewrite to; the surrounding ' +
        'code must be redesigned around the typed field tree.',
  });
}

/**
 * `form.invalid`, `form.value`, `form.controls` — state read straight off the form object.
 *
 * Each maps to a signal call on the field state (`f().invalid()`), so these are mechanical.
 * They were previously invisible, which understated the edit count: mockio-master's
 * "simplest, all-mechanical" file turned out to have two of them.
 *
 * `.status` is the exception — it was a string union ('VALID' | 'INVALID' | …) and Signal
 * Forms has no equivalent, so it is judgment.
 */
function collectFromStateRead(
  node: ts.PropertyAccessExpression,
  formNames: ReadonlySet<string>,
  out: FindingDraft[],
): void {
  const member = declaredName(node.name);
  if (member === undefined) return;

  // `form.reset()` is a call, reported by collectFromControlApi. Without this guard the
  // callee would also be counted here as a read of a `reset` property.
  if (isCallee(node)) return;

  const isStatus = member === 'status';
  if (!isStatus && !STATE_READS.has(member)) return;
  if (!isKnownReceiver(node.expression, formNames)) return;

  if (isStatus) {
    out.push({
      construct: 'AbstractControl.status',
      node,
      classification: 'judgment',
      reason:
        'status was a string union (VALID / INVALID / PENDING / DISABLED). Signal Forms ' +
        'exposes separate boolean signals instead, so comparisons against the string have ' +
        'to be rewritten as valid() / invalid() / pending() checks.',
    });
    return;
  }

  // `.controls` splits: naming one control is a rename, enumerating the map is not.
  // The field tree is a typed object, so there is no string-keyed map to iterate.
  const enumerated = member === 'controls' && !isNamedControlAccess(node);

  out.push({
    construct: `AbstractControl.${member}`,
    node,
    classification: enumerated ? 'judgment' : 'mechanical',
    reason: enumerated
      ? 'The whole controls map is being enumerated (Object.keys/entries, a loop, or passed ' +
        'along). The field tree is a typed object rather than a string-keyed map, so there ' +
        'is nothing to enumerate — the surrounding loop must be restructured.'
      : `${member} is read off the form object. On the field tree the same state is a ` +
        `signal reached by calling the field first: form.${member} becomes f().${member}(), ` +
        'and the whole-form value is the model signal itself.',
  });
}

/** True for `form.controls.email` and `form.controls['email']` — one named control. */
function isNamedControlAccess(node: ts.PropertyAccessExpression): boolean {
  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) return true;
  return (
    ts.isElementAccessExpression(parent) &&
    parent.expression === node &&
    ts.isStringLiteralLike(parent.argumentExpression)
  );
}

/** True when this property access is the callee of a call, i.e. `x.foo()` rather than `x.foo`. */
function isCallee(node: ts.PropertyAccessExpression): boolean {
  const parent: ts.Node | undefined = node.parent;
  return parent !== undefined && ts.isCallExpression(parent) && parent.expression === node;
}

/**
 * `form.patchValue(...)`, `form.markAllAsTouched()`, `form.reset()` and friends.
 *
 * Split by whether the intent survives: value writes and reset() have a Signal Forms home,
 * while the markAs / setErrors / enable family does not — state there is derived from
 * rules, so the call has to be replaced by a rule or by submission behaviour.
 */
function collectFromControlApi(
  node: ts.CallExpression,
  formNames: ReadonlySet<string>,
  out: FindingDraft[],
): void {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return;

  const method = declaredName(callee.name);
  if (method === undefined) return;

  const mechanical = CONTROL_WRITES_MECHANICAL.has(method);
  const judgment = CONTROL_WRITES_JUDGMENT.has(method);
  if (!mechanical && !judgment) return;
  if (!isKnownReceiver(callee.expression, formNames)) return;

  out.push({
    construct: `AbstractControl.${method}`,
    node,
    classification: mechanical ? 'mechanical' : 'judgment',
    reason: mechanical
      ? `${method}() writes through the form object. In Signal Forms the model signal is the ` +
        'source of truth, so value writes go to the model (or to a field via ' +
        'value.set()); reset() exists on field state and also clears touched/dirty.'
      : `${method}() has no Signal Forms counterpart. Interaction and validity state are ` +
        'DERIVED from schema rules and submission, not set imperatively, so this call is ' +
        'replaced by a rule (disabled/applyWhen), by submit(), or removed entirely.',
  });
}

/** True for `new FormArray([])` — an array whose contents arrive later. */
function isEmptyArrayArgument(node: ts.NewExpression): boolean {
  const [first] = node.arguments ?? [];
  return first !== undefined && ts.isArrayLiteralExpression(first) && first.elements.length === 0;
}

/**
 * `form.addControl(...)`, `items.push(...)` and friends — imperative reshaping of a form.
 *
 * Signal Forms has no equivalent: the field tree is derived from the model signal's type,
 * so a form whose shape changes at runtime has to be re-expressed as data in the model
 * (an array you update, or a field made conditional with hidden()/applyWhen()).
 */
function collectFromShapeMutation(
  node: ts.CallExpression,
  formNames: ReadonlySet<string>,
  out: FindingDraft[],
): void {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return;

  const method = declaredName(callee.name);
  if (method === undefined) return;

  const isGroupMutator = GROUP_MUTATORS.has(method);
  const isArrayMutator = ARRAY_MUTATORS.has(method);
  if (!isGroupMutator && !isArrayMutator) return;

  // Without this gate, any `push` in a forms file would be reported.
  if (!isKnownReceiver(callee.expression, formNames)) return;

  // `setControl` exists on both; attribute it to the array only when the receiver is not
  // group-shaped, which we cannot know without a TypeChecker — so prefer the group name.
  const owner = isGroupMutator ? 'FormGroup' : 'FormArray';

  out.push({
    construct: `${owner}.${method}`,
    node,
    classification: 'judgment',
    reason:
      `${method}() reshapes the form at runtime. Signal Forms derives its field tree from ` +
      'the model signal, so there is no imperative equivalent — the shape must become data ' +
      'in the model (a list you update, or a field gated by hidden()/applyWhen()).',
  });
}

/** `new FormControl('', { asyncValidators: [...] })` and the fb.group equivalent. */
function collectFromAsyncValidatorsOption(node: ts.PropertyAssignment, out: FindingDraft[]): void {
  if (declaredName(node.name) !== 'asyncValidators') return;
  out.push({
    construct: 'asyncValidator',
    node,
    classification: 'judgment',
    reason:
      'Async validation is expressed declaratively in Signal Forms with validateHttp() or ' +
      'validateAsync() inside the schema, and only runs once synchronous rules pass. The ' +
      'validator body, its error shape and its cancellation behaviour all change.',
  });
}

/**
 * A custom validator that is NOT annotated `ValidatorFn` — the shape real code uses for
 * cross-field checks, e.g. `passwordMatchValidator(group: FormGroup)`. Missing these makes
 * a file look 100% mechanical when it contains the only judgment call in the migration.
 */
function collectCustomValidatorDeclaration(
  node: ts.SignatureDeclaration,
  out: FindingDraft[],
): void {
  // The factory pattern `static x(): ValidatorFn { return (c: AbstractControl) => ... }`
  // is already reported at the ValidatorFn annotation; don't report the inner arrow too.
  if (hasValidatorAncestor(node)) return;

  const parameterTypes = node.parameters.map((parameter) => typeReferenceName(parameter.type));
  const takesAbstractControl = parameterTypes.includes('AbstractControl');
  const takesControl = parameterTypes.some((name) => name !== undefined && CONTROL_TYPES.has(name));

  const name = functionLikeName(node);
  const namedLikeValidator = name !== undefined && /validat/i.test(name);

  // An AbstractControl parameter is validator-shaped on its own. Any other control type
  // needs the name to agree, or ordinary helpers taking a FormGroup would be swept in.
  if (!takesAbstractControl && !(takesControl && namedLikeValidator)) return;

  out.push({
    construct: 'customValidator',
    node,
    classification: 'judgment',
    reason:
      'A custom validator must be rewritten against the Signal Forms validation API; the ' +
      'control argument and the error shape both change. Cross-field checks additionally ' +
      'move from the group to a rule on a specific path.',
  });
}

function hasValidatorAncestor(node: ts.Node): boolean {
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
    if (!ts.isFunctionLike(parent)) continue;
    const returnType = typeReferenceName(parent.type);
    if (returnType === 'ValidatorFn' || returnType === 'AsyncValidatorFn') return true;
    if (parent.parameters.some((p) => typeReferenceName(p.type) === 'AbstractControl')) return true;
  }
  return false;
}

function functionLikeName(node: ts.SignatureDeclaration): string | undefined {
  if (node.name !== undefined) return declaredName(node.name);
  // Arrow functions and function expressions borrow the name they are assigned to.
  const parent: ts.Node | undefined = node.parent;
  if (parent !== undefined && ts.isVariableDeclaration(parent)) return declaredName(parent.name);
  return undefined;
}

function typeReferenceName(type: ts.TypeNode | undefined): string | undefined {
  if (type === undefined || !ts.isTypeReferenceNode(type)) return undefined;
  return ts.isIdentifier(type.typeName) ? type.typeName.text : undefined;
}

function collectFromNewExpression(
  node: ts.NewExpression,
  names: BoundNames,
  out: FindingDraft[],
): void {
  if (!ts.isIdentifier(node.expression)) return;
  const constructName = node.expression.text;

  if (constructName === 'FormArray') {
    const owner = assignedName(node);
    const mutated = owner !== undefined && names.mutated.has(owner);
    // An array that starts empty is populated at runtime, which is the same problem.
    const startsEmpty = isEmptyArrayArgument(node);
    const dynamic = mutated || startsEmpty;

    out.push({
      construct: 'FormArray',
      node,
      classification: dynamic ? 'judgment' : 'mechanical',
      reason: dynamic
        ? 'This FormArray is populated or resized at runtime. Signal Forms derives the field ' +
          'tree from the model signal, so the list becomes a plain array in the model that you ' +
          'grow with model.update(...) — a design change, not a rename.'
        : 'A statically-populated FormArray becomes a plain array in the model signal, with ' +
          'per-item rules applied through applyEach().',
    });
    return;
  }

  if (constructName === 'FormControl') {
    out.push({
      construct: 'FormControl',
      node,
      classification: 'mechanical',
      reason:
        'A standalone FormControl becomes a writable signal holding the value, wrapped by form().',
    });
    return;
  }

  if (constructName === 'FormGroup') {
    const nested = containsNestedCollection(node);
    out.push({
      construct: 'FormGroup',
      node,
      classification: nested ? 'judgment' : 'mechanical',
      reason: nested
        ? 'This FormGroup nests a FormArray or child group; the model shape must be designed by hand.'
        : 'A flat FormGroup becomes one signal holding the whole model object, wrapped by form().',
    });
  }
}

/**
 * Classification guard only. FormArray is not a reported M1 construct (it lands in
 * M2), but a group that contains one must never be labelled "mechanical".
 */
function containsNestedCollection(node: ts.NewExpression): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) return;
    if (ts.isNewExpression(child) && ts.isIdentifier(child.expression)) {
      if (child.expression.text === 'FormArray' || child.expression.text === 'FormGroup') {
        if (child !== node) found = true;
      }
    }
    if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression)) {
      const method = declaredName(child.expression.name);
      if (method === 'array') found = true;
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

function collectFromFormBuilderCall(
  node: ts.CallExpression,
  formBuilderNames: ReadonlySet<string>,
  out: FindingDraft[],
): void {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return;

  const method = declaredName(callee.name);
  if (method !== 'group' && method !== 'control' && method !== 'array') return;
  if (!isKnownReceiver(callee.expression, formBuilderNames)) return;

  if (method === 'array') {
    out.push({
      construct: 'FormBuilder.array',
      node,
      classification: 'judgment',
      reason:
        'fb.array(...) becomes a plain array in the model signal, with per-item rules applied ' +
        'through applyEach(). Because array contents are usually built at runtime, the model ' +
        'shape is a design decision rather than a rename.',
    });
    return;
  }

  if (method === 'control') {
    out.push({
      construct: 'FormBuilder.control',
      node,
      classification: 'mechanical',
      reason: 'fb.control(...) becomes a plain signal field on the model object.',
    });
    return;
  }

  const nested = containsNestedFormBuilderCollection(node);
  out.push({
    construct: 'FormBuilder.group',
    node,
    classification: nested ? 'judgment' : 'mechanical',
    reason: nested
      ? 'This group nests an array or child group; the model shape must be designed by hand.'
      : 'fb.group({...}) becomes one signal holding the model object, wrapped by form().',
  });
}

function containsNestedFormBuilderCollection(node: ts.CallExpression): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression)) {
      const method = declaredName(child.expression.name);
      if (method === 'array' || (method === 'group' && child !== node)) found = true;
    }
    if (ts.isNewExpression(child) && ts.isIdentifier(child.expression)) {
      if (child.expression.text === 'FormArray' || child.expression.text === 'FormGroup') {
        found = true;
      }
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

/** Matches a bound name used bare (`fb.group()`) or through this (`this.fb.group()`). */
function isKnownReceiver(receiver: ts.Node, names: ReadonlySet<string>): boolean {
  if (ts.isIdentifier(receiver)) return names.has(receiver.text);
  if (
    ts.isPropertyAccessExpression(receiver) &&
    receiver.expression.kind === ts.SyntaxKind.ThisKeyword
  ) {
    const name = declaredName(receiver.name);
    return name !== undefined && names.has(name);
  }
  return false;
}

function collectFromPropertyAccess(node: ts.PropertyAccessExpression, out: FindingDraft[]): void {
  const property = declaredName(node.name);
  if (property === undefined) return;

  // Validators.<name>
  if (ts.isIdentifier(node.expression) && node.expression.text === 'Validators') {
    const mechanical = MECHANICAL_VALIDATORS.has(property);
    out.push({
      construct: `Validators.${property}`,
      node,
      classification: mechanical ? 'mechanical' : 'judgment',
      reason: mechanical
        ? `Validators.${property} has a direct Signal Forms counterpart applied inside the schema.`
        : `Validators.${property} has no direct counterpart; the validation must be re-expressed by hand.`,
    });
    return;
  }

  if (property === 'valueChanges' || property === 'statusChanges') {
    collectFromFormStream(node, property, out);
  }
}

/** Which tier a form stream's operator chain falls into. */
type StreamTier = 'trivial' | 'moderate' | 'hard';

/**
 * Walks the `.pipe(...)` chain hanging off a form stream and grades it.
 *
 * The hardest operator present decides the tier: a chain that ends in switchMap is a
 * switchMap problem no matter how many maps precede it.
 */
function collectFromFormStream(
  node: ts.PropertyAccessExpression,
  property: 'valueChanges' | 'statusChanges',
  out: FindingDraft[],
): void {
  const operators = pipedOperators(node);
  const hard = operators.filter((name) => HARD_OPERATORS.has(name));
  const moderate = operators.filter((name) => MODERATE_OPERATORS.has(name));

  const tier: StreamTier = hard.length > 0 ? 'hard' : moderate.length > 0 ? 'moderate' : 'trivial';
  const listed = [...new Set(tier === 'hard' ? hard : moderate)].join(', ');

  // Distinct constructs so each tier can carry its own recipe, and so the complexity
  // breakdown separates "a subscribe" from "a switchMap pipeline".
  const construct =
    tier === 'trivial'
      ? property
      : tier === 'moderate'
        ? `${property}Pipeline`
        : `${property}AsyncPipeline`;

  const reason =
    tier === 'trivial'
      ? `${property} with no operator chain — the trivial tier. The stream becomes the ` +
        "field's own value signal; a bare subscribe becomes a computed() for derived state, " +
        'or an effect() when the body genuinely performs a side effect.'
      : tier === 'moderate'
        ? `${property} piped through ${listed} — the moderate tier. These are value ` +
          'transforms with signal equivalents (computed(), and the debounce() schema rule), ' +
          'but the rewrite is a redesign rather than an operator-for-operator swap.'
        : `${property} piped through ${listed} — the hard tier. These operators coordinate ` +
          'other async sources and have NO direct signal equivalent. Either keep the ' +
          'Observable via toObservable()/toSignal(), or restructure around resource().';

  out.push({ construct, node, classification: 'judgment', reason });
}

/**
 * Operator names inside `.pipe(...)` applied to `node`.
 *
 * Only looks at the pipe attached directly to this stream, so it cannot stray into
 * unrelated RxJS elsewhere in the file.
 */
function pipedOperators(node: ts.PropertyAccessExpression): string[] {
  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined || !ts.isPropertyAccessExpression(parent)) return [];
  if (declaredName(parent.name) !== 'pipe') return [];

  const call: ts.Node | undefined = parent.parent;
  if (call === undefined || !ts.isCallExpression(call)) return [];

  const names: string[] = [];
  for (const argument of call.arguments) {
    // Operators are call expressions: debounceTime(300), map(fn), distinctUntilChanged().
    if (ts.isCallExpression(argument) && ts.isIdentifier(argument.expression)) {
      names.push(argument.expression.text);
    } else if (ts.isIdentifier(argument)) {
      names.push(argument.text);
    }
  }
  return names;
}

function collectFromTypeReference(node: ts.TypeReferenceNode, out: FindingDraft[]): void {
  if (!ts.isIdentifier(node.typeName)) return;
  const typeName = node.typeName.text;

  if (typeName === 'AsyncValidatorFn') {
    out.push({
      construct: 'asyncValidator',
      node,
      classification: 'judgment',
      reason:
        'An AsyncValidatorFn becomes validateHttp() or validateAsync() inside the schema. ' +
        'These run only after synchronous rules pass, cancel automatically on value change, ' +
        'and report through pending()/errors() — the control flow is not a transliteration.',
    });
    return;
  }

  if (typeName === 'ValidatorFn') {
    out.push({
      construct: 'customValidator',
      node,
      classification: 'judgment',
      reason:
        'A custom ValidatorFn must be rewritten against the Signal Forms validation API; ' +
        'the control argument and the error shape both change.',
    });
    return;
  }

  // A form is very often only ever *declared* by its type (`loginForm: FormGroup;`) and
  // built later through FormBuilder, so type position is real usage, not a duplicate.
  if (!REPORTED_CONTROL_TYPES.has(typeName)) return;

  // Parameter position means a function signature — a validator or helper receiving a
  // control, not a form declaration. Those are reported as customValidator instead.
  if (node.parent !== undefined && ts.isParameter(node.parent)) return;

  out.push({
    construct: typeName,
    node,
    classification: 'mechanical',
    reason:
      `The ${typeName} type annotation disappears: the field tree returned by form() is ` +
      'typed from the model signal, so the declared type is inferred rather than written.',
  });
}

function collectFormBuilderInjection(node: ts.ParameterDeclaration, out: FindingDraft[]): void {
  if (!isFormBuilderType(node.type)) return;
  out.push({
    construct: 'FormBuilder',
    node,
    classification: 'mechanical',
    reason:
      'FormBuilder has no Signal Forms equivalent — the injection is deleted once its ' +
      'group/control calls are replaced by a model signal.',
  });
}

/* -------------------------------------------------------------------------- */
/* Draft -> Finding                                                            */
/* -------------------------------------------------------------------------- */

const MAX_SNIPPET_LENGTH = 200;

function materialise(drafts: FindingDraft[], sourceFile: ts.SourceFile, text: string): Finding[] {
  const lines = text.split(/\r?\n/);
  const seen = new Set<string>();
  const findings: Finding[] = [];

  for (const draft of drafts) {
    const position = sourceFile.getLineAndCharacterOfPosition(draft.node.getStart(sourceFile));
    const line = position.line + 1;

    // One finding per (construct, line): `Validators.required` twice on one line is one fact.
    const key = `${draft.construct}@${String(line)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const rawSnippet = (lines[position.line] ?? '').trim();
    findings.push({
      construct: draft.construct,
      line,
      snippet:
        rawSnippet.length > MAX_SNIPPET_LENGTH
          ? `${rawSnippet.slice(0, MAX_SNIPPET_LENGTH)}…`
          : rawSnippet,
      classification: draft.classification,
      reason: draft.reason,
    });
  }

  findings.sort((a, b) => a.line - b.line || a.construct.localeCompare(b.construct));
  return findings;
}

/* -------------------------------------------------------------------------- */
/* Entry point — file or directory                                             */
/* -------------------------------------------------------------------------- */

/**
 * Scans a `.ts` file or a directory tree for Reactive Forms constructs.
 *
 * Returns a `Result`; an unreadable path is an `err`, never a thrown exception.
 * Files that fail to read individually are skipped rather than failing the run —
 * one permission-denied file should not sink a whole workspace scan.
 */
export function findFormCandidates(
  rootPath: string,
  fileSystem: FileSystemPort,
): Result<FileFindings[]> {
  if (!fileSystem.exists(rootPath)) {
    return err(`Path does not exist: ${rootPath}`);
  }

  let files: string[];
  try {
    files = fileSystem.isDirectory(rootPath) ? collectFiles(rootPath, fileSystem) : [rootPath];
  } catch (cause) {
    return err(`Failed to read directory ${rootPath}: ${describe(cause)}`);
  }

  const scannable = files.filter((file) => isScannableFile(file));
  if (scannable.length === 0) {
    return ok([]);
  }

  const results: FileFindings[] = [];
  for (const file of scannable) {
    let text: string;
    try {
      text = fileSystem.readFile(file);
    } catch {
      continue; // Unreadable single file: skip, keep scanning.
    }
    const findings = detectInSource(file, text);
    if (findings.length > 0) results.push({ file, findings });
  }

  results.sort((a, b) => a.file.localeCompare(b.file));
  return ok(results);
}

function collectFiles(directory: string, fileSystem: FileSystemPort): string[] {
  const found: string[] = [];
  const queue: string[] = [directory];

  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) break;

    let entries: readonly string[];
    try {
      entries = fileSystem.readDir(current);
    } catch {
      continue; // Unreadable subdirectory: skip, keep scanning.
    }

    for (const entry of entries) {
      if (fileSystem.isDirectory(entry)) {
        if (!SKIPPED_DIRECTORIES.has(baseName(entry))) queue.push(entry);
      } else if (isScannableFile(entry)) {
        found.push(entry);
      }
    }
  }

  return found;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
