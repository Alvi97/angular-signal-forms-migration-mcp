import { describe, expect, it } from 'vitest';
import { detectInTemplate } from '../src/core/detect-template.js';
import type { Finding } from '../src/core/types.js';

// Template detection for the `.html` half of a migration. Pins both directions: what must be
// found, and what must be left alone.
function constructs(tpl: string): string[] {
  return detectInTemplate('t.html', tpl).map((f) => f.construct);
}

function find(tpl: string, construct: string): Finding | undefined {
  return detectInTemplate('t.html', tpl).find((f) => f.construct === construct);
}

describe('the Reactive Forms binding family', () => {
  it.each([
    ['<input formControlName="email">', 'Template.formControlName'],
    ['<input [formControl]="emailCtrl">', 'Template.formControl'],
    ['<form [formGroup]="loginForm"></form>', 'Template.formGroup'],
    ['<div formGroupName="address"></div>', 'Template.formGroupName'],
    ['<div formArrayName="items"></div>', 'Template.formArrayName'],
  ])('%s reports %s', (tpl, construct) => {
    expect(constructs(tpl)).toContain(construct);
  });

  it('classifies the direct renames mechanical and the structural ones judgment', () => {
    expect(find('<input formControlName="x">', 'Template.formControlName')?.classification).toBe(
      'mechanical',
    );
    expect(find('<div formArrayName="x"></div>', 'Template.formArrayName')?.classification).toBe(
      'judgment',
    );
  });

  it('reports the correct 1-based line across a multi-line tag', () => {
    const tpl = `<input\n  type="text"\n  formControlName="email"\n>`;
    expect(find(tpl, 'Template.formControlName')?.line).toBe(3);
  });
});

describe('quoted expressions do not break the parser', () => {
  it('finds a binding after an attribute whose value contains > and <', () => {
    // The classic trap: a `>` inside a quoted [ngClass] expression looks like a tag close.
    const tpl = `<input [ngClass]="{'e': a > b && c < d}" formControlName="email">`;
    expect(constructs(tpl)).toContain('Template.formControlName');
  });

  it('is not fooled by < in an interpolation or @if condition', () => {
    const tpl = `<div>@if (count < 3) { <input formControlName="x"> }</div>`;
    expect(constructs(tpl)).toContain('Template.formControlName');
  });
});

describe('the select-multiple blocker', () => {
  it('flags a multiple select bound to a control', () => {
    const finding = find(
      '<select multiple formControlName="tags"></select>',
      'Template.selectMultiple',
    );
    expect(finding?.classification).toBe('judgment');
    expect(finding?.reason).toMatch(/BLOCKER/);
  });

  it('does NOT also emit a mechanical binding for the same element', () => {
    // Reporting "convert this" and "this cannot be converted" for one element contradicts
    // itself; the blocker wins.
    const cs = constructs('<select multiple formControlName="tags"></select>');
    expect(cs).toContain('Template.selectMultiple');
    expect(cs).not.toContain('Template.formControlName');
  });

  it('leaves an ordinary single select alone', () => {
    expect(constructs('<select formControlName="country"></select>')).toEqual([
      'Template.formControlName',
    ]);
  });

  it('leaves a multiple select with no form binding alone', () => {
    expect(constructs('<select multiple name="x"></select>')).toEqual([]);
  });
});

describe('the silent error-key rename', () => {
  it.each([
    `@if (email.errors?.['minlength']) {}`,
    `@if (email.errors['minlength']) {}`,
    `<span *ngIf="p.hasError('maxlength')"></span>`,
    `{{ f.password().getError('minlength') }}`,
  ])('flags %s', (tpl) => {
    expect(constructs(tpl)).toContain('Template.errorKeyRename');
  });

  it('names the camelCase replacement in the reason', () => {
    const finding = find(`@if (x.errors?.['minlength']) {}`, 'Template.errorKeyRename');
    expect(finding?.reason).toContain('minLength');
  });

  it('does not flag a key that was never renamed', () => {
    expect(constructs(`@if (x.errors?.['required']) {}`)).not.toContain('Template.errorKeyRename');
  });
});

describe('the NG8022 native-attribute collision', () => {
  it('flags a hardcoded maxlength on a form-bound input', () => {
    const finding = find('<input formControlName="otp" maxlength="6">', 'Template.nativeAttribute');
    expect(finding?.classification).toBe('mechanical');
    expect(finding?.reason).toMatch(/NG8022/);
  });

  it('leaves maxlength alone on an input that is NOT form-bound', () => {
    expect(constructs('<input maxlength="6" name="plain">')).toEqual([]);
  });

  it('does not flag a bound [maxlength] property, only a hardcoded attribute', () => {
    const cs = constructs('<input formControlName="otp" [maxlength]="limit">');
    expect(cs).not.toContain('Template.nativeAttribute');
  });
});

/**
 * Found by a corpus run against DeborahK/Angular-ReactiveForms, a teaching repo with both
 * template-driven and reactive examples. Its template-driven form —
 * `<input required minlength="3" [(ngModel)]="...">` — was flagged for NG8022 native-attribute
 * collisions it can never hit: NG8022 only happens when a control converts to `[formField]`,
 * and ngModel never does. The migration-specific checks must gate on REACTIVE bindings only.
 */
describe('migration-specific checks do not fire on template-driven ngModel', () => {
  it('does not report an NG8022 collision on an ngModel input', () => {
    const cs = constructs('<input required minlength="3" [(ngModel)]="customer.name" name="n">');
    expect(cs).toContain('Template.ngModel'); // still flagged as out-of-scope
    expect(cs).not.toContain('Template.nativeAttribute'); // but NOT an NG8022 collision
  });

  it('still reports NG8022 on a genuinely reactive-bound input', () => {
    const cs = constructs('<input required minlength="3" formControlName="name">');
    expect(cs).toContain('Template.nativeAttribute');
  });

  it('does not treat a template-driven <select multiple> as the [formField] blocker', () => {
    const cs = constructs('<select multiple [(ngModel)]="tags" name="t"></select>');
    expect(cs).toContain('Template.ngModel');
    expect(cs).not.toContain('Template.selectMultiple');
  });
});

describe('template-driven ngModel', () => {
  it.each(['<input [(ngModel)]="x">', '<input ngModel name="x">', '<input [ngModel]="x">'])(
    'flags %s as out of scope, not a Reactive migration',
    (tpl) => {
      const finding = find(tpl, 'Template.ngModel');
      expect(finding).toBeDefined();
      expect(finding?.reason).toMatch(/TEMPLATE-DRIVEN|no ngModel/i);
    },
  );
});

describe('a template with no form bindings', () => {
  it('returns nothing for ordinary markup', () => {
    const tpl = `<div class="card"><h1>{{ title }}</h1><button (click)="go()">Go</button></div>`;
    expect(detectInTemplate('t.html', tpl)).toEqual([]);
  });

  it('is not fooled by an attribute that merely contains "form"', () => {
    expect(constructs('<div class="form-group"><label>Name</label></div>')).toEqual([]);
  });
});
