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

  const formBuilderNames = collectFormBuilderNames(sourceFile);
  const drafts: FindingDraft[] = [];

  const visit = (node: ts.Node): void => {
    collectFromNode(node, formBuilderNames, drafts);
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

function collectFromNode(
  node: ts.Node,
  formBuilderNames: ReadonlySet<string>,
  out: FindingDraft[],
): void {
  if (ts.isNewExpression(node)) {
    collectFromNewExpression(node, out);
    return;
  }
  if (ts.isCallExpression(node)) {
    collectFromFormBuilderCall(node, formBuilderNames, out);
    return;
  }
  if (ts.isPropertyAccessExpression(node)) {
    collectFromPropertyAccess(node, out);
    return;
  }
  if (ts.isTypeReferenceNode(node)) {
    collectFromTypeReference(node, out);
    return;
  }
  if (ts.isParameter(node)) {
    collectFormBuilderInjection(node, out);
  }
}

function collectFromNewExpression(node: ts.NewExpression, out: FindingDraft[]): void {
  if (!ts.isIdentifier(node.expression)) return;
  const constructName = node.expression.text;

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
  if (method !== 'group' && method !== 'control') return;
  if (!isFormBuilderReceiver(callee.expression, formBuilderNames)) return;

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

/** Matches both `fb.group(...)` and `this.fb.group(...)`. */
function isFormBuilderReceiver(receiver: ts.Node, formBuilderNames: ReadonlySet<string>): boolean {
  if (ts.isIdentifier(receiver)) return formBuilderNames.has(receiver.text);
  if (
    ts.isPropertyAccessExpression(receiver) &&
    receiver.expression.kind === ts.SyntaxKind.ThisKeyword
  ) {
    const name = declaredName(receiver.name);
    return name !== undefined && formBuilderNames.has(name);
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
    out.push({
      construct: property,
      node,
      classification: 'judgment',
      reason:
        `${property} is an RxJS stream. Signal Forms exposes state as signals, so the ` +
        'surrounding pipeline must be redesigned (computed/effect) rather than translated.',
    });
  }
}

function collectFromTypeReference(node: ts.TypeReferenceNode, out: FindingDraft[]): void {
  if (!ts.isIdentifier(node.typeName)) return;
  if (node.typeName.text !== 'ValidatorFn') return;
  out.push({
    construct: 'customValidator',
    node,
    classification: 'judgment',
    reason:
      'A custom ValidatorFn must be rewritten against the Signal Forms validation API; ' +
      'the control argument and the error shape both change.',
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
