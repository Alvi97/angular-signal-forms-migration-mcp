/**
 * Reactive Forms TEMPLATE detection — pure.
 *
 * The .ts detector only ever sees half a migration: `[formGroup]`, `formControlName`,
 * `formArrayName`, the error-key reads and the `<select multiple>` dead-ends all live in
 * `.html`, and every one of them was invisible. This closes that half.
 *
 * What it detects is stable, long-documented Reactive Forms template syntax — the attribute
 * names `formControlName` / `[formGroup]` / … exist for nothing else, so matching them makes
 * no claim about Signal Forms. The Signal Forms mapping (what each BECOMES) lives in the
 * recipes, which are doc-grounded; the detector only says "here is a Reactive Forms binding".
 *
 * Parsing is a small quote-aware tag scanner rather than a regex-on-the-whole-file, because
 * Angular templates put `>` inside quoted expressions (`[ngClass]="{'x': a > b}"`) and spread
 * one tag across many lines. It is NOT a full Angular template parser — it does not need the
 * control-flow/interpolation AST to find binding attributes and error-key reads.
 */
import type { Classification, Finding } from './types.js';

/* -------------------------------------------------------------------------- */
/* What we look for                                                            */
/* -------------------------------------------------------------------------- */

/** An attribute name (stripped of binding punctuation) mapped to how we report it. */
interface BindingRule {
  readonly construct: string;
  readonly classification: Classification;
  readonly reason: string;
}

/**
 * The Reactive Forms binding attributes. Keys are the BARE names — `[formGroup]`,
 * `formGroupName`, `[(ngModel)]` and friends are all normalised to these before lookup.
 */
const BINDINGS: ReadonlyMap<string, BindingRule> = new Map([
  [
    'formControlName',
    {
      construct: 'Template.formControlName',
      classification: 'mechanical',
      reason:
        'Reactive Forms control binding. It becomes `[formField]="f.<name>"` bound to the ' +
        'matching field on the form’s field tree — see the Template.formControlName recipe.',
    },
  ],
  [
    'formControl',
    {
      construct: 'Template.formControl',
      classification: 'mechanical',
      reason:
        'A standalone Reactive Forms control binding (`[formControl]`). It becomes ' +
        '`[formField]` bound to the field for that control.',
    },
  ],
  [
    'formGroup',
    {
      construct: 'Template.formGroup',
      classification: 'mechanical',
      reason:
        'The `[formGroup]` binding. On a `<form>` element it becomes the `[formRoot]` ' +
        'directive — a DIFFERENT directive from `[formField]`, and an OPTIONAL one: it only ' +
        'wires up automatic submit and `novalidate`, so a bare `<form>` calling `submit()` ' +
        'by hand is also valid. See the Template.formGroup recipe.',
    },
  ],
  [
    'formGroupName',
    {
      construct: 'Template.formGroupName',
      classification: 'judgment',
      reason:
        'A nested-group binding. Signal Forms reaches nested fields by dot notation on the ' +
        'field tree, so this indirection is usually removed and the children rebind against ' +
        '`f.<group>.<field>` — confirm the surrounding structure.',
    },
  ],
  [
    'formArrayName',
    {
      construct: 'Template.formArrayName',
      classification: 'judgment',
      reason:
        'A form-array binding, almost always with a `*ngFor`/`@for` inside. The docs iterate ' +
        'the field array directly — `@for (field of f.items; track field)` with ' +
        '`[formField]="field"` — and tracking must be BY FIELD IDENTITY (`track field`), not ' +
        'by index: index tracking misbinds inputs after an insert or remove. A design change.',
    },
  ],
  [
    'ngModel',
    {
      construct: 'Template.ngModel',
      classification: 'judgment',
      reason:
        'This is a TEMPLATE-DRIVEN binding, not Reactive Forms. angular.dev documents no ' +
        'ngModel → Signal Forms migration path, so treat this as out of scope for a Reactive ' +
        'Forms migration unless you are deliberately rewriting the control.',
    },
  ],
]);

/** Binding attributes that identify a control on an element (for the select-multiple check). */
const CONTROL_BINDINGS: ReadonlySet<string> = new Set([
  'formControlName',
  'formControl',
  'formGroup',
  'ngModel',
]);

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

export function detectInTemplate(_filePath: string, text: string): Finding[] {
  const blanked = blankComments(text);
  const lineStarts = computeLineStarts(blanked);
  const lineAt = (pos: number): number => lineNumber(lineStarts, pos);
  const snippetAt = (pos: number): string => lineText(text, lineStarts, pos);

  const out: Finding[] = [];
  for (const tag of scanTags(blanked)) {
    // A `<select multiple>` cannot be converted at all, so it reports as a blocker instead
    // of a mechanical binding — emitting both for one element would contradict itself.
    if (isBlockedSelectMultiple(tag)) {
      collectSelectMultiple(tag, lineAt, snippetAt, out);
      continue;
    }
    collectBindings(tag, lineAt, snippetAt, out);
    collectNativeAttributeCollision(tag, lineAt, snippetAt, out);
  }
  collectRenamedErrorKeys(blanked, lineAt, snippetAt, out);

  out.sort((a, b) => a.line - b.line || a.construct.localeCompare(b.construct));
  return out;
}

/* -------------------------------------------------------------------------- */
/* Detectors                                                                   */
/* -------------------------------------------------------------------------- */

function collectBindings(
  tag: Tag,
  lineAt: (pos: number) => number,
  snippetAt: (pos: number) => string,
  out: Finding[],
): void {
  for (const attr of tag.attrs) {
    const rule = BINDINGS.get(bareAttrName(attr.name));
    if (rule === undefined) continue;
    out.push({
      construct: rule.construct,
      line: lineAt(attr.pos),
      snippet: snippetAt(attr.pos),
      classification: rule.classification,
      reason: rule.reason,
      definesForm: false,
    });
  }
}

/**
 * `<select multiple>` bound to a form control — a documented hard blocker.
 *
 * The `[formField]` directive does not support multiple-select, so a control that works in
 * Reactive Forms cannot complete the migration. Better to surface it before starting than to
 * discover it half-converted.
 */
/** A `<select multiple>` carrying a form control binding — the one true blocker. */
function isBlockedSelectMultiple(tag: Tag): boolean {
  if (tag.name.toLowerCase() !== 'select') return false;
  if (!tag.attrs.some((a) => bareAttrName(a.name).toLowerCase() === 'multiple')) return false;
  return tag.attrs.some((a) => CONTROL_BINDINGS.has(bareAttrName(a.name)));
}

function collectSelectMultiple(
  tag: Tag,
  lineAt: (pos: number) => number,
  snippetAt: (pos: number) => string,
  out: Finding[],
): void {
  const controlAttr = tag.attrs.find((a) => CONTROL_BINDINGS.has(bareAttrName(a.name)));
  if (controlAttr === undefined) return;

  out.push({
    construct: 'Template.selectMultiple',
    line: lineAt(controlAttr.pos),
    snippet: snippetAt(controlAttr.pos),
    classification: 'judgment',
    reason:
      'BLOCKER: `<select multiple>` is not supported by the `[formField]` directive, though ' +
      'Reactive Forms handles it. This control cannot complete the migration as-is — keep it ' +
      'on Reactive Forms or write a custom FormValueControl. Decide before you start.',
    definesForm: false,
  });
}

/**
 * A hand-written `minlength`/`maxlength`/`required`/`min`/`max` attribute on a form-bound
 * element — the NG8022 collision waiting to happen.
 *
 * `[formField]` sets these attributes itself from the matching rule, so the hand-written copy
 * makes a v22 AOT build fail once the element is converted. Only flagged when the SAME element
 * carries a control binding, so a plain `<input maxlength>` elsewhere is left alone.
 */
const MIRRORED_ATTRS: ReadonlySet<string> = new Set([
  'minlength',
  'maxlength',
  'required',
  'min',
  'max',
]);

function collectNativeAttributeCollision(
  tag: Tag,
  lineAt: (pos: number) => number,
  snippetAt: (pos: number) => string,
  out: Finding[],
): void {
  const bound = tag.attrs.some((a) => CONTROL_BINDINGS.has(bareAttrName(a.name)));
  if (!bound) return;

  for (const attr of tag.attrs) {
    const name = bareAttrName(attr.name).toLowerCase();
    // A bound property (`[maxlength]`) is dynamic and not the NG8022 case; only a plain
    // hardcoded attribute collides.
    if (attr.name.startsWith('[') || attr.name.startsWith('(')) continue;
    if (!MIRRORED_ATTRS.has(name)) continue;
    out.push({
      construct: 'Template.nativeAttribute',
      line: lineAt(attr.pos),
      snippet: snippetAt(attr.pos),
      classification: 'mechanical',
      reason:
        `A hardcoded \`${name}\` on a form-bound element. Once this converts to ` +
        '`[formField]`, the directive sets that attribute itself and a v22 AOT build rejects ' +
        'the hand-written copy (NG8022). Delete the attribute — the rule emits it.',
      definesForm: false,
    });
  }
}

/**
 * Reads of the RENAMED error keys `minlength` / `maxlength` in template expressions.
 *
 * `control.errors?.['minlength']` and `hasError('minlength')` compile fine after migration
 * and silently never match, because the Signal Forms kind is `minLength`. This is the only
 * template hazard with no visible symptom, so it is worth its own detector.
 */
const RENAMED_KEY_READ =
  /(?:errors\s*(?:\?\.)?\s*\[\s*|(?:has|get)Error\s*\(\s*)(['"])(minlength|maxlength)\1/g;

function collectRenamedErrorKeys(
  text: string,
  lineAt: (pos: number) => number,
  snippetAt: (pos: number) => string,
  out: Finding[],
): void {
  for (const match of text.matchAll(RENAMED_KEY_READ)) {
    const pos = match.index ?? 0;
    const key = match[2] ?? '';
    const camel = key === 'minlength' ? 'minLength' : 'maxLength';
    out.push({
      construct: 'Template.errorKeyRename',
      line: lineAt(pos),
      snippet: snippetAt(pos),
      classification: 'mechanical',
      reason:
        `Reads the error key '${key}', which Signal Forms renamed to '${camel}'. TWO things ` +
        `change: the key is renamed, AND errors are no longer a keyed object — the docs read ` +
        `them as an array of \`{ kind, message }\` from \`field().errors()\` and match on ` +
        `\`.kind === '${camel}'\`. A stale '${key}' compiles and silently never matches, so ` +
        'the message just vanishes. See the Template.formControlName recipe.',
      definesForm: false,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Tag scanner                                                                 */
/* -------------------------------------------------------------------------- */

interface Attr {
  readonly name: string;
  /** Offset of the attribute name in the (comment-blanked) text. */
  readonly pos: number;
}

interface Tag {
  readonly name: string;
  readonly attrs: Attr[];
}

const NAME_START = /[a-zA-Z]/;
const ATTR_NAME_CHARS = /[^\s=/>]/;

/** Walks the text and yields each opening tag with its attributes and their positions. */
function scanTags(text: string): Tag[] {
  const tags: Tag[] = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    if (text[i] !== '<') {
      i += 1;
      continue;
    }
    const next = text[i + 1];
    if (next === undefined || !NAME_START.test(next)) {
      i += 1;
      continue;
    }

    // Read the tag name.
    let j = i + 1;
    while (j < n && /[\w-]/.test(text[j] ?? '')) j += 1;
    const name = text.slice(i + 1, j);
    const attrs: Attr[] = [];

    // Read attributes until the closing `>`, respecting quotes.
    while (j < n) {
      const ch = text[j] ?? '';
      if (ch === '>') {
        j += 1;
        break;
      }
      if (ch === '/' || /\s/.test(ch)) {
        j += 1;
        continue;
      }

      const attrStart = j;
      while (j < n && ATTR_NAME_CHARS.test(text[j] ?? '')) j += 1;
      const attrName = text.slice(attrStart, j);
      if (attrName !== '') attrs.push({ name: attrName, pos: attrStart });

      // Skip an `="value"` / `='value'` if present.
      let k = j;
      while (k < n && /\s/.test(text[k] ?? '')) k += 1;
      if (text[k] === '=') {
        k += 1;
        while (k < n && /\s/.test(text[k] ?? '')) k += 1;
        const quote = text[k];
        if (quote === '"' || quote === "'") {
          k += 1;
          while (k < n && text[k] !== quote) k += 1;
          k += 1; // consume closing quote
        } else {
          while (k < n && !/[\s>]/.test(text[k] ?? '')) k += 1; // unquoted value
        }
        j = k;
      }
    }

    tags.push({ name, attrs });
    i = j;
  }

  return tags;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** `[formGroup]`, `[(ngModel)]`, `(ngModelChange)` → `formGroup`, `ngModel`, `ngModelChange`. */
function bareAttrName(name: string): string {
  return name.replace(/^\[\(?|\)?\]$|^\(|\)$|^\*|^#/g, '').replace(/\)\]$/, '');
}

/** Replaces `<!-- … -->` runs with spaces so offsets and line numbers stay exact. */
function blankComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, (match) => match.replace(/[^\n]/g, ' '));
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineNumber(lineStarts: number[], pos: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((lineStarts[mid] ?? 0) <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function lineText(original: string, lineStarts: number[], pos: number): string {
  const line = lineNumber(lineStarts, pos) - 1;
  const start = lineStarts[line] ?? 0;
  const end = lineStarts[line + 1] ?? original.length;
  return original.slice(start, end).trim();
}
