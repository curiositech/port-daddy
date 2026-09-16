/**
 * Gate-panel rendering tests (mediator-body slice 3 on the parleys HTML
 * surface; src/parleys-page.ts). Pure functions of view models — no session,
 * no D1, no HTTP — pinning:
 *
 *   - the pending gate renders LIVE Approve/Modify/Reject buttons for a
 *     named party, and the SAME buttons DISABLED (with the reason) when the
 *     fleet is paused or the mediator is killed — the "verdict buttons gray
 *     out when the fleet is paused" requirement, as markup;
 *   - a decided gate renders the write-once verdict record, with Modify's
 *     free text shown ESCAPED (model of hostile input);
 *   - the summons ledger renders delivery states + chain coordinates, and
 *     the agent-first (D11) legend;
 *   - the Helm-default expiry outcome renders on a lapsed parley;
 *   - a parley with no gate and no summonses renders neither panel.
 */

import { describe, it, expect } from 'vitest';
import { renderParleyDetailPage, type ParleyDetailView } from '../src/parleys-page.js';
import type {
  HarborRow,
  ParleyGateRow,
  ParleyPositionRow,
  ParleyRow,
  ParleySummonsRow,
  UserRow,
} from '../src/db.js';

const NOW = 1_754_700_000;

const alice = { id: 'u_alice', login: 'alice' } as UserRow;

const harbor: HarborRow = {
  id: 'h_dock',
  namespace: 'alice',
  name: 'dock',
  pubkey: 'ab'.repeat(32),
  created_by: 'u_alice',
  created_at: NOW - 90_000,
} as HarborRow;

function mkParley(over: Partial<ParleyRow> = {}): ParleyRow {
  return {
    id: 'p_1',
    harbor_id: 'h_dock',
    subject: '[pd-mediator] Predicted conflict: PR #1 ↔ PR #2 — 1 overlapping symbol before merge',
    proposer_id: 'u_alice',
    proposer_label: 'alice',
    state: 'open',
    deadline_at: NOW + 3600,
    created_at: NOW - 3600,
    resolved_at: null,
    convened_by: 'mediator',
    outcome_json: null,
    ...over,
  } as ParleyRow;
}

function seat(over: Partial<ParleyPositionRow>): ParleyPositionRow {
  return {
    parley_id: 'p_1',
    party_kind: 'user',
    party_id: 'u_alice',
    party_label: 'alice',
    tier: 'human',
    is_party: 1,
    stance: null,
    position: null,
    signed_at: null,
    claim_rank: null,
    ...over,
  } as ParleyPositionRow;
}

const positions: ParleyPositionRow[] = [
  seat({ claim_rank: 1 }),
  seat({ party_id: 'u_bob', party_label: 'bob', claim_rank: 2 }),
  seat({ party_kind: 'mediator', party_id: 'pd-mediator', party_label: 'pd-mediator', tier: 'mediator', is_party: 0 }),
];

function mkGate(over: Partial<ParleyGateRow> = {}): ParleyGateRow {
  return {
    parley_id: 'p_1',
    action: 'merge',
    state: 'pending',
    verdict_by: null,
    verdict_by_label: null,
    verdict_at: null,
    modify_text: null,
    created_at: NOW - 3600,
    ...over,
  } as ParleyGateRow;
}

function mkSummons(over: Partial<ParleySummonsRow> = {}): ParleySummonsRow {
  return {
    id: 'sm_1',
    parley_id: 'p_1',
    party_kind: 'user',
    party_id: 'u_alice',
    party_label: 'alice',
    daemon_fingerprint: 'cd'.repeat(32),
    summons_channel: 'fp:fleet-cloud:mediator:o-r:1-2',
    summons_seq: 1,
    summons_hash: 'a1b2'.repeat(16),
    issued_at: NOW - 3600,
    state: 'summoned',
    response_channel: null,
    response_seq: null,
    response_hash: null,
    responded_at: null,
    escalated_at: null,
    ...over,
  } as ParleySummonsRow;
}

function view(over: Partial<ParleyDetailView> = {}): ParleyDetailView {
  return {
    harbor,
    parley: mkParley(),
    positions,
    viewerSeat: positions[0]!,
    notice: null,
    nowSec: NOW,
    gate: null,
    summonses: [],
    fleetPaused: false,
    mediatorKilled: false,
    ...over,
  };
}

describe('gate panel', () => {
  it('pending + named party → live Approve/Modify/Reject buttons and the modify textarea', () => {
    const html = renderParleyDetailPage(alice, view({ gate: mkGate() }));
    expect(html).toContain('Human approve gate');
    expect(html).toContain('class="gb-action">merge<');
    expect(html).toContain('name="verdict" value="approve"');
    expect(html).toContain('name="verdict" value="modify"');
    expect(html).toContain('name="verdict" value="reject"');
    expect(html).not.toContain('value="approve" disabled');
    expect(html).toContain('name="modify_text"');
    expect(html).toContain('/account/parleys/alice/dock/p_1/verdict');
  });

  it('FLEET PAUSED → the same buttons render DISABLED, with the reason', () => {
    const html = renderParleyDetailPage(alice, view({ gate: mkGate(), fleetPaused: true }));
    expect(html).toContain('value="approve" disabled');
    expect(html).toContain('value="modify" disabled');
    expect(html).toContain('value="reject" disabled');
    expect(html).toContain('fleet is <b>paused</b>');
    expect(html).toContain('refuses to');
  });

  it('KILL-MEDIATOR → buttons disabled with the kill copy', () => {
    const html = renderParleyDetailPage(alice, view({ gate: mkGate(), mediatorKilled: true }));
    expect(html).toContain('value="approve" disabled');
    expect(html).toContain('kill-mediator');
  });

  it('a decided MODIFY gate renders the verdict record with the text ESCAPED', () => {
    const hostile = '<script>alert(1)</script> rebase onto #1 & drop "schema"';
    const html = renderParleyDetailPage(
      alice,
      view({
        gate: mkGate({ state: 'modified', verdict_by: 'u_alice', verdict_by_label: 'alice', verdict_at: NOW - 60, modify_text: hostile }),
      }),
    );
    expect(html).toContain('modified');
    expect(html).toContain('re-injected into the losing agent');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // Decided ⇒ no live form.
    expect(html).not.toContain('name="verdict" value="approve"');
  });

  it('pending + viewer NOT a named party → honest read-only panel, no buttons', () => {
    const html = renderParleyDetailPage(alice, view({ gate: mkGate(), viewerSeat: null }));
    expect(html).toContain('Awaiting a verdict from a named party');
    expect(html).not.toContain('name="verdict"');
  });

  it('no gate ⇒ no panel', () => {
    const html = renderParleyDetailPage(alice, view());
    expect(html).not.toContain('Human approve gate');
  });
});

describe('summons ledger', () => {
  it('renders delivery states, chain coordinates, and the D11 legend', () => {
    const html = renderParleyDetailPage(
      alice,
      view({
        summonses: [
          mkSummons({ state: 'acked', response_hash: 'ffee'.repeat(16), response_seq: 3, responded_at: NOW - 100 }),
          mkSummons({ id: 'sm_2', party_id: 'u_bob', party_label: 'bob', daemon_fingerprint: null, state: 'escalated', escalated_at: NOW - 50 }),
        ],
      }),
    );
    expect(html).toContain('Summonses');
    expect(html).toContain('delivery-acknowledged');
    expect(html).toContain('class="chip acked"');
    expect(html).toContain('class="chip escalated"');
    expect(html).toContain('no declared daemon');
    expect(html).toContain(`summons ${'a1b2'.repeat(4)}`); // 16-char hash prefix
    expect(html).toContain(`ack ${'ffee'.repeat(4)}`);
    expect(html).toContain('Agent-first');
    expect(html).toContain('wakes the human');
  });

  it('no summonses ⇒ no ledger', () => {
    expect(renderParleyDetailPage(alice, view())).not.toContain('Summonses');
  });
});

describe('helm-default expiry outcome', () => {
  it('renders the recorded first-claimant-proceeds default on a lapsed parley', () => {
    const outcome = {
      default: 'first-claimant-proceeds',
      source: 'helm-default',
      proceeds: { party: 'alice', pr: 1 },
      rebases: { party: 'bob', pr: 2 },
      repo: 'octo/repo',
      appliedAt: NOW - 10,
    };
    const html = renderParleyDetailPage(
      alice,
      view({ parley: mkParley({ state: 'lapsed', resolved_at: NOW - 10, outcome_json: JSON.stringify(outcome) }) }),
    );
    expect(html).toContain('the Helm&rsquo;s default outcome applied');
    expect(html).toContain('<b>alice</b> (PR #1) proceeds');
    expect(html).toContain('<b>bob</b> (PR #2) rebases');
    expect(html).toContain('recorded default');
    expect(html).toContain('not a signed agreement');
  });

  it('corrupt outcome_json renders as absent, never as a fabrication', () => {
    const html = renderParleyDetailPage(
      alice,
      view({ parley: mkParley({ state: 'lapsed', resolved_at: NOW - 10, outcome_json: '{{nope' }) }),
    );
    expect(html).not.toContain('default outcome applied');
  });
});
