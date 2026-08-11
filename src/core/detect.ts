/**
 * Reactive Forms detection (pure). Parses with the TypeScript compiler API, not a full
 * `ts.Program` (which would need the user's tsconfig and node_modules). Without a
 * TypeChecker, a two-pass scan binds local identifiers to FormBuilder first, then matches
 * calls on those names. Filesystem access is injected via `FileSystemPort`.
 */
import ts from 'typescript';
import { detectInTemplate } from './detect-template.js';
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

/**
 * Spec files are excluded from the migration counts (per SPEC.md); assessCoverage still runs
 * detection over them and the report lists them separately. `.html` templates are scanned.
 */
function isScannableFile(fileName: string): boolean {
  if (fileName.endsWith('.html')) return true;
  if (!fileName.endsWith('.ts') || fileName.endsWith('.d.ts')) return false;
  return !fileName.endsWith('.spec.ts');
}

/** Routes a file to the right detector by extension: templates parse differently from code. */
function detectInFile(filePath: string, text: string): Finding[] {
  return filePath.endsWith('.html')
    ? detectInTemplate(filePath, text)
    : detectInSource(filePath, text);
}

function baseName(pathLike: string): string {
  const segments = pathLike.split(/[\\/]/);
  return segments[segments.length - 1] ?? pathLike;
}

/* -------------------------------------------------------------------------- */
/* Validator classification tables                                             */
/* -------------------------------------------------------------------------- */

/**
 * Built-in validators with a one-to-one Signal Forms counterpart; anything else is judgment.
 * `requiredTrue` maps to `required()`, which treats `false` as missing on both v21 and v22
 * (isEmpty is byte-identical across those releases).
 * https://angular.dev/guide/forms/signals/validation#required
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

/** Types that mark a variable as a Reactive Forms object, so `x.get('k')` isn't a Map lookup. */
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

/** Methods that mutate a form's shape at runtime. No Signal Forms equivalent, so judgment. */
const GROUP_MUTATORS: ReadonlySet<string> = new Set([
  'addControl',
  'removeControl',
  'setControl',
  'registerControl',
]);

/**
 * RxJS operator tiers for a form stream, rooted only at `.valueChanges` / `.statusChanges`.
 * `moderate` operators have a signal equivalent (computed / the debounce() rule); `hard`
 * ones coordinate other async sources and have no direct equivalent.
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

/** State read off a form (`form.invalid` -> `f().invalid()`): mechanical, but real edit sites. */
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
  // `items.length` / `items.controls.length`: the usual "is the list empty?" check.
  'length',
  // Only meaningful next to reset(), whose semantics change.
  'defaultValue',
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
  // These exist on Signal Forms field state (verified against v22). markAllAsTouched maps to
  // markAsTouched(), which covers descendants by default, so it's a rename.
  'markAsTouched',
  'markAsDirty',
  'markAllAsTouched',
]);

/**
 * Predicates read off a control. These are CALLS, so they arrive through the same handler as
 * the writes, but they read state rather than change it and their translation is not a
 * rename: the argument is a Signal Forms error KIND, not the old Reactive error key.
 */
const CONTROL_READ_CALLS: ReadonlySet<string> = new Set(['hasError']);

/**
 * Imperative APIs with NO Signal Forms counterpart. State is derived from rules, so these
 * become schema rules (disabled/applyWhen), submission, or nothing at all.
 */
const CONTROL_WRITES_JUDGMENT: ReadonlySet<string> = new Set([
  'markAsUntouched',
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
  /** Set on findings that construct a form. See `Finding.definesForm`. */
  definesForm?: boolean;
}

/** Detects Reactive Forms constructs in one source text. Never throws; the TS parser is tolerant. */
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

/** Local names bound during pass 1, consumed by pass 2. */
interface BoundNames {
  /** Names holding a FormBuilder, so `fb.group(...)` matches without a TypeChecker. */
  readonly formBuilders: ReadonlySet<string>;
  /** Names holding a form object, so `form.get('k')` differs from `map.get('k')`. */
  readonly forms: ReadonlySet<string>;
  /** Names mutated at runtime; those forms cannot be a static model, so they're judgment. */
  readonly mutated: ReadonlySet<string>;
}

/** Names with a shape-mutating method called on them, which downgrades them to judgment. */
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
 * Names holding a Reactive Forms object, annotated (`profileForm: FormGroup`) or initialised
 * (`= fb.group({...})`). This is what keeps `x.get('key')` from flagging Map/HttpParams lookups.
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

  bindFactoryBuiltForms(sourceFile, names);
  bindControlAliases(sourceFile, names);
  return names;
}

/**
 * Binds `readonly registerForm = this.createRegisterForm();` where the method builds a form.
 * A method counts as a factory only when its body returns a form construction (or another
 * factory), so a `getForm()` returning `this.http.get(...)` is excluded.
 */
function bindFactoryBuiltForms(sourceFile: ts.SourceFile, names: Set<string>): void {
  const factories = new Set<string>();

  // Pass 1: find methods whose return expression is a form construction.
  const collectFactories = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node)) {
      const name = declaredName(node.name);
      if (name !== undefined && methodReturnsForm(node, factories)) factories.add(name);
    }
    ts.forEachChild(node, collectFactories);
  };
  // Repeat to a fixpoint: one factory may call another declared later in the file.
  let before = -1;
  while (factories.size !== before) {
    before = factories.size;
    ts.forEachChild(sourceFile, collectFactories);
  }

  if (factories.size === 0) return;

  // Pass 2: bind fields/vars initialised from `this.<factory>()`.
  const bindFields = (node: ts.Node): void => {
    if (ts.isPropertyDeclaration(node) || ts.isVariableDeclaration(node)) {
      const name = declaredName(node.name);
      if (name !== undefined && !names.has(name) && callsFactory(node.initializer, factories)) {
        names.add(name);
      }
    }
    ts.forEachChild(node, bindFields);
  };
  ts.forEachChild(sourceFile, bindFields);
}

/** True when a method's body contains a `return <form construction>`. */
function methodReturnsForm(node: ts.MethodDeclaration, factories: ReadonlySet<string>): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) return;
    // Nested functions have their own returns, not this method's.
    if (ts.isFunctionDeclaration(child) || ts.isFunctionExpression(child)) return;
    if (ts.isReturnStatement(child) && child.expression !== undefined) {
      if (isFormConstruction(child.expression, factories)) found = true;
    }
    ts.forEachChild(child, visit);
  };
  if (node.body !== undefined) ts.forEachChild(node.body, visit);
  return found;
}

/** `= this.createForm()` — an initializer that is a call to a known factory method. */
function callsFactory(init: ts.Node | undefined, factories: ReadonlySet<string>): boolean {
  if (init === undefined || !ts.isCallExpression(init)) return false;
  const callee = init.expression;
  if (
    ts.isPropertyAccessExpression(callee) &&
    callee.expression.kind === ts.SyntaxKind.ThisKeyword
  ) {
    const method = declaredName(callee.name);
    return method !== undefined && factories.has(method);
  }
  return false;
}

/** `new FormGroup(...)`, `fb.group(...)`, or a call to a known form-factory method. */
function isFormConstruction(expr: ts.Expression, factories: ReadonlySet<string>): boolean {
  const node = unwrapReceiver(expr);
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
    return CONTROL_TYPES.has(node.expression.text);
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const method = declaredName(node.expression.name);
    if (method === 'group' || method === 'array' || method === 'control') return true;
    // A factory delegating to another factory: `return this.buildBase();`
    if (
      method !== undefined &&
      factories.has(method) &&
      node.expression.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Binds the `get email() { return this.loginForm.get('email'); }` accessor idiom, so calls
 * through the alias (`this.email?.setErrors(...)`) are seen. A fixpoint, since one alias may
 * be defined in terms of another.
 */
function bindControlAliases(sourceFile: ts.SourceFile, names: Set<string>): void {
  const candidates: { name: string; expression: ts.Expression }[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isGetAccessorDeclaration(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isVariableDeclaration(node)
    ) {
      const expression = aliasedExpression(node);
      const name = declaredName(node.name);
      if (expression !== undefined && name !== undefined && !names.has(name)) {
        candidates.push({ name, expression });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  // Bounded by the candidate count: each pass either binds one or stops.
  for (let pass = 0; pass < candidates.length; pass++) {
    let bound = false;
    for (const candidate of candidates) {
      if (names.has(candidate.name)) continue;
      if (!isFormDerivedReceiver(candidate.expression, names)) continue;
      names.add(candidate.name);
      bound = true;
    }
    if (!bound) return;
  }
}

/** The single expression a getter returns, or a read-only property's initializer. */
function aliasedExpression(node: ts.Node): ts.Expression | undefined {
  if (ts.isGetAccessorDeclaration(node)) {
    const [statement] = node.body?.statements ?? [];
    if (statement !== undefined && ts.isReturnStatement(statement)) return statement.expression;
    return undefined;
  }
  if (ts.isPropertyDeclaration(node) && node.initializer !== undefined) return node.initializer;
  // Method-local alias (`const phoneControl = this.form.get('phone')`). The fixpoint only
  // binds it when the initializer is provably form-derived, so `const x = svc.load()` doesn't.
  if (ts.isVariableDeclaration(node) && node.initializer !== undefined) return node.initializer;
  return undefined;
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
    collectFromDeadValidatorOption(node, out);
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
 * A ControlValueAccessor component (replaced by FormValueControl / FormCheckboxControl in
 * v22). Reported once per class, since a CVA is recognisable both by `implements` and by the
 * `NG_VALUE_ACCESSOR` provider and real components use both.
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
 * `form.get('email')` and friends: string-keyed lookups reached by dot notation instead.
 * Only matched on form-bound receivers, so `map.get(k)` stays out.
 */
function collectFromControlGet(
  node: ts.CallExpression,
  formNames: ReadonlySet<string>,
  out: FindingDraft[],
): void {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return;
  const method = declaredName(callee.name);
  if (method === undefined || !KEYED_LOOKUPS.has(method)) return;
  if (!isFormDerivedReceiver(callee.expression, formNames)) return;

  const [key] = node.arguments;
  const literalKey = key !== undefined && (ts.isStringLiteralLike(key) || ts.isNumericLiteral(key));

  out.push({
    construct: `AbstractControl.${method}`,
    node,
    classification: literalKey ? 'mechanical' : 'judgment',
    reason: literalKey
      ? (KEYED_LOOKUP_REASONS[method] ?? COMPUTED_KEY_REASON)
      : COMPUTED_KEY_REASON,
  });
}

/** String- or index-keyed lookups into a form (`form.get('k')`, `items.at(i)`). */
const KEYED_LOOKUPS: ReadonlySet<string> = new Set(['get', 'at', 'contains']);

const KEYED_LOOKUP_REASONS: Readonly<Record<string, string>> = {
  get: 'A literal .get("key") becomes dot notation on the field tree (form.key).',
  at:
    'A literal .at(i) becomes index access on the field tree (f.items[i]), which is typed ' +
    'rather than an AbstractControl lookup that could return null.',
  contains:
    'The field tree is a typed object, so membership is known at compile time — a literal ' +
    '.contains("key") is either always true or a type error, and the branch around it ' +
    'usually collapses. If the key was tracking an optional field, model it as an optional ' +
    'property and use hidden()/applyWhen() instead.',
};

const COMPUTED_KEY_REASON =
  'The key is computed, so there is no single field to rewrite to; the surrounding code ' +
  'must be redesigned around the typed field tree.';

/**
 * State read off the form object (`form.invalid`, `form.value`, `form.controls`), each mapping
 * to a signal call (`f().invalid()`), so mechanical. `.status` is judgment: it was a string
 * union with no Signal Forms equivalent.
 */
function collectFromStateRead(
  node: ts.PropertyAccessExpression,
  formNames: ReadonlySet<string>,
  out: FindingDraft[],
): void {
  const member = declaredName(node.name);
  if (member === undefined) return;

  // `form.reset()` is a call (reported elsewhere); don't also count it as a `reset` read.
  if (isCallee(node)) return;

  const isStatus = member === 'status';
  if (!isStatus && !STATE_READS.has(member)) return;
  if (!isFormDerivedReceiver(node.expression, formNames)) return;

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
 * Write calls (`patchValue`, `markAllAsTouched`, `reset`, ...). Value writes and reset() have
 * a Signal Forms home (mechanical); the markAs / setErrors / enable family does not (judgment).
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

  const read = CONTROL_READ_CALLS.has(method);
  const mechanical = read || CONTROL_WRITES_MECHANICAL.has(method);
  const judgment = CONTROL_WRITES_JUDGMENT.has(method);
  if (!mechanical && !judgment) return;
  if (!isFormDerivedReceiver(callee.expression, formNames)) return;

  out.push({
    construct: `AbstractControl.${method}`,
    node,
    classification: mechanical ? 'mechanical' : 'judgment',
    reason: read
      ? readCallReason(method)
      : mechanical
        ? mechanicalWriteReason(method)
        : `${method}() has no Signal Forms counterpart. Interaction and validity state are ` +
          'DERIVED from schema rules and submission, not set imperatively, so this call is ' +
          'replaced by a rule (disabled/applyWhen), by submit(), or removed entirely.',
  });
}

/** The reason string for a predicate read off a control. */
function readCallReason(method: string): string {
  if (method === 'hasError') {
    return (
      'hasError(key) reads state, it does not write. It becomes ' +
      '`f().getError(kind) !== undefined` on field state. The argument is a KIND, not the ' +
      'old error key: `minlength` became `minLength` and `maxlength` became `maxLength`, so ' +
      'a transliterated string compiles and silently never matches.'
    );
  }
  return `${method}() reads state off the form and becomes a field-state signal read.`;
}

/** The reason string for a mechanical write; reset() and markAllAsTouched() carry extra notes. */
function mechanicalWriteReason(method: string): string {
  if (method === 'reset') {
    return (
      'reset() exists on field state, but it needs an argument to do what this call did. ' +
      'Angular documents its value parameter as "if not passed, the value will not be ' +
      'changed", so f().reset() clears touched/dirty and leaves the data. Write ' +
      'f().reset({ ...INITIAL }) unless you only wanted the interaction state cleared.'
    );
  }
  if (method === 'markAllAsTouched') {
    return (
      'markAllAsTouched() becomes f().markAsTouched(), which marks descendants by default. ' +
      'Often it can go entirely: submit() marks every interactive field touched itself.'
    );
  }
  return (
    `${method}() writes through the form object. In Signal Forms the model signal is the ` +
    'source of truth, so value writes go to the model (or to a field via value.set()).'
  );
}

/** True for `new FormArray([])` — an array whose contents arrive later. */
function isEmptyArrayArgument(node: ts.NewExpression): boolean {
  const [first] = node.arguments ?? [];
  return first !== undefined && ts.isArrayLiteralExpression(first) && first.elements.length === 0;
}

/**
 * `form.addControl(...)`, `items.push(...)` and friends: imperative reshaping of a form.
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
  if (!isFormDerivedReceiver(callee.expression, formNames)) return;

  // `setControl` exists on both; without a TypeChecker we can't tell, so prefer the group.
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

/**
 * The singular `{ validator: fn }` key, which AbstractControlOptions does not declare. Only
 * reported for `new FormGroup/FormControl/FormArray`, where Angular drops it; FormBuilder maps
 * the legacy key and is excluded. Verified against @angular/forms@22 source (pickValidators /
 * FormBuilder.group).
 */
function collectFromDeadValidatorOption(node: ts.PropertyAssignment, out: FindingDraft[]): void {
  const key = declaredName(node.name);
  if (key !== 'validator' && key !== 'asyncValidator') return;

  // Only `new FormX(...)`, never fb.group(...).
  if (!isConstructorOptionsObject(node.parent)) return;

  out.push({
    construct: 'deadValidatorOption',
    node,
    classification: 'judgment',
    reason:
      `\`${key}\` is not an AbstractControlOptions key — the plural \`${key}s\` is. ` +
      'Passed to `new FormGroup/FormControl/FormArray`, Angular reads `.validators` off ' +
      'the options object, finds nothing, and this validator never runs. (FormBuilder is ' +
      'NOT affected — fb.group maps the legacy singular key, which is why this is only ' +
      'reported for the constructor form.) Verify at runtime before acting: a faithful ' +
      'migration would carry dead code across, and templates may test for an error that ' +
      'can never appear.',
  });
}

/** True when this object literal is an argument to `new FormGroup/FormControl/FormArray`. */
function isConstructorOptionsObject(node: ts.Node | undefined): boolean {
  if (node === undefined || !ts.isObjectLiteralExpression(node)) return false;

  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined) return false;
  if (!ts.isNewExpression(parent) || !ts.isIdentifier(parent.expression)) return false;
  return CONTROL_TYPES.has(parent.expression.text);
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
 * A custom validator not annotated `ValidatorFn`, e.g. `passwordMatchValidator(group:
 * FormGroup)`. Missing these makes a file look all-mechanical when it holds the one judgment call.
 */
function collectCustomValidatorDeclaration(
  node: ts.SignatureDeclaration,
  out: FindingDraft[],
): void {
  // The factory `static x(): ValidatorFn { return (c) => ... }` is already reported at the
  // annotation; skip the inner arrow.
  if (hasValidatorAncestor(node)) return;

  const parameterTypes = node.parameters.map((parameter) => typeReferenceName(parameter.type));
  const takesAbstractControl = parameterTypes.includes('AbstractControl');
  const takesControl = parameterTypes.some((name) => name !== undefined && CONTROL_TYPES.has(name));

  const name = functionLikeName(node);
  const namedLikeValidator = name !== undefined && /validat/i.test(name);

  // An AbstractControl param is validator-shaped alone; other control types need the name to
  // agree, or ordinary helpers taking a FormGroup get swept in.
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
      definesForm: true,
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
      definesForm: true,
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
      definesForm: true,
      classification: nested ? 'judgment' : 'mechanical',
      reason: nested
        ? 'This FormGroup nests a FormArray or child group; the model shape must be designed by hand.'
        : 'A flat FormGroup becomes one signal holding the whole model object, wrapped by form().',
    });
  }
}

/** True when a FormGroup nests a FormArray or child group, so it can't be "mechanical". */
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
      definesForm: true,
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
      definesForm: true,
      classification: 'mechanical',
      reason: 'fb.control(...) becomes a plain signal field on the model object.',
    });
    return;
  }

  const nested = containsNestedFormBuilderCollection(node);
  out.push({
    construct: 'FormBuilder.group',
    node,
    definesForm: true,
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

/**
 * True for the form object itself and for any single control reached through it, e.g.
 * `this.loginForm.get('password')?.setErrors(...)`. Reactive code usually calls methods on a
 * control fished out of the form, so matching only the bare form name misses those.
 */
function isFormDerivedReceiver(receiver: ts.Node, formNames: ReadonlySet<string>): boolean {
  const node = unwrapReceiver(receiver);
  if (isKnownReceiver(node, formNames)) return true;

  // form.get('email') / items.at(0): one control out of a form-derived expression.
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const method = declaredName(node.expression.name);
    if (method === 'get' || method === 'at') {
      return isFormDerivedReceiver(node.expression.expression, formNames);
    }
    return false;
  }

  // `form.controls` itself (so `form.controls.length` resolves) as well as one control out
  // of it (`form.controls.email`).
  if (ts.isPropertyAccessExpression(node)) {
    return isControlsAccess(node, formNames) || isControlsAccess(node.expression, formNames);
  }
  // form.controls['email']
  if (ts.isElementAccessExpression(node)) {
    return isControlsAccess(node.expression, formNames);
  }
  return false;
}

/** True when `node` is `<formDerived>.controls`. */
function isControlsAccess(node: ts.Node, formNames: ReadonlySet<string>): boolean {
  const inner = unwrapReceiver(node);
  if (!ts.isPropertyAccessExpression(inner)) return false;
  if (declaredName(inner.name) !== 'controls') return false;
  return isFormDerivedReceiver(inner.expression, formNames);
}

/**
 * Strips `!`, parens, `as T` and `satisfies T`, which decorate a receiver without changing
 * what it refers to. The `as` case matters most: `(form.get('items') as FormArray).push(...)`
 * is the dominant idiom, since get() returns AbstractControl | null.
 */
function unwrapReceiver(node: ts.Node): ts.Node {
  let current = node;
  while (
    ts.isNonNullExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
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
 * Grades the `.pipe(...)` chain on a form stream. The hardest operator present sets the tier:
 * a chain containing switchMap is a switchMap problem regardless of the maps before it.
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

  // Distinct constructs so each tier carries its own recipe.
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

/** Operator names inside the `.pipe(...)` attached directly to this stream. */
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

  // A form is often only declared by its type (`loginForm: FormGroup;`) and built later,
  // so type position is real usage.
  if (!REPORTED_CONTROL_TYPES.has(typeName)) return;

  // A parameter type is a validator/helper receiving a control, reported as customValidator.
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

    // One finding per (construct, line).
    const key = `${draft.construct}@${String(line)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const rawSnippet = (lines[position.line] ?? '').trim();
    findings.push({
      definesForm: draft.definesForm === true,
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
 * Scans a file or directory tree for Reactive Forms constructs. Returns a `Result`; an
 * unreadable path is an `err`, and an individually unreadable file is skipped, never thrown.
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
    const findings = detectInFile(file, text);
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
