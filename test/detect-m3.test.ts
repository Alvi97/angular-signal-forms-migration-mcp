import { describe, expect, it } from 'vitest';
import { detectInSource } from '../src/core/detect.js';
import type { Finding } from '../src/core/types.js';

const IMPORT = `import { ControlValueAccessor, FormControl, FormGroup, NG_VALUE_ACCESSOR } from '@angular/forms';`;

function constructs(findings: readonly Finding[]): string[] {
  return findings.map((f) => f.construct);
}
function find(findings: readonly Finding[], construct: string): Finding {
  const match = findings.find((f) => f.construct === construct);
  if (match === undefined) {
    throw new Error(`expected "${construct}", got: ${constructs(findings).join(', ')}`);
  }
  return match;
}

describe('ControlValueAccessor', () => {
  it('detects an implements clause', () => {
    const findings = detectInSource(
      '/app/rating.component.ts',
      `${IMPORT}
export class RatingInput implements ControlValueAccessor {
  writeValue(value: number) {}
  registerOnChange(fn: (v: number) => void) {}
  registerOnTouched(fn: () => void) {}
}`,
    );

    const finding = find(findings, 'ControlValueAccessor');
    expect(finding.classification).toBe('judgment');
    expect(finding.line).toBe(2);
  });

  it('detects the NG_VALUE_ACCESSOR provider even without an implements clause', () => {
    const findings = detectInSource(
      '/app/rating.component.ts',
      `${IMPORT}
@Component({
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: RatingInput, multi: true }],
})
export class RatingInput {}`,
    );

    expect(constructs(findings)).toContain('ControlValueAccessor');
  });

  it('reports a component once even when it both implements and provides', () => {
    const findings = detectInSource(
      '/app/rating.component.ts',
      `${IMPORT}
@Component({
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: RatingInput, multi: true }],
})
export class RatingInput implements ControlValueAccessor {
  writeValue(v: number) {}
}`,
    );

    expect(constructs(findings).filter((c) => c === 'ControlValueAccessor')).toHaveLength(1);
  });
});

describe('form stream operator tiers', () => {
  const wrap = (body: string) => `${IMPORT}
import { debounceTime, distinctUntilChanged, switchMap, map } from 'rxjs/operators';
export class Search {
  form: FormGroup;
  ngOnInit() {
    ${body}
  }
}`;

  it('treats a bare subscribe as the trivial tier', () => {
    const findings = detectInSource(
      '/app/s.ts',
      wrap(`this.form.valueChanges.subscribe((v) => this.save(v));`),
    );

    const finding = find(findings, 'valueChanges');
    expect(finding.classification).toBe('judgment');
    expect(finding.reason).toContain('trivial');
  });

  it('classifies map/debounceTime/distinctUntilChanged as the moderate tier', () => {
    const findings = detectInSource(
      '/app/s.ts',
      wrap(`this.form.valueChanges
        .pipe(debounceTime(300), distinctUntilChanged(), map((v) => v.query))
        .subscribe((q) => this.results.set(q));`),
    );

    const finding = find(findings, 'valueChangesPipeline');
    expect(finding.classification).toBe('judgment');
    expect(finding.reason).toContain('debounceTime');
  });

  it('classifies switchMap as the hard tier', () => {
    const findings = detectInSource(
      '/app/s.ts',
      wrap(`this.form.valueChanges
        .pipe(debounceTime(300), switchMap((v) => this.http.get('/search?q=' + v.query)))
        .subscribe((r) => this.results.set(r));`),
    );

    const finding = find(findings, 'valueChangesAsyncPipeline');
    expect(finding.classification).toBe('judgment');
    expect(finding.reason).toContain('switchMap');
  });

  it('lets the hardest operator in a chain decide the tier', () => {
    const findings = detectInSource(
      '/app/s.ts',
      wrap(
        `this.form.valueChanges.pipe(map((v) => v.q), switchMap((q) => this.api.find(q))).subscribe();`,
      ),
    );

    expect(constructs(findings)).toContain('valueChangesAsyncPipeline');
    expect(constructs(findings)).not.toContain('valueChangesPipeline');
  });

  it('tiers statusChanges the same way', () => {
    const findings = detectInSource(
      '/app/s.ts',
      wrap(
        `this.form.statusChanges.pipe(distinctUntilChanged()).subscribe((s) => this.status.set(s));`,
      ),
    );

    expect(constructs(findings)).toContain('statusChangesPipeline');
  });

  it('does not classify RxJS unrelated to a form stream', () => {
    // Scope guard: operator analysis is rooted at valueChanges/statusChanges only.
    const findings = detectInSource(
      '/app/s.ts',
      `${IMPORT}
import { switchMap } from 'rxjs/operators';
export class S {
  load() {
    this.route.params.pipe(switchMap((p) => this.api.get(p.id))).subscribe();
  }
}`,
    );

    expect(constructs(findings).filter((c) => c.includes('Pipeline'))).toEqual([]);
  });
});
