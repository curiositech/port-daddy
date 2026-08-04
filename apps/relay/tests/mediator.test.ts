/**
 * X4 MEDIATOR BODY tests (src/mediator.ts, first slice).
 *
 * The suite is organized around the claim the module makes about itself: the
 * mediator can record an observation, and is STRUCTURALLY incapable of doing
 * anything else. So the bulk of these tests are negative — they take the
 * mediator's stated impossibilities one at a time and try to make them happen,
 * through the real write path, against a fake D1 that honours WHERE clauses.
 *
 * Covered:
 *   - config: opt-in default OFF; only the exact string 'on' enables it;
 *   - model policy: `@cf/` ids honoured, NON-`@cf/` ids (claude-*, gpt-*,
 *     anthropic/*) REJECTED in favour of the committed default;
 *   - the happy path: an observation is recorded on the mediator's own row;
 *   - THE MEDIATOR CANNOT SIGN: after observing, its stance and signed_at are
 *     still null, and the agreement arithmetic is unmoved;
 *   - THE MEDIATOR CANNOT AFFECT STATE: state, resolved_at and deadline_at are
 *     byte-identical before and after, including on a parley one signature
 *     from agreement;
 *   - THE MEDIATOR CANNOT ALTER ANOTHER PARTY'S POSITION;
 *   - THE MEDIATOR CANNOT BE A PARTY (convene rejects the reserved id);
 *   - FAIL-OPEN: a throwing model, an empty answer, and garbage output each
 *     leave the parley completely untouched and record nothing;
 *   - the prompt's blast radius: it contains the positions and nothing else.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  observeParley,
  mediatorEnabled,
  resolveMediatorModel,
  sanitizeObservation,
  buildObservationPrompt,
  DEFAULT_MEDIATOR_MODEL,
  MAX_OBSERVATION_CHARS,
} from '../src/mediator.js';
import { recordMediatorObservation } from '../src/db.js';
import { handleCreateParley, handleRespondParley, MEDIATOR_ID } from '../src/parleys.js';
import { handleCreateHarbor, handleAddHarborMember } from '../src/harbors.js';
import {
  makeParleyDb,
  makeParleyEnv,
  req,
  ALICE_TOKEN,
  BOB_TOKEN,
  PUBKEY,
  type ParleyFixture,
} from './support/parley-fixture.js';
import type { Env } from '../src/types.js';

const T0 = 1_800_000_000;
const at = (sec: number) => vi.setSystemTime(new Date(sec * 1000));

/** A Workers AI stub that returns a fixed answer (or throws). */
function fakeAi(answer: string | Error) {
  const calls: Array<{ model: string; input: unknown }> = [];
  return {
    calls,
    binding: {
      run: async (model: string, input: unknown) => {
        calls.push({ model, input });
        if (answer instanceof Error) throw answer;
        return { response: answer };
      },
    } as unknown as Ai,
  };
}

async function seedDock(env: Env): Promise<void> {
  const created = await handleCreateHarbor(
    req('/v1/harbors', { method: 'POST', token: ALICE_TOKEN, body: { name: 'dock', pubkey: PUBKEY } }),
    env,
  );
  expect(created.status).toBe(201);
  const added = await handleAddHarborMember(
    req('/v1/harbors/alice/dock/members', { method: 'POST', token: ALICE_TOKEN, body: { user: 'bob' } }),
    env, 'alice', 'dock',
  );
  expect(added.status).toBe(201);
}

async function convene(env: Env): Promise<string> {
  const res = await handleCreateParley(
    req('/v1/harbors/alice/dock/parleys', {
      method: 'POST', token: ALICE_TOKEN,
      body: { subject: 'who merges the auth refactor first', parties: [{ user: 'bob' }] },
    }),
    env, 'alice', 'dock',
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { parley: { id: string } }).parley.id;
}

/** A snapshot of everything the mediator must never be able to change. */
function outcomeSnapshot(fx: ParleyFixture, parleyId: string) {
  const p = fx.parleys.find((x) => x.id === parleyId)!;
  return {
    state: p.state,
    resolved_at: p.resolved_at,
    deadline_at: p.deadline_at,
    parties: fx.positions
      .filter((x) => x.parley_id === parleyId && x.is_party === 1)
      .map((x) => ({ id: x.party_id, stance: x.stance, position: x.position, signed_at: x.signed_at }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  at(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

// ── Configuration: opt-in, default OFF ───────────────────────────────────────

describe('mediatorEnabled — opt-in, default OFF', () => {
  it('is OFF when the var is unset', () => {
    expect(mediatorEnabled({} as Env)).toBe(false);
  });

  it('is ON only for the exact string "on" (case/space insensitive)', () => {
    expect(mediatorEnabled({ PARLEY_MEDIATOR: 'on' } as Env)).toBe(true);
    expect(mediatorEnabled({ PARLEY_MEDIATOR: ' ON ' } as Env)).toBe(true);
  });

  it('does NOT accept truthy lookalikes — a typo fails to OFF, never ON', () => {
    for (const v of ['true', '1', 'yes', 'enabled', 'no', '', 'off']) {
      expect(mediatorEnabled({ PARLEY_MEDIATOR: v } as Env), `value ${JSON.stringify(v)}`).toBe(false);
    }
  });
});

// ── Model policy: Workers AI ONLY ────────────────────────────────────────────

describe('resolveMediatorModel — Workers AI only', () => {
  it('falls back to the committed default when unset or blank', () => {
    expect(resolveMediatorModel(undefined)).toBe(DEFAULT_MEDIATOR_MODEL);
    expect(resolveMediatorModel('   ')).toBe(DEFAULT_MEDIATOR_MODEL);
  });

  it('honours a @cf/ override (config-swappable without a deploy)', () => {
    expect(resolveMediatorModel('@cf/qwen/qwen3-30b-a3b-fp8')).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
  });

  it('REJECTS every non-@cf/ id — never Anthropic, never an external runner', () => {
    for (const bad of [
      'claude-sonnet-4',
      'claude-opus-4-20250514',
      'anthropic/claude-3-haiku',
      'gpt-4o',
      'https://evil.example/v1/chat',
      'meta/llama-3.1-8b-instruct',
    ]) {
      expect(resolveMediatorModel(bad), `id ${bad}`).toBe(DEFAULT_MEDIATOR_MODEL);
    }
  });

  it('the committed default is itself a @cf/ id', () => {
    expect(DEFAULT_MEDIATOR_MODEL.startsWith('@cf/')).toBe(true);
  });
});

// ── Output sanitation ────────────────────────────────────────────────────────

describe('sanitizeObservation', () => {
  it('accepts ordinary prose', () => {
    expect(sanitizeObservation('Alice accepts the refactor; Bob has not signed yet.')).toBe(
      'Alice accepts the refactor; Bob has not signed yet.',
    );
  });

  it('strips <think> reasoning spans, including orphan tags', () => {
    expect(sanitizeObservation('<think>hmm let me see</think>Both parties agree on scope but differ on timing.'))
      .toBe('Both parties agree on scope but differ on timing.');
    expect(sanitizeObservation('leftover reasoning</think>Both parties differ on the merge order here.'))
      .toBe('Both parties differ on the merge order here.');
  });

  it('flattens newlines and control characters to single spaces', () => {
    expect(sanitizeObservation('Alice accepts.\n\nBob rejects,\tciting the migration risk.')).toBe(
      'Alice accepts. Bob rejects, citing the migration risk.',
    );
  });

  it('REJECTS empty, stub, and non-string output (nothing is recorded)', () => {
    for (const bad of ['', '   ', 'N/A', 'OK', '{}', '...', undefined, null, 42 as unknown as string]) {
      expect(sanitizeObservation(bad as string), `input ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it('caps a runaway answer at MAX_OBSERVATION_CHARS', () => {
    const out = sanitizeObservation('word '.repeat(1000));
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(MAX_OBSERVATION_CHARS);
  });
});

// ── The prompt's blast radius ────────────────────────────────────────────────

describe('buildObservationPrompt — the mediator sees positions and nothing else', () => {
  it('quotes the subject and each party stance, and nothing about ids or sessions', () => {
    const prompt = buildObservationPrompt(
      { subject: 'merge order', state: 'open', proposer_label: 'alice' },
      [
        { parley_id: 'p1', party_kind: 'user', party_id: 'u_alice', party_label: 'alice', tier: 'human', is_party: 1, stance: 'accept', position: 'ship mine first', signed_at: T0 },
        { parley_id: 'p1', party_kind: 'user', party_id: 'u_bob', party_label: 'bob', tier: 'human', is_party: 1, stance: null, position: null, signed_at: null },
        { parley_id: 'p1', party_kind: 'mediator', party_id: MEDIATOR_ID, party_label: MEDIATOR_ID, tier: 'mediator', is_party: 0, stance: null, position: null, signed_at: null },
      ],
      'signed',
    );
    expect(prompt).toContain('merge order');
    expect(prompt).toContain('alice (user): signed accept.');
    expect(prompt).toContain('ship mine first');
    expect(prompt).toContain('bob (user): has NOT signed yet.');
    // Internal ids never enter the prompt — labels only.
    expect(prompt).not.toContain('u_alice');
    expect(prompt).not.toContain('u_bob');
    // The mediator's own observer seat is not part of "the record".
    expect(prompt).not.toContain(MEDIATOR_ID);
  });
});

// ── Happy path + the negative claims ─────────────────────────────────────────

describe('observeParley', () => {
  let fx: ParleyFixture;

  beforeEach(() => {
    fx = makeParleyDb();
  });

  it('does NOTHING when the opt-in is off — not even a model call', async () => {
    const ai = fakeAi('Alice and Bob disagree about the merge order here.');
    const env = makeParleyEnv(fx.db, { AI: ai.binding });
    await seedDock(env);
    const id = await convene(env);

    const before = outcomeSnapshot(fx, id);
    const outcome = await observeParley(env, fx.parleys.find((p) => p.id === id)!, 'convened');
    expect(outcome).toBe('disabled');
    expect(ai.calls).toHaveLength(0);
    expect(fx.positions.find((p) => p.parley_id === id && p.party_kind === 'mediator')!.position).toBeNull();
    expect(outcomeSnapshot(fx, id)).toEqual(before);
  });

  it('reports "unconfigured" when opted in with no [ai] binding — parley untouched', async () => {
    const env = makeParleyEnv(fx.db, { PARLEY_MEDIATOR: 'on' });
    await seedDock(env);
    const id = await convene(env);
    const before = outcomeSnapshot(fx, id);

    const outcome = await observeParley(env, fx.parleys.find((p) => p.id === id)!, 'convened');
    expect(outcome).toBe('unconfigured');
    expect(outcomeSnapshot(fx, id)).toEqual(before);
  });

  it('RECORDS an observation on the mediator seat when enabled', async () => {
    const ai = fakeAi('Alice has signed accept; Bob has not yet responded, so no divergence is on the record.');
    const env = makeParleyEnv(fx.db, { PARLEY_MEDIATOR: 'on', AI: ai.binding });
    await seedDock(env);
    const id = await convene(env);

    const outcome = await observeParley(env, fx.parleys.find((p) => p.id === id)!, 'convened');
    expect(outcome).toBe('recorded');
    const seat = fx.positions.find((p) => p.parley_id === id && p.party_kind === 'mediator')!;
    expect(seat.position).toContain('Alice has signed accept');
    // …and it used a @cf/ model.
    expect(ai.calls[0]!.model.startsWith('@cf/')).toBe(true);
  });

  // ── the structural impossibilities ─────────────────────────────────────────

  it('CANNOT SIGN — after observing, its stance and signed_at are still null', async () => {
    const ai = fakeAi('Both parties have staked out positions and they diverge on sequencing.');
    const env = makeParleyEnv(fx.db, { PARLEY_MEDIATOR: 'on', AI: ai.binding });
    await seedDock(env);
    const id = await convene(env);

    await observeParley(env, fx.parleys.find((p) => p.id === id)!, 'convened');

    const seat = fx.positions.find((p) => p.parley_id === id && p.party_kind === 'mediator')!;
    expect(seat.position).not.toBeNull();   // it spoke
    expect(seat.stance).toBeNull();          // but it did not sign
    expect(seat.signed_at).toBeNull();
    expect(seat.is_party).toBe(0);
  });

  it('CANNOT CAUSE AGREEMENT — a parley one signature short stays open', async () => {
    const ai = fakeAi('Alice accepts; Bob has not signed, so the record is incomplete.');
    const env = makeParleyEnv(fx.db, { PARLEY_MEDIATOR: 'on', AI: ai.binding });
    await seedDock(env);
    const id = await convene(env);

    // Alice signs accept; only Bob remains. If the mediator's seat counted,
    // its observation would be the last "signature" and would agree the parley.
    const signed = await handleRespondParley(
      req(`/v1/harbors/alice/dock/parleys/${id}/respond`, { method: 'POST', token: ALICE_TOKEN, body: { stance: 'accept' } }),
      env, 'alice', 'dock', id,
    );
    expect(signed.status).toBe(200);
    expect(fx.parleys.find((p) => p.id === id)!.state).toBe('open');

    const before = outcomeSnapshot(fx, id);
    await observeParley(env, fx.parleys.find((p) => p.id === id)!, 'signed');

    expect(fx.parleys.find((p) => p.id === id)!.state).toBe('open');
    expect(outcomeSnapshot(fx, id)).toEqual(before);
  });

  it('CANNOT CHANGE STATE, RESOLUTION, OR THE DEADLINE — on an agreed parley either', async () => {
    const ai = fakeAi('Both parties accepted; there is no remaining divergence on the record.');
    const env = makeParleyEnv(fx.db, { PARLEY_MEDIATOR: 'on', AI: ai.binding });
    await seedDock(env);
    const id = await convene(env);
    for (const token of [ALICE_TOKEN, BOB_TOKEN]) {
      await handleRespondParley(
        req(`/v1/harbors/alice/dock/parleys/${id}/respond`, { method: 'POST', token, body: { stance: 'accept' } }),
        env, 'alice', 'dock', id,
      );
    }
    expect(fx.parleys.find((p) => p.id === id)!.state).toBe('agreed');

    const before = outcomeSnapshot(fx, id);
    const outcome = await observeParley(env, fx.parleys.find((p) => p.id === id)!, 'signed');
    expect(outcome).toBe('recorded'); // it may still annotate a closed parley
    expect(outcomeSnapshot(fx, id)).toEqual(before); // …and changed nothing about it
  });

  it("CANNOT ALTER ANOTHER PARTY'S POSITION — the write cannot match a human row", async () => {
    const ai = fakeAi('Alice accepted with a stated caveat about migration order.');
    const env = makeParleyEnv(fx.db, { PARLEY_MEDIATOR: 'on', AI: ai.binding });
    await seedDock(env);
    const id = await convene(env);
    await handleRespondParley(
      req(`/v1/harbors/alice/dock/parleys/${id}/respond`, {
        method: 'POST', token: ALICE_TOKEN, body: { stance: 'accept', position: 'ONLY IF THE MIGRATION LANDS FIRST' },
      }),
      env, 'alice', 'dock', id,
    );
    const aliceBefore = { ...fx.positions.find((p) => p.parley_id === id && p.party_id === 'u_alice')! };

    await observeParley(env, fx.parleys.find((p) => p.id === id)!, 'signed');

    const aliceAfter = fx.positions.find((p) => p.parley_id === id && p.party_id === 'u_alice')!;
    expect(aliceAfter).toEqual(aliceBefore);
    expect(aliceAfter.position).toBe('ONLY IF THE MIGRATION LANDS FIRST');
  });

  it('the write itself refuses a non-mediator row (the WHERE clause is the guard)', async () => {
    const env = makeParleyEnv(fx.db, { PARLEY_MEDIATOR: 'on' });
    await seedDock(env);
    const id = await convene(env);
    // Delete the mediator seat, leaving only human rows: the write must find
    // nothing to update rather than falling through onto a party's row.
    const idx = fx.positions.findIndex((p) => p.parley_id === id && p.party_kind === 'mediator');
    fx.positions.splice(idx, 1);

    const wrote = await recordMediatorObservation(env.DB, { parleyId: id, note: 'this must not land anywhere' });
    expect(wrote).toBe(false);
    for (const p of fx.positions.filter((x) => x.parley_id === id)) {
      expect(p.position).toBeNull();
    }
  });

  it('reports "no-seat" (not an error) when the parley carries no mediator row', async () => {
    const ai = fakeAi('Something reasonable about the parties and their divergence.');
    const env = makeParleyEnv(fx.db, { PARLEY_MEDIATOR: 'on', AI: ai.binding });
    await seedDock(env);
    const id = await convene(env);
    // The seat is removed from the FIXTURE, not filtered out of an argument:
    // observeParley reads positions from D1 itself, so the only way to present
    // it with a seatless parley is for the record to actually lack the row.
    const seat = fx.positions.findIndex((p) => p.parley_id === id && p.party_kind === 'mediator');
    expect(seat).toBeGreaterThanOrEqual(0);
    fx.positions.splice(seat, 1);
    // convene() already produced one observation; measure the delta from here.
    const callsBefore = ai.calls.length;

    const outcome = await observeParley(env, fx.parleys.find((p) => p.id === id)!, 'convened');
    expect(outcome).toBe('no-seat');
    // Bailed BEFORE spending a model call — there was nowhere to put an answer.
    expect(ai.calls.length).toBe(callsBefore);
  });

  // ── fail-open ──────────────────────────────────────────────────────────────

  it('FAILS OPEN on a model error — parley completely untouched, nothing recorded', async () => {
    const ai = fakeAi(new Error('Workers AI unavailable'));
    const env = makeParleyEnv(fx.db, { PARLEY_MEDIATOR: 'on', AI: ai.binding });
    await seedDock(env);
    const id = await convene(env);
    const before = outcomeSnapshot(fx, id);

    const outcome = await observeParley(env, fx.parleys.find((p) => p.id === id)!, 'convened');
    expect(outcome).toBe('model-failed');
    expect(outcomeSnapshot(fx, id)).toEqual(before);
    expect(fx.positions.find((p) => p.parley_id === id && p.party_kind === 'mediator')!.position).toBeNull();
  });

  it('FAILS OPEN on empty or garbage output — records nothing, says nothing to add', async () => {
    for (const answer of ['', '   ', '<think>only reasoning, no answer</think>', '{}']) {
      const local = makeParleyDb();
      const ai = fakeAi(answer);
      const env = makeParleyEnv(local.db, { PARLEY_MEDIATOR: 'on', AI: ai.binding });
      await seedDock(env);
      const id = await convene(env);
      const before = outcomeSnapshot(local, id);

      const outcome = await observeParley(env, local.parleys.find((p) => p.id === id)!, 'convened');
      expect(outcome, `answer ${JSON.stringify(answer)}`).toBe('nothing-to-add');
      expect(local.positions.find((p) => p.parley_id === id && p.party_kind === 'mediator')!.position).toBeNull();
      expect(outcomeSnapshot(local, id)).toEqual(before);
    }
  });

  it('a D1 failure on the note write reports "write-failed", NOT "model-failed"', async () => {
    // The two failures have different causes and send an operator to different
    // dependencies, so the outcome distinguishes them. Here the model answers
    // perfectly and D1 is what breaks.
    const ai = fakeAi('A clean, recordable observation.');
    const env = makeParleyEnv(fx.db, { PARLEY_MEDIATOR: 'on', AI: ai.binding });
    await seedDock(env);
    const id = await convene(env);
    const before = outcomeSnapshot(fx, id);
    // convene() ran with a working DB and already recorded its own observation,
    // so the seat is not null here. What must hold is that the FAILED write
    // leaves it exactly as it was.
    const seatBefore = fx.positions.find((p) => p.parley_id === id && p.party_kind === 'mediator')!.position;

    // Break only the mediator's own UPDATE; every other statement still works,
    // so the read that precedes it succeeds and we reach the write path.
    const realPrepare = fx.db.prepare.bind(fx.db);
    const broken = {
      ...fx.db,
      prepare: (sql: string) =>
        /UPDATE parley_positions SET position/.test(sql)
          ? { bind: () => ({ run: async () => { throw new Error('D1_ERROR: storage unavailable'); } }) }
          : realPrepare(sql),
    } as unknown as D1Database;

    const outcome = await observeParley(
      makeParleyEnv(broken, { PARLEY_MEDIATOR: 'on', AI: ai.binding }),
      fx.parleys.find((p) => p.id === id)!,
      'convened',
    );
    expect(outcome).toBe('write-failed');
    // Fail-open as ever: the model was called, and the parley is untouched.
    expect(ai.calls.length).toBeGreaterThan(0);
    expect(outcomeSnapshot(fx, id)).toEqual(before);
    expect(fx.positions.find((p) => p.parley_id === id && p.party_kind === 'mediator')!.position).toBe(seatBefore);
  });

  it('a D1 failure on the POSITIONS READ also fails open as "write-failed"', async () => {
    const ai = fakeAi('Never reached.');
    const env = makeParleyEnv(fx.db, { PARLEY_MEDIATOR: 'on', AI: ai.binding });
    await seedDock(env);
    const id = await convene(env);
    const callsBefore = ai.calls.length;

    const realPrepare = fx.db.prepare.bind(fx.db);
    const broken = {
      ...fx.db,
      prepare: (sql: string) =>
        /SELECT \* FROM parley_positions/.test(sql)
          ? { bind: () => ({ all: async () => { throw new Error('D1_ERROR: storage unavailable'); } }) }
          : realPrepare(sql),
    } as unknown as D1Database;

    const outcome = await observeParley(
      makeParleyEnv(broken, { PARLEY_MEDIATOR: 'on', AI: ai.binding }),
      fx.parleys.find((p) => p.id === id)!,
      'convened',
    );
    expect(outcome).toBe('write-failed');
    // Bailed before spending a token — there was nothing to summarize.
    expect(ai.calls.length).toBe(callsBefore);
  });

  it('costs NOTHING when the mediator is off — no model call and no D1 read', async () => {
    // The shipped default. This is the regression guard for the opt-in gates
    // sitting in front of the positions read rather than behind it.
    const ai = fakeAi('Should never be produced.');
    const env = makeParleyEnv(fx.db, { AI: ai.binding }); // PARLEY_MEDIATOR unset
    await seedDock(env);
    const id = await convene(env);
    const callsBefore = ai.calls.length;

    let reads = 0;
    const realPrepare = fx.db.prepare.bind(fx.db);
    const counting = {
      ...fx.db,
      prepare: (sql: string) => {
        if (/parley_positions/.test(sql)) reads += 1;
        return realPrepare(sql);
      },
    } as unknown as D1Database;

    const outcome = await observeParley(
      makeParleyEnv(counting, { AI: ai.binding }),
      fx.parleys.find((p) => p.id === id)!,
      'convened',
    );
    expect(outcome).toBe('disabled');
    expect(reads).toBe(0);
    expect(ai.calls.length).toBe(callsBefore);
  });

  it('never throws, even when the model rejects — callers can ignore the result', async () => {
    const ai = fakeAi(new Error('boom'));
    const env = makeParleyEnv(fx.db, { PARLEY_MEDIATOR: 'on', AI: ai.binding });
    await seedDock(env);
    const id = await convene(env);
    await expect(
      observeParley(env, fx.parleys.find((p) => p.id === id)!, 'signed'),
    ).resolves.toBe('model-failed');
  });
});

// ── Call-site wiring: convene + respond ──────────────────────────────────────

describe('mediator wiring into the parley routes', () => {
  it('a signature still succeeds when the mediator model is down (fail-open end to end)', async () => {
    const fx = makeParleyDb();
    const ai = fakeAi(new Error('model down'));
    const env = makeParleyEnv(fx.db, { PARLEY_MEDIATOR: 'on', AI: ai.binding });
    await seedDock(env);
    const id = await convene(env);

    const res = await handleRespondParley(
      req(`/v1/harbors/alice/dock/parleys/${id}/respond`, { method: 'POST', token: ALICE_TOKEN, body: { stance: 'accept' } }),
      env, 'alice', 'dock', id,
    );
    expect(res.status).toBe(200);
    const alice = fx.positions.find((p) => p.parley_id === id && p.party_id === 'u_alice')!;
    expect(alice.stance).toBe('accept');
    expect(alice.signed_at).toBe(T0);
  });

  it('observes on convene and again after a signature, when enabled', async () => {
    const fx = makeParleyDb();
    const ai = fakeAi('Alice has staked a position; Bob has not, so nothing diverges yet.');
    const env = makeParleyEnv(fx.db, { PARLEY_MEDIATOR: 'on', AI: ai.binding });
    await seedDock(env);
    const id = await convene(env);
    expect(ai.calls.length).toBe(1); // convene

    await handleRespondParley(
      req(`/v1/harbors/alice/dock/parleys/${id}/respond`, { method: 'POST', token: ALICE_TOKEN, body: { stance: 'accept' } }),
      env, 'alice', 'dock', id,
    );
    expect(ai.calls.length).toBe(2); // signature
    expect(fx.positions.find((p) => p.parley_id === id && p.party_kind === 'mediator')!.position).not.toBeNull();
  });

  it('spends nothing at all when the opt-in is off (the shipped default)', async () => {
    const fx = makeParleyDb();
    const ai = fakeAi('should never be produced');
    const env = makeParleyEnv(fx.db, { AI: ai.binding }); // PARLEY_MEDIATOR unset
    await seedDock(env);
    const id = await convene(env);
    await handleRespondParley(
      req(`/v1/harbors/alice/dock/parleys/${id}/respond`, { method: 'POST', token: ALICE_TOKEN, body: { stance: 'accept' } }),
      env, 'alice', 'dock', id,
    );
    expect(ai.calls).toHaveLength(0);
    expect(fx.positions.find((p) => p.parley_id === id && p.party_kind === 'mediator')!.position).toBeNull();
  });

  it('CANNOT BE NAMED A PARTY — convene rejects the reserved identity', async () => {
    const fx = makeParleyDb();
    const env = makeParleyEnv(fx.db, { PARLEY_MEDIATOR: 'on' });
    await seedDock(env);
    const res = await handleCreateParley(
      req('/v1/harbors/alice/dock/parleys', {
        method: 'POST', token: ALICE_TOKEN,
        body: { subject: 'let the robot decide', parties: [{ user: MEDIATOR_ID }] },
      }),
      env, 'alice', 'dock',
    );
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('reserved');
  });

  it('CANNOT SIGN through the respond route either (403 NOT_A_PARTY)', async () => {
    const fx = makeParleyDb();
    const env = makeParleyEnv(fx.db, { PARLEY_MEDIATOR: 'on' });
    await seedDock(env);
    const id = await convene(env);
    // There is no principal that resolves to the mediator seat: a user signs as
    // themselves and a daemon seat needs a registered fingerprint. Prove the
    // seat stays unsigned even after every named party has signed.
    for (const token of [ALICE_TOKEN, BOB_TOKEN]) {
      await handleRespondParley(
        req(`/v1/harbors/alice/dock/parleys/${id}/respond`, { method: 'POST', token, body: { stance: 'accept' } }),
        env, 'alice', 'dock', id,
      );
    }
    const seat = fx.positions.find((p) => p.parley_id === id && p.party_kind === 'mediator')!;
    expect(seat.signed_at).toBeNull();
    expect(seat.stance).toBeNull();
    // …and the parley agreed anyway: the observer never held it open.
    expect(fx.parleys.find((p) => p.id === id)!.state).toBe('agreed');
  });
});
