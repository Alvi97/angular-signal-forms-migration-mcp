/**
 * Post-migration verification (pure).
 *
 * Every other tool here reads the BEFORE state and advises. Nothing looked at what the agent
 * actually produced, which is why "mechanical" was an unprovable promise: you cannot show in
 * advance that advice is sufficient, but you can check the result.
 *
 * The organising principle is narrow on purpose: **only check what compiles and is still
 * wrong.** Anything `tsc` already reports is noise in a tool the agent runs after `tsc`. That
 * rule rejected the most obvious candidate — a general `f.invalid` check — because
 * `FieldTree` maps only the model's keys, so a state member accessed straight off the tree is
 * `TS2339` and the build already says so. What ships is the variants the compiler misses.
 */
import ts from 'typescript';
import type { VerifyCheck, VerifyFinding, VerifySeverity } from './types.js';

/**
 * `FieldState` signal members, extracted from the shipped declarations rather than recalled:
 * `verify/node_modules/@angular/forms/types/_structure-chunk.d.ts:265-430`.
 */
const FIELD_STATE_SIGNALS: ReadonlySet<string> = new Set([
  'controlValue',
  'dirty',
  'disabled',
  'disabledReasons',
  'errorSummary',
  'errors',
  'formFieldBindings',
  'hidden',
  'invalid',
  'keyInParent',
  'max',
  'maxLength',
  'min',
  'minLength',
  'name',
  'pattern',
  'pending',
  'readonly',
  'required',
  'submitting',
  'touched',
  'valid',
  'value',
]);

/** `f.email().value.set(v)` is correct: these follow a WritableSignal, not a missed call. */
const WRITABLE_SIGNAL_METHODS: ReadonlySet<string> = new Set(['set', 'update', 'asReadonly']);

/** A signal passed to these is meant to stay uncalled. */
const SIGNAL_CONSUMERS: ReadonlySet<string> = new Set([
  'computed',
  'effect',
  'toObservable',
  'linkedSignal',
  'untracked',
]);

/** Schema rules whose second argument moved from a bare callback to `{ when }` in v22. */
const LOGIC_RULES: ReadonlySet<string> = new Set(['disabled', 'hidden', 'readonly']);

const SIGNALS_ENTRY = '@angular/forms/signals';
const COMPAT_ENTRY = '@angular/forms/signals/compat';

interface FileContext {
  readonly importsSignals: boolean;
  readonly importsCompat: boolean;
  /** Names bound to a `form(...)` / `compatForm(...)` result. */
  readonly formNames: ReadonlySet<string>;
  readonly reactiveImports: ts.ImportDeclaration[];
}

function moduleSpecifier(statement: ts.Statement): string | undefined {
  if (!ts.isImportDeclaration(statement)) return undefined;
  return ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : undefined;
}

function readContext(sourceFile: ts.SourceFile): FileContext {
  let importsSignals = false;
  let importsCompat = false;
  const reactiveImports: ts.ImportDeclaration[] = [];

  for (const statement of sourceFile.statements) {
    const specifier = moduleSpecifier(statement);
    if (specifier === undefined || !ts.isImportDeclaration(statement)) continue;
    if (specifier === COMPAT_ENTRY) importsCompat = true;
    else if (specifier === SIGNALS_ENTRY) importsSignals = true;
    else if (specifier === '@angular/forms') reactiveImports.push(statement);
  }

  const formNames = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) {
      const initializer = node.initializer;
      const name = ts.isIdentifier(node.name) ? node.name.text : undefined;
      if (
        name !== undefined &&
        initializer !== undefined &&
        ts.isCallExpression(initializer) &&
        ts.isIdentifier(initializer.expression) &&
        (initializer.expression.text === 'form' || initializer.expression.text === 'compatForm')
      ) {
        formNames.add(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return { importsSignals, importsCompat, formNames, reactiveImports };
}

/**
 * The name at the root of a property/call chain: `f` in `f.a.b().c` AND in `this.f().invalid`.
 *
 * Handling `this.` is not a nicety — a form is almost always a class field, so without it the
 * root resolves to `this`, matches no bound name, and every check gated on the form name goes
 * silently dead. The first version of this file did exactly that.
 */
function rootIdentifier(node: ts.Node): string | undefined {
  let current: ts.Node = node;
  for (;;) {
    if (ts.isIdentifier(current)) return current.text;
    if (ts.isPropertyAccessExpression(current)) {
      if (current.expression.kind === ts.SyntaxKind.ThisKeyword) return current.name.text;
      current = current.expression;
      continue;
    }
    if (ts.isCallExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isElementAccessExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isNonNullExpression(current) || ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    return undefined;
  }
}

function makeFinding(
  check: VerifyCheck,
  severity: VerifySeverity,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  message: string,
  evidence: string,
): VerifyFinding {
  const start = node.getStart(sourceFile);
  const { line } = ts.getLineAndCharacterOfPosition(sourceFile, start);
  const text = sourceFile.text.split('\n')[line] ?? '';
  return {
    check,
    severity,
    line: line + 1,
    snippet: text.trim().slice(0, 200),
    message,
    evidence,
  };
}

/**
 * `f().invalid` — a Signal read without calling it, so it is always truthy.
 *
 * TS2774 catches this in SOME positions only. Compiled one statement per line against 22.0.7:
 * `if (f().invalid)` and `f().invalid ? a : b` are caught; `if (!f().invalid)`,
 * `while (f().invalid)`, `!!f().invalid` and `f().invalid || false` are NOT. Template
 * interpolation is never caught. This covers the gap, not the whole surface.
 */
function checkSignalNotCalled(
  node: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  context: FileContext,
  out: VerifyFinding[],
): void {
  const name = node.name.text;
  if (!FIELD_STATE_SIGNALS.has(name)) return;
  // The receiver must be a CALL — `f().invalid`, not `f.invalid` (which is TS2339 already).
  if (!ts.isCallExpression(node.expression)) return;

  const root = rootIdentifier(node.expression);
  if (root === undefined || !context.formNames.has(root)) return;

  const parent: ts.Node | undefined = node.parent;

  // Called immediately: `f().invalid()` is correct.
  if (parent !== undefined && ts.isCallExpression(parent) && parent.expression === node) return;

  // `f().value.set(v)` / `.update(fn)` — a WritableSignal, correctly uncalled.
  if (
    parent !== undefined &&
    ts.isPropertyAccessExpression(parent) &&
    WRITABLE_SIGNAL_METHODS.has(parent.name.text)
  ) {
    return;
  }

  // Handed to something that wants the signal itself.
  if (
    parent !== undefined &&
    ts.isCallExpression(parent) &&
    ts.isIdentifier(parent.expression) &&
    SIGNAL_CONSUMERS.has(parent.expression.text)
  ) {
    return;
  }

  out.push(
    makeFinding(
      'signalNotCalled',
      'error',
      node,
      sourceFile,
      `\`${name}\` is a Signal on field state — reading it without calling it yields the ` +
        `signal object, which is always truthy. Write \`.${name}()\`. TypeScript reports this ` +
        'in some positions (TS2774) but not after `!`, inside `while`, or in a template.',
      'verify/node_modules/@angular/forms/types/_structure-chunk.d.ts:265-430',
    ),
  );
}

/** `disabled(path, cb)` — v21's shape. v22 declares it `@deprecated`, so it still compiles. */
function checkDeprecatedLogicShape(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  out: VerifyFinding[],
): void {
  if (!ts.isIdentifier(node.expression)) return;
  const rule = node.expression.text;
  if (!LOGIC_RULES.has(rule)) return;

  const second = node.arguments[1];
  if (second === undefined) return;
  // An identifier cannot be judged without type information, and an object literal is already
  // the modern shape. Refusing to guess beats a false positive.
  if (ts.isIdentifier(second) || ts.isObjectLiteralExpression(second)) return;
  if (!ts.isArrowFunction(second) && !ts.isFunctionExpression(second)) return;

  out.push(
    makeFinding(
      'deprecatedLogicShape',
      'warning',
      node,
      sourceFile,
      `\`${rule}(path, callback)\` is the v21 shape. v22 takes \`${rule}(path, { when: cb })\` ` +
        'and keeps the bare callback only as `@deprecated` — so this compiles, and the build ' +
        'will NOT catch it for you.',
      'verify/node_modules/@angular/forms/types/signals.d.ts:32-40 (disabled), :66-74 (hidden)',
    ),
  );
}

/**
 * `[control]` / `Control` — pre-release naming.
 *
 * Careful: `[field]` / `Field` was NOT a hallucination, it shipped in 21.0.0 and was renamed
 * to `[formField]` / `FormField` by 21.2.19. The message must not claim otherwise. `[control]`
 * appears in no shipped release, yet survives in one v22 JSDoc example
 * (`types/signals.d.ts:50`), which is a plausible source of the mistake.
 */
function checkPreReleaseApiName(
  node: ts.ImportSpecifier,
  sourceFile: ts.SourceFile,
  out: VerifyFinding[],
): void {
  const imported = (node.propertyName ?? node.name).text;
  if (imported !== 'Control' && imported !== 'Field') return;

  const message =
    imported === 'Control'
      ? 'There is no `Control` export in any shipped @angular/forms/signals. The directive is ' +
        '`FormField` / `[formField]`. A `[control]` example survives in one v22 JSDoc block, ' +
        'which is where this name tends to come from.'
      : '`Field` / `[field]` was real in 21.0.0 and was renamed to `FormField` / `[formField]` ' +
        'in 21.2.19. It is not a hallucination — it is out of date.';

  out.push(
    makeFinding(
      'preReleaseApiName',
      'error',
      node,
      sourceFile,
      message,
      'verify/node_modules/@angular/forms/types/_structure-chunk.d.ts:1307 (selector "[formField]")',
    ),
  );
}

/**
 * A signal read in the schema callback's own body.
 *
 * `SchemaImpl.compile()` invokes the schema function once, in a plain try/finally with no
 * `computed` and no `effect` (`fesm2022/_validation_errors-chunk.mjs:514-528`), so
 * `form(m, (p) => { if (isAdmin()) required(p.ssn); })` bakes the value in permanently and
 * compiles clean.
 *
 * Only the callback's OWN body counts. A zero-arg call inside a nested arrow —
 * `validate(p.x, ({ stateOf }) => stateOf(p.y).touched())` — runs per evaluation and is the
 * documented idiom, so excluding it is load-bearing rather than a nicety.
 */
function checkSchemaConstructionTimeRead(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  out: VerifyFinding[],
): void {
  if (!ts.isIdentifier(call.expression) || call.expression.text !== 'form') return;
  const schema = call.arguments[1];
  if (schema === undefined || (!ts.isArrowFunction(schema) && !ts.isFunctionExpression(schema))) {
    return;
  }

  const body = schema.body;
  const visit = (node: ts.Node): void => {
    // Nested functions have their own evaluation time; this check is about the once-only body.
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return;
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 0 &&
      ts.isIdentifier(node.expression)
    ) {
      out.push(
        makeFinding(
          'schemaConstructionTimeRead',
          'warning',
          node,
          sourceFile,
          `\`${node.expression.text}()\` is called directly in the schema body. The schema ` +
            'function runs ONCE, outside any reactive context, so if this is a signal its ' +
            'value is baked in permanently and later changes are ignored. Move the read into ' +
            'a rule callback. This tool cannot tell a signal read from a plain call — if it ' +
            'is not a signal, ignore this.',
          'verify/node_modules/@angular/forms/fesm2022/_validation_errors-chunk.mjs:514-528',
        ),
      );
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
}

/** The initializer of `name` declared in this file, so `form(this.model)` can be followed. */
function initializerOf(sourceFile: ts.SourceFile, name: string): ts.Expression | undefined {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (
      (ts.isPropertyDeclaration(node) || ts.isVariableDeclaration(node)) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer !== undefined
    ) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

/** `form(signal({ a: new FormControl('') }))` typechecks and throws NG01907 on first read. */
function checkControlInSignalFormModel(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  out: VerifyFinding[],
): void {
  if (!ts.isIdentifier(call.expression) || call.expression.text !== 'form') return;
  const argument = call.arguments[0];
  if (argument === undefined) return;

  // The model is nearly always a reference (`form(this.model)`), so the controls live in the
  // signal's initializer rather than in the call. Follow one hop; refuse to guess beyond it.
  const referenced = rootIdentifier(argument);
  const model =
    ts.isCallExpression(argument) || ts.isObjectLiteralExpression(argument)
      ? argument
      : referenced === undefined
        ? undefined
        : initializerOf(sourceFile, referenced);
  if (model === undefined) return;

  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      if (/^(FormControl|FormGroup|FormArray|FormRecord)$/.test(node.expression.text)) found = node;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(model, visit);
  if (found === undefined) return;

  out.push(
    makeFinding(
      'controlInSignalFormModel',
      'error',
      found,
      sourceFile,
      'An AbstractControl inside a `form()` model typechecks — FieldTree has an ' +
        'AbstractControl branch — and throws at the first rule that reads the value: ' +
        "NG01907 \"Tried to read an 'AbstractControl' value from a 'form()'. Did you mean to " +
        "use 'compatForm()' instead?\". Use compatForm(), or finish converting the model.",
      'verify/node_modules/@angular/forms/fesm2022/_validation_errors-chunk.mjs:884',
    ),
  );
}

/** Reactive Forms left behind in a migrated file — unless the compat layer is in use. */
function checkLeftovers(
  sourceFile: ts.SourceFile,
  context: FileContext,
  out: VerifyFinding[],
): void {
  if (context.importsCompat) {
    if (context.reactiveImports.length > 0) {
      const first = context.reactiveImports[0];
      if (first !== undefined) {
        out.push(
          makeFinding(
            'leftoverReactiveForms',
            'info',
            first,
            sourceFile,
            'Interop file — Reactive Forms constructs here are expected while the compat layer ' +
              'is in use. Reported so the silence is not mistaken for a clean bill of health.',
            'verify/node_modules/@angular/forms/types/signals-compat.d.ts:252',
          ),
        );
      }
    }
    return;
  }

  for (const declaration of context.reactiveImports) {
    const clause = declaration.importClause?.namedBindings;
    const names =
      clause !== undefined && ts.isNamedImports(clause)
        ? clause.elements.map((element) => element.name.text)
        : [];

    const moduleImport = names.find((name) => name === 'ReactiveFormsModule');
    if (moduleImport !== undefined) {
      out.push(
        makeFinding(
          'reactiveFormsModuleImport',
          'error',
          declaration,
          sourceFile,
          'ReactiveFormsModule is still imported. A migrated component binds with the ' +
            'standalone `FormField` directive instead; leaving the module in `imports` keeps ' +
            'the old directives live and hides binding mistakes.',
          'verify/node_modules/@angular/forms/types/_structure-chunk.d.ts:1307',
        ),
      );
    }

    const others = names.filter((name) => name !== 'ReactiveFormsModule');
    if (others.length > 0) {
      out.push(
        makeFinding(
          'leftoverReactiveForms',
          'error',
          declaration,
          sourceFile,
          `Still importing ${others.map((n) => `\`${n}\``).join(', ')} from '@angular/forms' in ` +
            'a file that uses Signal Forms. Either finish the conversion, or move to ' +
            "'@angular/forms/signals/compat' so the interop is explicit.",
          "verify/node_modules/@angular/forms/package.json (exports '.', './signals', './signals/compat')",
        ),
      );
    }
  }
}

/** Runs every decidable check over one already-migrated source text. Never throws. */
export function verifyMigratedSource(filePath: string, text: string): VerifyFinding[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );

  const context = readContext(sourceFile);
  // Nothing to verify in a file that has not been migrated at all.
  if (!context.importsSignals && !context.importsCompat) return [];

  const out: VerifyFinding[] = [];
  checkLeftovers(sourceFile, context, out);

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) checkSignalNotCalled(node, sourceFile, context, out);
    if (ts.isCallExpression(node)) {
      checkDeprecatedLogicShape(node, sourceFile, out);
      checkSchemaConstructionTimeRead(node, sourceFile, out);
      checkControlInSignalFormModel(node, sourceFile, out);
    }
    if (ts.isImportSpecifier(node)) checkPreReleaseApiName(node, sourceFile, out);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return out.sort((a, b) => a.line - b.line || a.check.localeCompare(b.check));
}

/** True when a file imports Signal Forms at all, so "not migrated" can be reported honestly. */
export function usesSignalForms(text: string, filePath = 'x.ts'): boolean {
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, false);
  const context = readContext(sourceFile);
  return context.importsSignals || context.importsCompat;
}

/**
 * Checks that exist but cannot run here, with the reason. Silence would read as a pass, which
 * is the failure mode this whole tool was built to remove.
 */
export const ALWAYS_SKIPPED: ReadonlyArray<{ check: VerifyCheck; reason: string }> = [
  {
    check: 'droppedConstraint',
    reason:
      'Not decidable from the migrated file alone. A template attribute that WAS the only ' +
      'statement of a constraint leaves no trace once deleted: the field simply has no rule, ' +
      'which is indistinguishable from the many fields that legitimately have none. Detecting ' +
      'it needs a pre-migration copy to diff against. Shipping a heuristic here would produce ' +
      'confident false positives on ordinary code.',
  },
];

export const VERIFY_DISCLAIMER =
  'This proves the ABSENCE OF KNOWN DEFECTS, not correctness. It is a single-file text scan ' +
  'with no type information and no Angular AST: it cannot see runtime behaviour, cannot check ' +
  'templates, and cannot know whether the migrated form still does what the old one did. A ' +
  'clean result means these specific traps were not found — run the AOT build and the tests.';

/* -------------------------------------------------------------------------- */
/* Workspace scan                                                              */
/* -------------------------------------------------------------------------- */

export interface VerifiedFile {
  readonly file: string;
  readonly findings: readonly VerifyFinding[];
}

export interface VerifyReport {
  readonly files: readonly VerifiedFile[];
  readonly notMigratedFiles: readonly string[];
}

/**
 * Verifies every already-migrated `.ts` file under `rootPath`.
 *
 * Files that import no Signal Forms are listed separately rather than dropped: "nothing to
 * report here" and "this file has not been migrated yet" are different answers, and collapsing
 * them is how a half-finished migration reads as a finished one.
 */
export function verifyMigration(
  files: readonly { readonly file: string; readonly text: string }[],
): VerifyReport {
  const verified: VerifiedFile[] = [];
  const notMigrated: string[] = [];

  for (const entry of files) {
    if (!usesSignalForms(entry.text, entry.file)) {
      notMigrated.push(entry.file);
      continue;
    }
    const findings = verifyMigratedSource(entry.file, entry.text);
    if (findings.length > 0) verified.push({ file: entry.file, findings });
  }

  return { files: verified, notMigratedFiles: notMigrated };
}
