import { describe, expect, it } from 'vitest';
import { detectInSource } from '../src/core/detect.js';

/**
 * The import gate only reads the module specifier, so an aliased file IS scanned and then
 * matches almost nothing — every name table compares against the canonical spelling.
 * Measured before the fix: an aliased component reported 1 of its 5 constructs, which is the
 * worst failure shape available, since the file appears in the report looking nearly done.
 *
 * Fifteen sites in detect.ts match a bare Angular Forms symbol, in two different styles.
 * Enumerating them by hand failed on the first attempt, so completeness is guaranteed here
 * rather than by reading: the same component, aliased and not, must report identically.
 */
const ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['ControlValueAccessor', 'CVA'],
  ['AbstractControl', 'AC'],
  ['FormBuilder', 'FB'],
  ['FormControl', 'FC'],
  ['FormGroup', 'FG'],
  ['FormArray', 'FA'],
  ['Validators', 'V'],
];

function withAliasedImports(source: string): string {
  let out = source;
  for (const [real, alias] of ALIASES) {
    out = out.replace(new RegExp(`\\b${real}\\b`, 'g'), alias);
  }
  return out.replace(/import \{([^}]+)\} from '@angular\/forms'/, (_match, names: string) => {
    const restored = names
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
      .map((name) => {
        const pair = ALIASES.find(([, alias]) => alias === name);
        return pair === undefined ? name : `${pair[0]} as ${pair[1]}`;
      })
      .join(', ');
    return `import { ${restored} } from '@angular/forms'`;
  });
}

const constructsOf = (source: string): readonly string[] =>
  detectInSource('/a.ts', source)
    .map((finding) => finding.construct)
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

  it('the fixtures actually detect something, so a pass cannot be vacuous', () => {
    for (const [name, source] of FIXTURES) {
      expect(constructsOf(source).length, name).toBeGreaterThan(1);
    }
  });

  it('the alias rewriter really produces aliased imports', () => {
    const [, source] = FIXTURES[0] ?? ['', ''];
    expect(withAliasedImports(source)).toContain('FormBuilder as FB');
    expect(withAliasedImports(source)).toContain('private fb: FB');
  });
});
