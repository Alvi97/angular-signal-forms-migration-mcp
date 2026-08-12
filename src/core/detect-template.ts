/**
 * Reactive Forms template detection (pure). Finds binding attributes in `.html` that the
 * `.ts` scan cannot see. The Signal Forms mapping lives in the recipes; this only flags
 * bindings. Parsing is a quote-aware tag scanner, not a full Angular AST, so it tolerates
 * `>` inside quoted expressions and multi-line tags.
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

/** Binding attributes, keyed by bare name (`[formGroup]`, `[(ngModel)]` are normalised first). */
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

/**
 * Reactive control bindings, excluding ngModel. These gate the migration-specific checks
 * (the select-multiple blocker and the NG8022 collision), which only apply once a control
 * becomes `[formField]` — never true for template-driven ngModel.
 */
const REACTIVE_CONTROL_BINDINGS: ReadonlySet<string> = new Set([
  'formControlName',
  'formControl',
  'formGroup',
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
  const tags = scanTags(blanked);
  for (const tag of tags) {
    // A `<select multiple>` cannot be converted at all, so it reports as a blocker instead
    // of a mechanical binding; emitting both for one element would contradict itself.
    if (isBlockedSelectMultiple(tag)) {
      collectSelectMultiple(tag, lineAt, snippetAt, out);
      continue;
    }
    collectBindings(tag, lineAt, snippetAt, out);
    collectNativeAttributeCollision(tag, lineAt, snippetAt, out);
  }
  collectRenamedErrorKeys(blanked, lineAt, snippetAt, out);
  collectTemplateStateReads(blanked, tags, lineAt, snippetAt, out);

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

/** `<select multiple>` with a control binding: unsupported by `[formField]`, so a blocker. */
function isBlockedSelectMultiple(tag: Tag): boolean {
  if (tag.name.toLowerCase() !== 'select') return false;
  if (!tag.attrs.some((a) => bareAttrName(a.name).toLowerCase() === 'multiple')) return false;
  return tag.attrs.some((a) => REACTIVE_CONTROL_BINDINGS.has(bareAttrName(a.name)));
}

function collectSelectMultiple(
  tag: Tag,
  lineAt: (pos: number) => number,
  snippetAt: (pos: number) => string,
  out: Finding[],
): void {
  const controlAttr = tag.attrs.find((a) => REACTIVE_CONTROL_BINDINGS.has(bareAttrName(a.name)));
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

/** Native attributes `[formField]` sets itself; a hardcoded copy on a bound element hits NG8022. */
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
  const bound = tag.attrs.some((a) => REACTIVE_CONTROL_BINDINGS.has(bareAttrName(a.name)));
  if (!bound) return;

  for (const attr of tag.attrs) {
    const name = bareAttrName(attr.name).toLowerCase();
    // A bound property (`[maxlength]`) is dynamic; only a hardcoded attribute collides.
    if (attr.name.startsWith('[') || attr.name.startsWith('(')) continue;
    if (!MIRRORED_ATTRS.has(name)) continue;
    out.push({
      construct: 'Template.nativeAttribute',
      line: lineAt(attr.pos),
      snippet: snippetAt(attr.pos),
      // Judgment, not mechanical: whether deleting is safe depends on the COMPONENT, which
      // is a different file. See CROSS_FILE_CONSTRUCTS in types.ts.
      classification: 'judgment',
      reason:
        `A hardcoded \`${name}\` on a form-bound element. Once this converts to ` +
        '`[formField]`, the directive sets that attribute itself and a v22 AOT build rejects ' +
        `the hand-written copy (NG8022). Delete it ONLY IF the component declares a matching ` +
        `rule — if this attribute is the only place the \`${name}\` constraint is stated, ` +
        "deleting it silently drops the validation. Check the control's validators in the " +
        'component first, and add the schema rule there if it is missing.',
      definesForm: false,
    });
  }
}

/**
 * Reads of the renamed error keys `minlength`/`maxlength`. These match nothing after
 * migration (the kind is `minLength`) yet still compile, so they fail silently.
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

/* -------------------------------------------------------------------------- */
/* Template state reads — the M5 defect, one layer up                          */
/* -------------------------------------------------------------------------- */

/**
 * State members read off a control INSIDE a template expression.
 *
 * M5 added these for `.ts` and nobody added them for templates, so the scanner reported
 * binding sites only. Running a real migration of forgot-password.component.html found six
 * further edit sites in a file the report called "all mechanical, 0 judgment" — which is the
 * same failure ROADMAP records for M5, in the same file, one layer up.
 */
const TEMPLATE_STATE_MEMBERS =
  'invalid|valid|touched|untouched|dirty|pristine|pending|errors|value|disabled|enabled';

/** `email?.invalid`, `form.invalid` — a call-shape change once migrated. */
const STATE_READ = new RegExp(
  String.raw`\b([A-Za-z_$][\w$]*)\s*(?:\?\.|\.)\s*(${TEMPLATE_STATE_MEMBERS})\b(?!\s*\()`,
  'g',
);

/** `errors?.['required']` — a SHAPE change, and a silent one. */
const ERROR_KEY_LOOKUP = /errors\s*(?:\?\.)?\s*\[\s*(['"])([A-Za-z_$][\w$]*)\1\s*\]/g;

/** Keys already reported by collectRenamedErrorKeys, so a site is never counted twice. */
const RENAMED_KEYS: ReadonlySet<string> = new Set(['minlength', 'maxlength']);

/**
 * Spans of a template that Angular evaluates as an expression: binding attribute values,
 * interpolations, and control-flow conditions. Scanning only these is what keeps ordinary
 * prose and unrelated attributes out.
 */
function expressionSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];

  // [prop]="…", (event)="…", *dir="…" — a quoted value on a bound attribute.
  for (const match of text.matchAll(/[[(*][^\s=<>]+[)\]]?\s*=\s*"([^"]*)"/g)) {
    const index = match.index ?? 0;
    const start = index + match[0].indexOf('"') + 1;
    spans.push({ start, end: start + (match[1]?.length ?? 0) });
  }
  // {{ … }}
  for (const match of text.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    const start = (match.index ?? 0) + 2;
    spans.push({ start, end: start + (match[1]?.length ?? 0) });
  }
  // @if (…) / @for (…) / @switch (…)
  for (const match of text.matchAll(/@(?:if|else if|for|switch)\s*\(([\s\S]*?)\)\s*\{/g)) {
    const index = match.index ?? 0;
    const start = index + match[0].indexOf('(') + 1;
    spans.push({ start, end: start + (match[1]?.length ?? 0) });
  }
  return spans;
}

/**
 * True when this template binds a Reactive form at all. Without it, `user?.invalid` in an
 * unrelated component would be reported — precision-first, and a template cannot tell a form
 * from any other object by name alone.
 */
function bindsAForm(tags: readonly Tag[]): boolean {
  return tags.some((tag) =>
    tag.attrs.some((attr) => REACTIVE_CONTROL_BINDINGS.has(bareAttrName(attr.name))),
  );
}

function collectTemplateStateReads(
  text: string,
  tags: readonly Tag[],
  lineAt: (pos: number) => number,
  snippetAt: (pos: number) => string,
  out: Finding[],
): void {
  if (!bindsAForm(tags)) return;

  for (const span of expressionSpans(text)) {
    const source = text.slice(span.start, span.end);

    for (const match of source.matchAll(ERROR_KEY_LOOKUP)) {
      const key = match[2] ?? '';
      if (RENAMED_KEYS.has(key.toLowerCase())) continue;
      const pos = span.start + (match.index ?? 0);
      out.push({
        construct: 'Template.errorKeyLookup',
        line: lineAt(pos),
        snippet: snippetAt(pos),
        classification: 'judgment',
        reason:
          `Reads \`errors['${key}']\` as a keyed object. Signal Forms errors are an ARRAY of ` +
          '`{ kind, message }`, not a map — so this is a shape change, not a rename. Use ' +
          `\`field().getError('${key}')\`, or match on \`.kind\`. A transliterated bracket ` +
          'access compiles and silently never matches, so the message just disappears.',
        definesForm: false,
      });
    }

    for (const match of source.matchAll(STATE_READ)) {
      const member = match[2] ?? '';
      const pos = span.start + (match.index ?? 0);
      // `errors[...]` is reported above with its own, sharper reason.
      if (member === 'errors' && /errors\s*(?:\?\.)?\s*\[/.test(source.slice(match.index ?? 0))) {
        continue;
      }
      out.push({
        construct: 'Template.stateRead',
        line: lineAt(pos),
        snippet: snippetAt(pos),
        classification: 'mechanical',
        reason:
          `\`.${member}\` is read off a control in a template expression. On field state it is ` +
          `a SIGNAL: write \`field().${member}()\`. Reading it without calling yields the ` +
          'signal object, which is always truthy, and a template gets no compiler warning for ' +
          'it. The field path comes from the component, so migrate the two together.',
        definesForm: false,
      });
    }
  }
}
