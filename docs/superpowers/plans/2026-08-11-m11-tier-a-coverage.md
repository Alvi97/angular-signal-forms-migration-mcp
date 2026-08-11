# M11 Tier A Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three detection gaps that cause files to be scanned and silently under-reported.

**Architecture:** All three work inside the existing single-file `ts.createSourceFile` parse. No `ts.Program`, no new I/O, core stays pure. Aliases resolve through a per-file map consulted at every bare-symbol match; inline templates reuse the M7 token scanner with a line offset; destructured controls join the existing form-name set.

**Tech Stack:** TypeScript 5.9 strict, vitest 4, TypeScript compiler API.

## Global Constraints

Design doc: `docs/superpowers/specs/2026-08-11-tier-a-coverage-design.md`.

- **Never edits user code.** No task adds a write path.
- **Verified facts** (re-derive if Angular is bumped): `FieldTree<TModel>` is callable ∩ `Subfields<TModel>` (`_structure-chunk.d.ts:208`); a held field whose key leaves its parent throws NG01902 (`_validation_errors-chunk.mjs:1121`); `@Component.template` current (`angular.dev/api/core/Component#template_3`).
- Strict TS: no `any`, no `!`, explicit return types on exports.
- Definition of done: `npm run check`, `npm run docs:audit`, `npm run verify:recipes` all green; ROADMAP updated; commit.
- **Coverage increases will move corpus counts.** Update expectations; never relax an invariant to keep an old number.

## File Structure

| File | Responsibility |
|---|---|
| `src/core/detect.ts` | alias map + `canonical()` at 15 sites; inline-template pass; destructuring binding |
| `test/detect-aliases.test.ts` | **new** — differential test: aliased ≡ unaliased |
| `test/detect-inline-template.test.ts` | **new** — constructs + absolute line numbers + substitution skip |
| `test/detect-shadowing.test.ts` | extend — destructured uses found; non-form destructuring still ignored |
| `src/core/recipes.ts` | NG01902 orphan caveat on `formStateRead` |
| `ROADMAP.md` | stop attributing these three to `ts.Program` |

---

### Task 1: Named import aliases

**Files:**
- Modify: `src/core/detect.ts`
- Test: `test/detect-aliases.test.ts` (create)

**Interfaces:**
- Produces (module-private): `collectFormsAliases(sourceFile): ReadonlyMap<string,string>`, and a `canonical(name, aliases)` helper.
- The alias map is threaded the same way `BoundNames` already is.

- [ ] **Step 1: Write the differential test**

Create `test/detect-aliases.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { detectInSource } from '../src/core/detect.js';

/** Rewrites an @angular/forms import to use aliases, and every use site with it. */
const ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['FormBuilder', 'FB'],
  ['FormGroup', 'FG'],
  ['FormControl', 'FC'],
  ['FormArray', 'FA'],
  ['Validators', 'V'],
  ['ControlValueAccessor', 'CVA'],
  ['AbstractControl', 'AC'],
];

function withAliasedImports(source: string): string {
  let out = source;
  for (const [real, alias] of ALIASES) {
    out = out.replace(new RegExp(`\\b${real}\\b`, 'g'), alias);
  }
  // Restore the import clause to `Real as Alias` form.
  return out.replace(/import \{([^}]+)\} from '@angular\/forms'/, (_m, names: string) => {
    const restored = names
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n.length > 0)
      .map((n) => {
        const pair = ALIASES.find(([, alias]) => alias === n);
        return pair === undefined ? n : `${pair[0]} as ${pair[1]}`;
      })
      .join(', ');
    return `import { ${restored} } from '@angular/forms'`;
  });
}

const constructsOf = (source: string, file = '/a.ts'): string[] =>
  detectInSource(file, source)
    .map((f) => f.construct)
    .sort((a, b) => a.localeCompare(b));

const FIXTURES: ReadonlyArray<readonly [string, string]> = [
  [
    'FormBuilder via constructor param',
    `import { FormBuilder, FormGroup, Validators } from '@angular/forms';
export class A {
  constructor(private fb: FormBuilder) {}
  form: FormGroup = this.fb.group({ email: ['', Validators.required] });
  read() { return this.form.get('email'); }
}`,
  ],
  [
    'FormBuilder via inject()',
    `import { FormBuilder, Validators } from '@angular/forms';
import { inject } from '@angular/core';
export class B {
  private fb = inject(FormBuilder);
  form = this.fb.group({ name: ['', Validators.minLength(2)] });
}`,
  ],
  [
    'constructed types and arrays',
    `import { FormGroup, FormControl, FormArray, Validators } from '@angular/forms';
export class C {
  form = new FormGroup({
    email: new FormControl('', Validators.email),
    items: new FormArray([new FormControl('')]),
  });
  add() { (this.form.get('items') as FormArray).push(new FormControl('')); }
}`,
  ],
  [
    'ControlValueAccessor and a type-position control',
    `import { ControlValueAccessor, AbstractControl } from '@angular/forms';
export class D implements ControlValueAccessor {
  writeValue(v: unknown): void {}
  registerOnChange(fn: () => void): void {}
  registerOnTouched(fn: () => void): void {}
  check(c: AbstractControl): unknown { return c.value; }
}`,
  ],
];

describe('an import alias does not change what is detected', () => {
  it.each(FIXTURES)('%s', (_name, source) => {
    expect(constructsOf(withAliasedImports(source))).toEqual(constructsOf(source));
  });

  it('the fixtures actually detect something (guards a vacuous pass)', () => {
    for (const [name, source] of FIXTURES) {
      expect(constructsOf(source).length, name).toBeGreaterThan(1);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run test/detect-aliases.test.ts
```

Expected: FAIL on most fixtures — aliased versions report fewer constructs.

- [ ] **Step 3: Add the alias map**

In `src/core/detect.ts`, near `importsAngularForms`:

```ts
/**
 * `import { FormGroup as FG }` -> Map { 'FG' => 'FormGroup' }.
 *
 * The import gate only reads the module specifier, so an aliased file is scanned and then
 * matches almost nothing: every name table compares against the canonical spelling. Measured
 * before this existed: an aliased component reported 1 of its 5 constructs.
 */
function collectFormsAliases(sourceFile: ts.SourceFile): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!statement.moduleSpecifier.text.startsWith('@angular/forms')) continue;

    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;

    for (const element of bindings.elements) {
      if (element.propertyName === undefined) continue;
      aliases.set(element.name.text, element.propertyName.text);
    }
  }
  return aliases;
}

/** The imported name a local identifier stands for. Identity when it is not an alias. */
function canonical(name: string, aliases: ReadonlyMap<string, string>): string {
  return aliases.get(name) ?? name;
}
```

- [ ] **Step 4: Thread the map and apply it at all 15 sites**

Add `aliases` to `BoundNames` (it is already built once per file and passed to pass 2), then wrap each site listed in the design doc:

- Set membership (13): `:410`, `:480`, `:492`, `:902`, `:933`, `:1366`, `:984`, `:1018`, `:1038`, `:1110`, `:1253`, `:600`.
- Suffix match (2): `isFormBuilderType` `:527` and `isInjectFormBuilder` `:543` — both test `.endsWith('FormBuilder')`, so they need `canonical(...)` applied *before* the suffix test.

Line numbers are pre-edit; re-locate by the predicate, not the number.

- [ ] **Step 5: Run the differential test**

```bash
npx vitest run test/detect-aliases.test.ts
```

Expected: PASS. A remaining failure names the site still unwrapped — fix it rather than narrowing the fixture.

- [ ] **Step 6: Run the full suite and commit**

```bash
npm run check
git add src/core/detect.ts test/detect-aliases.test.ts
git commit -m "An import alias no longer hides 80% of a file's findings"
```

---

### Task 2: Inline `template:` strings

**Files:**
- Modify: `src/core/detect.ts`
- Test: `test/detect-inline-template.test.ts` (create)

**Interfaces:**
- Consumes: `detectInTemplate(filePath, text)` — the M7 scanner, unchanged.
- Produces (module-private): `collectInlineTemplates(sourceFile, filePath): FindingDraft[]`-equivalent, merged into `detectInSource`'s output.

- [ ] **Step 1: Write the failing test**

Create `test/detect-inline-template.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { detectInSource } from '../src/core/detect.js';

const INLINE = `import { Component } from '@angular/core';
import { FormGroup, FormControl } from '@angular/forms';

@Component({
  selector: 'app-x',
  template: \`<form [formGroup]="form">
    <input formControlName="email" required />
    <div formArrayName="items"></div>
  </form>\`,
})
export class X {
  form = new FormGroup({ email: new FormControl('') });
}`;

describe('inline templates are scanned', () => {
  const findings = detectInSource('/x.component.ts', INLINE);
  const templateFindings = findings.filter((f) => f.construct.startsWith('Template.'));

  it('reports the binding family from the inline template', () => {
    const constructs = templateFindings.map((f) => f.construct);
    expect(constructs).toContain('Template.formGroup');
    expect(constructs).toContain('Template.formControlName');
    expect(constructs).toContain('Template.formArrayName');
    expect(constructs).toContain('Template.nativeAttribute');
  });

  it('reports lines absolute to the .ts file, not relative to the template', () => {
    // `<form [formGroup]=...>` is on line 6 of the source above.
    const formGroup = templateFindings.find((f) => f.construct === 'Template.formGroup');
    expect(formGroup?.line).toBe(6);
    // formControlName is on line 7.
    const controlName = templateFindings.find((f) => f.construct === 'Template.formControlName');
    expect(controlName?.line).toBe(7);
  });

  it('still reports the TypeScript constructs in the same file', () => {
    expect(findings.map((f) => f.construct)).toContain('FormGroup');
  });
});

describe('a template with substitutions is skipped, not mis-reported', () => {
  const SUBSTITUTED = `import { Component } from '@angular/core';
import { FormGroup } from '@angular/forms';
const partial = '<input formControlName="a" />';
@Component({ template: \`<form [formGroup]="form">\${partial}</form>\` })
export class Y { form = new FormGroup({}); }`;

  it('reports no Template.* findings rather than wrong line numbers', () => {
    const findings = detectInSource('/y.component.ts', SUBSTITUTED);
    expect(findings.filter((f) => f.construct.startsWith('Template.'))).toHaveLength(0);
  });

  it('still reports the TypeScript constructs', () => {
    const findings = detectInSource('/y.component.ts', SUBSTITUTED);
    expect(findings.map((f) => f.construct)).toContain('FormGroup');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/detect-inline-template.test.ts
```

Expected: FAIL — zero `Template.*` findings today.

- [ ] **Step 3: Implement the inline-template pass**

In `src/core/detect.ts`:

```ts
/**
 * Reactive Forms bindings live in inline `template:` strings as often as in .html files, and
 * were invisible: a component with [formGroup], formControlName and formArrayName inline
 * produced zero Template.* findings.
 *
 * A template with ${substitutions} is SKIPPED. Its text is not the text the compiler sees, so
 * any line number would be a guess — and a wrong line is worse than a missing one.
 */
function collectInlineTemplates(sourceFile: ts.SourceFile, filePath: string): Finding[] {
  const out: Finding[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && declaredName(node.name) === 'template') {
      const literal = node.initializer;
      if (ts.isNoSubstitutionTemplateLiteral(literal) || ts.isStringLiteral(literal)) {
        const start = literal.getStart(sourceFile);
        const startLine = ts.getLineAndCharacterOfPosition(sourceFile, start).line + 1;
        for (const finding of detectInTemplate(filePath, literal.text)) {
          out.push({ ...finding, line: startLine + finding.line - 1 });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return out;
}
```

Call it from `detectInSource` and concatenate into the returned findings.

**Line arithmetic:** `literal.text` for a template literal excludes the opening backtick, so
its line 1 is the line the backtick sits on. `startLine + finding.line - 1` is therefore
correct; the test pins it, so trust the test over this note.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run test/detect-inline-template.test.ts && npx vitest run
```

Fix any corpus count changes by updating expectations.

- [ ] **Step 5: Confirm role classification is unchanged**

An inline template must not demote its file to `reference only` — the file still constructs the form. Verify:

```bash
npx vitest run test/ownership.test.ts
```

If it now classifies such a file as reference-only, fix the role logic so a file containing a form construction stays `owner`, and add a test.

- [ ] **Step 6: Commit**

```bash
git add src/core/detect.ts test/detect-inline-template.test.ts
git commit -m "Scan inline template: strings — half a migration lived in them"
```

---

### Task 3: Destructured controls and the orphan caveat

**Files:**
- Modify: `src/core/detect.ts`, `src/core/recipes.ts`
- Test: `test/detect-shadowing.test.ts` (extend)

**Interfaces:**
- Consumes: `isFormDerivedReceiver(receiver, formNames)` — unchanged.
- Produces: destructured names join `BoundNames.forms`.

- [ ] **Step 1: Write the failing test**

Append to `test/detect-shadowing.test.ts`:

```ts
describe('controls destructured off a form are still tracked', () => {
  const findings = detectInSource(
    '/app/destructured.ts',
    `import { FormGroup, FormControl } from '@angular/forms';
     export class Y {
       form = new FormGroup({ email: new FormControl(''), pw: new FormControl('') });
       go(): void {
         const { email, pw } = this.form.controls;
         email.setValue('a');
         pw.markAsTouched();
       }
     }`,
  );
  const constructs = findings.map((f) => f.construct);

  it('reports the uses after the destructuring, not just the destructuring', () => {
    expect(constructs).toContain('AbstractControl.setValue');
    expect(constructs).toContain('AbstractControl.markAsTouched');
  });

  it('still reports the destructuring site itself', () => {
    expect(constructs).toContain('AbstractControl.controls');
  });
});

describe('destructuring a non-form is still ignored', () => {
  it('does not bind names off a Map', () => {
    const findings = detectInSource(
      '/app/map.ts',
      `import { FormGroup } from '@angular/forms';
       export class Z {
         form = new FormGroup({});
         go(): void {
           const { size } = new Map<string, string>();
           console.log(size);
         }
       }`,
    );
    expect(findings.map((f) => f.construct)).not.toContain('AbstractControl.size');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/detect-shadowing.test.ts
```

Expected: the two `setValue` / `markAsTouched` assertions FAIL.

- [ ] **Step 3: Bind destructured names**

In `collectFormLikeNames`'s `visit`, add:

```ts
    // `const { email, pw } = this.form.controls` — the bound names are controls, so uses
    // after this line are edit sites just as `form.controls.email.setValue()` would be.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer !== undefined &&
      isFormDerivedReceiver(node.initializer, names)
    ) {
      for (const element of node.name.elements) {
        const bound = declaredName(element.name);
        if (bound !== undefined) names.add(bound);
      }
    }
```

Order matters: this must run after the form itself is bound, so `collectFormLikeNames` needs a second pass over the file (the existing `bindControlAliases` already establishes that pattern — follow it).

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run test/detect-shadowing.test.ts && npx vitest run
```

- [ ] **Step 5: Add the NG01902 orphan caveat**

In `src/core/recipes.ts`, append to the `formStateRead` recipe's `caveats`:

```ts
        'Destructuring the field tree (`const { email } = f`) TYPECHECKS — subfields are ' +
          'real properties on FieldTree. But the destructured reference is a live view into ' +
          'the parent, not a snapshot: if the model shape changes so that key no longer ' +
          'exists, reading it throws NG01902 "Orphan field" (verified in the shipped guard, ' +
          'not just the error index). Safe for a fixed model; for one whose keys come and ' +
          'go, read through the tree at the point of use.',
```

Add `https://angular.dev/errors/NG01902` to that recipe's `sources`.

- [ ] **Step 6: Run the full gate and commit**

```bash
npm run check && npm run docs:audit && npm run verify:recipes
git add src/core/detect.ts src/core/recipes.ts test/detect-shadowing.test.ts
git commit -m "Track controls destructured off a form, and warn about orphan fields"
```

---

### Task 4: Correct the ROADMAP attribution

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Rewrite the "No TypeChecker" limitation**

It currently implies aliased imports need `ts.Program`. Replace with a statement that separates what was fixed in M11 from what genuinely still needs cross-file type resolution (forms held on domain-model objects; forms arriving through an unannotated intermediate defined in another file).

- [ ] **Step 2: Record M11 under Shipped**

Add an M11 entry naming the three gaps, the measured 80% under-report, and the differential test as the mechanism that keeps alias coverage complete.

- [ ] **Step 3: Final gate and commit**

```bash
npm run check && npm run docs:audit && npm run verify:recipes
git add ROADMAP.md && git commit -m "Record M11 and stop attributing alias misses to ts.Program"
```

## Self-Review

**Spec coverage:** all three Tier A gaps have a task; the NG01902 caveat and the ROADMAP correction are covered by Tasks 3 and 4. Out-of-scope items (namespace imports, local re-binding, `ts.Program`, `FormRecord`) appear in neither, matching the spec.

**Placeholder scan:** no TBD. Task 1 Step 4 references line numbers from the design doc rather than repeating all fifteen edits inline — mitigated by instructing re-location by predicate, and by the differential test that fails on any missed site. Task 2 Step 3's line arithmetic carries an explicit "trust the test over this note".

**Type consistency:** `canonical(name, aliases)` and `collectFormsAliases` match the spec. `detectInTemplate(filePath, text)` matches its existing signature. `isFormDerivedReceiver(receiver, names)` matches. Findings keep canonical construct names throughout, so recipe lookup is untouched.

**Known risk:** Task 3 Step 3 requires a second pass in `collectFormLikeNames`; if the single-pass order turns out to bind destructured names before the form, the test fails loudly rather than silently under-reporting.
