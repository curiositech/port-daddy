/**
 * The reasoning-effort rung is part of the request, and the registry owns it.
 *
 * WHY THIS SUITE EXISTS. The canonical model registry made it impossible to name
 * a model id that does not exist. It did not make it impossible to send that
 * valid id a parameter VALUE it rejects — and on 2026-08-23 a live probe found
 * the OpenAI backend returning HTTP 400 on four of its five capability rungs,
 * every time, because the adapter hardcoded `reasoning: { effort: 'minimal' }`.
 * That value was correct for the original gpt-5 generation and is accepted by
 * exactly one model in the current lineup: gpt-5-mini, which happens to be the
 * `cheap` rung, which is the only rung the cost-capped smokes exercised. So the
 * backend looked healthy while balanced, high, max-thinking and code were dead.
 *
 * The lesson generalises past this one parameter: a registry that pins the id
 * but not the id's accepted inputs leaves a phantom-shaped gap one level down.
 * These tests pin the three properties that close it — the accepted set is
 * declared per row, a request is CLAMPED into that set rather than refused, and
 * a model the registry has never seen gets no invented parameter at all.
 */

import { describe, test, expect, beforeAll } from '@jest/globals';

let resolveReasoningEffort;
let reasoningEffortsFor;
let resolveModel;
let CAPABILITIES;
let MODEL_REGISTRY_DATA;

beforeAll(async () => {
  ({ resolveReasoningEffort, reasoningEffortsFor, resolveModel, CAPABILITIES } = await import(
    '../../lib/model-registry.js'
  ));
  ({ MODEL_REGISTRY_DATA } = await import('../../lib/model-registry-data.js'));
});

describe('every rung the OpenAI backend resolves is sendable', () => {
  test('no rung resolves to a model whose default effort it rejects', () => {
    // This is the exact defect, expressed as an invariant: walk the ladder the
    // way the daemon does and check the value the adapter would actually send.
    for (const capability of CAPABILITIES) {
      const model = resolveModel({ backend: 'openai', capability });
      const accepted = reasoningEffortsFor(model);
      if (accepted.length === 0) continue; // Takes no effort parameter at all.
      const sending = resolveReasoningEffort(model);
      expect(`${capability}/${model}/${sending}/${accepted.includes(sending) ? 'ok' : 'REJECTED'}`)
        .toBe(`${capability}/${model}/${sending}/ok`);
    }
  });

  test('`minimal` is NOT assumed to be universally available', () => {
    // The regression in one line: only the oldest model in the lineup takes it.
    const takesMinimal = Object.entries(MODEL_REGISTRY_DATA.models)
      .filter(([, row]) => (row.reasoningEfforts ?? []).includes('minimal'))
      .map(([id]) => id);
    const declaresEfforts = Object.entries(MODEL_REGISTRY_DATA.models)
      .filter(([, row]) => (row.reasoningEfforts ?? []).length > 0)
      .map(([id]) => id);
    expect(declaresEfforts.length).toBeGreaterThan(1);
    expect(takesMinimal.length).toBeLessThan(declaresEfforts.length);
  });
});

describe('resolveReasoningEffort clamps rather than refusing', () => {
  test('an effort above the model ceiling lands on its highest', () => {
    // A caller asking for the deepest thinking wants the deepest AVAILABLE
    // thinking. Refusing would convert a survivable mismatch into a dead
    // backend, which is the failure the failover work in this slice prevents.
    const capped = Object.entries(MODEL_REGISTRY_DATA.models).find(
      ([, row]) => (row.reasoningEfforts ?? []).length > 0 && !row.reasoningEfforts.includes('max'),
    );
    expect(capped).toBeDefined();
    const [id, row] = capped;
    const got = resolveReasoningEffort(id, 'max');
    expect(row.reasoningEfforts).toContain(got);
    expect(got).not.toBe('max');
  });

  test('an effort below the model floor lands on its lowest', () => {
    // gpt-5.5-pro cannot switch thinking off; asking it to is not an error.
    const floored = Object.entries(MODEL_REGISTRY_DATA.models).find(
      ([, row]) =>
        (row.reasoningEfforts ?? []).length > 0
        && !row.reasoningEfforts.includes('none')
        && !row.reasoningEfforts.includes('minimal'),
    );
    expect(floored).toBeDefined();
    const [id, row] = floored;
    const got = resolveReasoningEffort(id, 'none');
    expect(row.reasoningEfforts).toContain(got);
  });

  test('a supported effort is passed through unchanged', () => {
    const [id, row] = Object.entries(MODEL_REGISTRY_DATA.models).find(
      ([, r]) => (r.reasoningEfforts ?? []).length > 1,
    );
    for (const effort of row.reasoningEfforts) {
      expect(resolveReasoningEffort(id, effort)).toBe(effort);
    }
  });

  test('an effort name off the ladder entirely falls back to the row default', () => {
    const [id, row] = Object.entries(MODEL_REGISTRY_DATA.models).find(
      ([, r]) => (r.reasoningEfforts ?? []).length > 0 && r.defaultEffort,
    );
    expect(resolveReasoningEffort(id, 'turbo-ultra')).toBe(row.defaultEffort);
  });
});

describe('an unknown model gets no invented parameter', () => {
  test('resolves to undefined so the caller omits the field', () => {
    // Sending a guessed parameter with an unrecognised id is two guesses instead
    // of one; the API's own default is right and costs nothing to accept.
    expect(resolveReasoningEffort('some-model-nobody-catalogued')).toBeUndefined();
    expect(resolveReasoningEffort('some-model-nobody-catalogued', 'high')).toBeUndefined();
    expect(reasoningEffortsFor('some-model-nobody-catalogued')).toEqual([]);
  });
});

describe('the source declares the accepted set honestly', () => {
  test('every declared defaultEffort is inside its own accepted set', () => {
    // The generator refuses to emit otherwise; this asserts the emitted artifact
    // agrees, so a hand-edit of the generated file is caught here too.
    for (const [id, row] of Object.entries(MODEL_REGISTRY_DATA.models)) {
      if (!row.defaultEffort) continue;
      expect(`${id}:${row.reasoningEfforts?.includes(row.defaultEffort) ? 'ok' : 'OUTSIDE'}`).toBe(
        `${id}:ok`,
      );
    }
  });

  test('the default is the cheapest rung the model accepts', () => {
    // Responses API caps count reasoning tokens against max_output_tokens, so an
    // expensive default silently shrinks every cost-capped run's answer budget.
    const LADDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    for (const [id, row] of Object.entries(MODEL_REGISTRY_DATA.models)) {
      if (!row.defaultEffort || !row.reasoningEfforts?.length) continue;
      const ranked = [...row.reasoningEfforts].sort((a, b) => LADDER.indexOf(a) - LADDER.indexOf(b));
      // `none` disables reasoning outright, which is a different thing from
      // cheap thinking — the default may legitimately skip it.
      const cheapest = ranked.filter((e) => e !== 'none')[0];
      expect(`${id}:${row.defaultEffort}`).toBe(`${id}:${cheapest}`);
    }
  });
});
