import { describe, expect, it } from 'vitest';
import { detectInSource, findFormCandidates, type FileSystemPort } from '../src/core/detect.js';
import type { Finding } from '../src/core/types.js';

/** In-memory filesystem: directories are keys ending in '/', files map to contents. */
function memoryFs(files: Readonly<Record<string, string>>): FileSystemPort {
  const paths = Object.keys(files);
  const directories = new Set<string>();
  for (const path of paths) {
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i++) {
      directories.add(segments.slice(0, i).join('/'));
    }
  }

  return {
    exists: (path) => path in files || directories.has(path),
    isDirectory: (path) => directories.has(path),
    readDir: (dir) => {
      if (!directories.has(dir)) throw new Error(`ENOENT: ${dir}`);
      const children = new Set<string>();
      for (const path of [...paths, ...directories]) {
        if (path.startsWith(`${dir}/`)) {
          const rest = path.slice(dir.length + 1).split('/')[0];
          if (rest !== undefined && rest !== '') children.add(`${dir}/${rest}`);
        }
      }
      return [...children];
    },
    readFile: (file) => {
      const content = files[file];
      if (content === undefined) throw new Error(`EACCES: ${file}`);
      return content;
    },
  };
}

const IMPORT = `import { FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';`;

function constructs(findings: readonly Finding[]): string[] {
  return findings.map((finding) => finding.construct);
}

function find(findings: readonly Finding[], construct: string): Finding {
  const match = findings.find((finding) => finding.construct === construct);
  if (match === undefined) {
    throw new Error(`expected a "${construct}" finding, got: ${constructs(findings).join(', ')}`);
  }
  return match;
}

describe('detectInSource', () => {
  it('classifies a standalone FormControl as mechanical', () => {
    const findings = detectInSource(
      '/app/name.component.ts',
      `${IMPORT}\nconst name = new FormControl('');`,
    );

    const finding = find(findings, 'FormControl');
    expect(finding.classification).toBe('mechanical');
    expect(finding.line).toBe(2);
    expect(finding.snippet).toBe("const name = new FormControl('');");
  });

  it('classifies a flat FormGroup as mechanical but a nested one as judgment', () => {
    const flat = detectInSource(
      '/app/flat.ts',
      `${IMPORT}\nconst f = new FormGroup({ email: new FormControl('') });`,
    );
    expect(find(flat, 'FormGroup').classification).toBe('mechanical');

    const nested = detectInSource(
      '/app/nested.ts',
      `${IMPORT}\nconst f = new FormGroup({ address: new FormGroup({ city: new FormControl('') }) });`,
    );
    expect(find(nested, 'FormGroup').classification).toBe('judgment');
    expect(find(nested, 'FormGroup').reason).toMatch(/by hand/);
  });

  it('resolves fb.group through a constructor-injected FormBuilder', () => {
    const findings = detectInSource(
      '/app/signup.component.ts',
      `${IMPORT}
export class SignupComponent {
  constructor(private fb: FormBuilder) {}
  form = this.fb.group({ email: ['', Validators.required] });
}`,
    );

    expect(constructs(findings)).toContain('FormBuilder.group');
    expect(find(findings, 'FormBuilder.group').classification).toBe('mechanical');
    expect(constructs(findings)).toContain('FormBuilder');
  });

  it('resolves fb.group through an inject()-assigned FormBuilder', () => {
    const findings = detectInSource(
      '/app/signup.component.ts',
      `${IMPORT}
import { inject } from '@angular/core';
export class SignupComponent {
  private readonly builder = inject(FormBuilder);
  form = this.builder.group({ email: [''] });
}`,
    );

    expect(constructs(findings)).toContain('FormBuilder.group');
  });

  it('does NOT match .group() on an unrelated object', () => {
    const findings = detectInSource(
      '/app/chart.ts',
      `${IMPORT}\nconst chart = { group: (x: unknown) => x };\nchart.group({ a: 1 });`,
    );

    expect(constructs(findings)).not.toContain('FormBuilder.group');
  });

  it('separates mechanical built-in validators from judgment ones', () => {
    const findings = detectInSource(
      '/app/v.ts',
      `${IMPORT}
const a = Validators.required;
const b = Validators.compose([Validators.email]);`,
    );

    expect(find(findings, 'Validators.required').classification).toBe('mechanical');
    expect(find(findings, 'Validators.email').classification).toBe('mechanical');
    expect(find(findings, 'Validators.compose').classification).toBe('judgment');
  });

  it('flags valueChanges and statusChanges as judgment', () => {
    const findings = detectInSource(
      '/app/watch.ts',
      `${IMPORT}
const f = new FormGroup({});
f.valueChanges.subscribe(() => {});
f.statusChanges.subscribe(() => {});`,
    );

    expect(find(findings, 'valueChanges').classification).toBe('judgment');
    expect(find(findings, 'statusChanges').classification).toBe('judgment');
  });

  it('flags a custom ValidatorFn as judgment', () => {
    const findings = detectInSource(
      '/app/custom.ts',
      `import { ValidatorFn, AbstractControl, ValidationErrors } from '@angular/forms';
export const noBlanks: ValidatorFn = (c: AbstractControl): ValidationErrors | null =>
  String(c.value).trim() === '' ? { blank: true } : null;`,
    );

    expect(find(findings, 'customValidator').classification).toBe('judgment');
  });

  it('ignores files that never import @angular/forms', () => {
    const findings = detectInSource(
      '/app/store.ts',
      `import { of } from 'rxjs';
const source = of(1);
source.valueChanges;
const g = new FormGroup({});`,
    );

    expect(findings).toEqual([]);
  });

  it('reports one finding per construct per line', () => {
    const findings = detectInSource(
      '/app/dup.ts',
      `${IMPORT}\nconst v = [Validators.required, Validators.required];`,
    );

    expect(findings.filter((f) => f.construct === 'Validators.required')).toHaveLength(1);
  });

  it('tolerates syntactically broken source without throwing', () => {
    expect(() =>
      detectInSource('/app/broken.ts', `${IMPORT}\nconst x = new FormGroup({`),
    ).not.toThrow();
  });
});

describe('findFormCandidates', () => {
  it('returns an error result for a path that does not exist', () => {
    const result = findFormCandidates('/nope', memoryFs({}));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/does not exist/);
  });

  it('walks a directory and skips node_modules, dist and spec files', () => {
    const source = `${IMPORT}\nconst c = new FormControl('');`;
    const result = findFormCandidates(
      '/repo',
      memoryFs({
        '/repo/src/a.component.ts': source,
        '/repo/src/a.component.spec.ts': source,
        '/repo/node_modules/pkg/index.ts': source,
        '/repo/dist/a.component.ts': source,
        '/repo/src/readme.md': source,
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((entry) => entry.file)).toEqual(['/repo/src/a.component.ts']);
  });

  it('skips an unreadable file instead of failing the whole scan', () => {
    const fileSystem = memoryFs({
      '/repo/good.ts': `${IMPORT}\nconst c = new FormControl('');`,
      '/repo/locked.ts': '',
    });
    const guarded: FileSystemPort = {
      ...fileSystem,
      readFile: (file) => {
        if (file === '/repo/locked.ts') throw new Error('EACCES');
        return fileSystem.readFile(file);
      },
    };

    const result = findFormCandidates('/repo', guarded);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((entry) => entry.file)).toEqual(['/repo/good.ts']);
  });

  it('accepts a single file path', () => {
    const result = findFormCandidates(
      '/repo/a.ts',
      memoryFs({ '/repo/a.ts': `${IMPORT}\nconst c = new FormControl('');` }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
  });

  it('returns an empty list when nothing matches', () => {
    const result = findFormCandidates(
      '/repo',
      memoryFs({ '/repo/plain.ts': `export const x = 1;` }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Regressions found by running the tool against a real Angular repo.          */
/* Fixtures below are reduced from mockio-master (Nx workspace, Angular 19).   */
/* -------------------------------------------------------------------------- */

describe('constructs used in type position', () => {
  it('detects a FormGroup declared only as a property type', () => {
    // The overwhelmingly common shape: the type is annotated on the property and
    // the group is built later in the constructor via FormBuilder.
    const findings = detectInSource(
      '/app/login.component.ts',
      `${IMPORT}
export class Login {
  loginForm: FormGroup;
}`,
    );

    const finding = find(findings, 'FormGroup');
    expect(finding.line).toBe(3);
    expect(finding.classification).toBe('mechanical');
  });

  it('detects a FormControl in an `as` assertion', () => {
    const findings = detectInSource(
      '/app/profile.component.ts',
      `${IMPORT}
export class Profile {
  get firstName() { return this.profileForm.get('firstName') as FormControl; }
}`,
    );

    expect(constructs(findings)).toContain('FormControl');
  });

  it('does not report a control type used as a function parameter', () => {
    // `validate(group: FormGroup)` is a validator signature, not a form declaration.
    // It is reported as customValidator instead — see below.
    const findings = detectInSource(
      '/app/v.ts',
      `${IMPORT}
export function passwordMatchValidator(group: FormGroup) { return null; }`,
    );

    expect(constructs(findings)).not.toContain('FormGroup');
  });
});

describe('AbstractControl.get accessors', () => {
  const SOURCE = `${IMPORT}
export class Profile {
  profileForm: FormGroup;
  get firstName() { return this.profileForm.get('firstName'); }
  dynamic(key: string) { return this.profileForm.get(key); }
}`;

  it('detects .get() on a known form and calls a literal key mechanical', () => {
    const findings = detectInSource('/app/profile.component.ts', SOURCE);
    const finding = findings.find((f) => f.construct === 'AbstractControl.get' && f.line === 4);
    expect(finding?.classification).toBe('mechanical');
  });

  it('treats a computed key as judgment', () => {
    const findings = detectInSource('/app/profile.component.ts', SOURCE);
    const finding = findings.find((f) => f.construct === 'AbstractControl.get' && f.line === 5);
    expect(finding?.classification).toBe('judgment');
  });

  it('ignores .get() on anything that is not a known form', () => {
    // All four shapes below co-exist with real forms in mockio-master and must stay out
    // of the report — `.get()` is far too common a method name to match blindly.
    const findings = detectInSource(
      '/app/other.component.ts',
      `${IMPORT}
const cache = new Map<string, string>();
const hit = cache.get('key');
const p = route.snapshot.queryParamMap.get('id');
const formData = new FormData();
const name = formData.get('name') as string;
this.route.params.subscribe((params) => { const id = params.get('id'); });`,
    );

    expect(constructs(findings)).not.toContain('AbstractControl.get');
  });

  it('detects .get() on a control-typed parameter, not just a property', () => {
    // Inside a cross-field validator the form arrives as an argument.
    const findings = detectInSource(
      '/app/v.ts',
      `${IMPORT}
export function match(group: FormGroup) {
  return group.get('password')?.value === group.get('confirm')?.value;
}`,
    );

    expect(constructs(findings)).toContain('AbstractControl.get');
  });
});

describe('custom validators not typed ValidatorFn', () => {
  it('detects a cross-field validator taking a FormGroup', () => {
    // Real shape from profile.component.ts — this file was previously reported
    // as 100% mechanical, hiding the only judgment call in it.
    const findings = detectInSource(
      '/app/profile.component.ts',
      `${IMPORT}
export class Profile {
  passwordMatchValidator(formGroup: FormGroup) {
    return formGroup.value.a === formGroup.value.b ? null : { mismatch: true };
  }
}`,
    );

    const finding = find(findings, 'customValidator');
    expect(finding.classification).toBe('judgment');
    expect(finding.line).toBe(3);
  });

  it('detects a validator taking an AbstractControl regardless of its name', () => {
    const findings = detectInSource(
      '/app/v.ts',
      `import { AbstractControl } from '@angular/forms';
export function noWhitespace(control: AbstractControl) {
  return control.value?.trim() ? null : { whitespace: true };
}`,
    );

    expect(find(findings, 'customValidator').classification).toBe('judgment');
  });

  it('does not report an ordinary method that happens to take a string', () => {
    const findings = detectInSource(
      '/app/v.ts',
      `${IMPORT}
export class X { validateEmailFormat(value: string) { return value.includes('@'); } }`,
    );

    expect(constructs(findings)).not.toContain('customValidator');
  });
});
