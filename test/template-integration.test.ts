import { describe, expect, it } from 'vitest';
import { findFormCandidates, type FileSystemPort } from '../src/core/detect.js';
import { buildMigrationReport } from '../src/core/report.js';
import { analyzeMigrationComplexity } from '../src/core/complexity.js';

// A `.html` file must flow through the same scan/complexity/report path as `.ts`. The
// detector has its own unit suite; this checks the wiring.
function memoryFs(files: Readonly<Record<string, string>>): FileSystemPort {
  const paths = Object.keys(files);
  const directories = new Set<string>();
  for (const path of paths) {
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i++) directories.add(segments.slice(0, i).join('/'));
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

const COMPONENT_TS = `import { FormBuilder, FormGroup, Validators } from '@angular/forms';
export class LoginComponent {
  loginForm: FormGroup;
  constructor(private fb: FormBuilder) {
    this.loginForm = this.fb.group({ email: ['', [Validators.required, Validators.email]] });
  }
}`;

const COMPONENT_HTML = `<form [formGroup]="loginForm" (ngSubmit)="onSubmit()">
  <input formControlName="email" maxlength="120" />
  @if (loginForm.get('email')?.errors?.['minlength']) { <span>Too short</span> }
</form>`;

const FS = memoryFs({
  '/app/login/login.component.ts': COMPONENT_TS,
  '/app/login/login.component.html': COMPONENT_HTML,
});

describe('a template flows through the whole pipeline', () => {
  it('reports the .html file alongside the .ts file', () => {
    const result = findFormCandidates('/app/login', FS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const files = result.data.map((f) => f.file);
    expect(files).toContain('/app/login/login.component.ts');
    expect(files).toContain('/app/login/login.component.html');
  });

  it('emits Template.* constructs from the html', () => {
    const result = findFormCandidates('/app/login', FS);
    if (!result.ok) return;
    const html = result.data.find((f) => f.file.endsWith('.html'));
    const constructs = (html?.findings ?? []).map((x) => x.construct);
    expect(constructs).toContain('Template.formGroup');
    expect(constructs).toContain('Template.formControlName');
    expect(constructs).toContain('Template.nativeAttribute');
    expect(constructs).toContain('Template.errorKeyRename');
  });

  it('counts template findings in the complexity totals', () => {
    const result = findFormCandidates('/app/login', FS);
    if (!result.ok) return;
    const complexity = analyzeMigrationComplexity(result.data);
    const templateCount = Object.entries(complexity.byConstruct)
      .filter(([k]) => k.startsWith('Template.'))
      .reduce((sum, [, n]) => sum + n, 0);
    expect(templateCount).toBeGreaterThan(0);
    // The template constructs are part of the total, not a separate tally.
    expect(complexity.totalFindings).toBeGreaterThan(templateCount);
  });

  it('labels the template "reference only" — it owns no form and sorts last', () => {
    const result = findFormCandidates('/app/login', FS);
    if (!result.ok) return;
    const report = buildMigrationReport('/app/login', result.data, undefined, undefined);

    // The .ts is the form owner; the .html references it.
    expect(report).toMatch(/login\.component\.ts.*form owner/);
    expect(report).toMatch(/login\.component\.html.*reference only/);
    // The template's constructs resolve to a recipe, not a dead end.
    expect(report).toContain('templateBindings');
  });

  it('describes the token-scan caveat in the report scope', () => {
    const result = findFormCandidates('/app/login', FS);
    if (!result.ok) return;
    const report = buildMigrationReport('/app/login', result.data, undefined, undefined);
    expect(report).toMatch(/token scan/i);
    expect(report).toMatch(/AOT build/i);
  });
});
