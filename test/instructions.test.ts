import { describe, expect, it } from 'vitest';
import { SERVER_INSTRUCTIONS } from '../src/server.js';

/**
 * The `instructions` string is injected into the calling agent's context at handshake.
 * It is the only channel this server has for shaping HOW its output gets used, so the
 * rules that are expensive to get wrong belong here rather than only in a README nobody
 * pipes into the model.
 */
describe('server instructions', () => {
  it('leads with the architectural rule', () => {
    expect(SERVER_INSTRUCTIONS.slice(0, 400)).toMatch(/never edits|does not edit/i);
  });

  it.each([
    ['blocking prerequisite', /blockingPrerequisite|BLOCKING PREREQUISITE/],
    ['judgment must not be downgraded', /judgment/i],
    ['caveats must be read', /caveats/i],
    ['version sensitivity', /VERSION-SENSITIVE|version-sensitive/],
    ['templates are not covered', /\.html|template/i],
    ['reference-only files', /reference|does not own a form/i],
    ['shared validators', /shared validator|validators/i],
  ])('covers %s', (_label, pattern) => {
    expect(SERVER_INSTRUCTIONS).toMatch(pattern);
  });

  it('is short enough to be worth injecting into every session', () => {
    // Instructions are prepended to the agent's context. A wall of text competes with
    // the user's actual task; this is a checklist, not documentation.
    expect(SERVER_INSTRUCTIONS.length).toBeLessThan(2500);
    expect(SERVER_INSTRUCTIONS.length).toBeGreaterThan(400);
  });

  it('never invites the agent to edit code on the server behalf', () => {
    expect(SERVER_INSTRUCTIONS).not.toMatch(/this server (will|can) (edit|write|modify)/i);
  });
});

/**
 * A report produced WITH these instructions still described the API as shipping
 * "form(), Control, schema(), and [formField]". `Control` does not exist — it is the
 * pre-release name, and the compile harness proves the export is absent (TS2305).
 *
 * The recipes never mention it; the model reintroduced it from memory in its own prose.
 * Instructions cannot stop a model reasoning aloud, but they can name the specific wrong
 * answer, which is far more effective than a general "use the docs" instruction.
 */
describe('suppresses the known API hallucination', () => {
  it('names Control as non-existent', () => {
    expect(SERVER_INSTRUCTIONS).toContain('Control');
    expect(SERVER_INSTRUCTIONS).toMatch(/does not exist|no .?Control.? export/i);
  });

  it('names the correct binding directive alongside it', () => {
    expect(SERVER_INSTRUCTIONS).toContain('formField');
  });

  it('tells the agent not to name APIs the recipes did not give it', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/do not invent|only.*names.*recipes|from the recipes/i);
  });
});
