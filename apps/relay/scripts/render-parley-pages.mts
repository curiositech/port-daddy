/**
 * Render the parley HTML surface to static files for visual capture.
 *
 * Motivation: screenshots are only evidence if they come from the SAME
 * renderers the Worker serves. This script imports `renderParleyListPage` and
 * `renderParleyDetailPage` directly and feeds them realistic view models, so a
 * captured PNG is a picture of production markup — not a mockup, and not a
 * hand-written HTML approximation that could look right while the real page
 * looks wrong.
 *
 * Run with: npx vite-node scripts/render-parley-pages.mts
 * Output:   .artifacts/parley-list.html, .artifacts/parley-detail.html
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { renderParleyListPage, renderParleyDetailPage } from '../src/parleys-page.js';
import type {
  UserRow,
  ParleyRow,
  ParleyPositionRow,
  ParleyGateRow,
  ParleySummonsRow,
  HarborRow,
} from '../src/db.js';

const NOW = Math.floor(Date.parse('2026-08-04T18:00:00Z') / 1000);
const OUT = new URL('../.artifacts/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const alice: UserRow = {
  id: 'u_alice',
  github_user_id: 1,
  login: 'alice',
  display_name: 'Alice Meridian',
  avatar_url: null,
  primary_email: 'alice@example.com',
  email_verified: 1,
  created_at: NOW - 900_000,
  last_login_at: NOW - 400,
  deleted_at: null,
} as UserRow;

const dock: HarborRow = {
  id: 'h_dock',
  namespace: 'alice',
  name: 'dock',
  pubkey: 'ab'.repeat(32),
  created_by: 'u_alice',
  created_at: NOW - 900_000,
} as HarborRow;

const yard: HarborRow = { ...dock, id: 'h_yard', name: 'yard' };

const mkParley = (o: Partial<ParleyRow> & { id: string; subject: string }): ParleyRow => ({
  harbor_id: 'h_dock',
  proposer_id: 'u_alice',
  proposer_label: 'alice',
  state: 'open',
  deadline_at: NOW + 11 * 3600 + 24 * 60,
  created_at: NOW - 12 * 3600,
  resolved_at: null,
  convened_by: 'user',
  outcome_json: null,
  ...o,
}) as ParleyRow;

// ── list page ────────────────────────────────────────────────────────────────

const items = [
  {
    parley: mkParley({
      id: 'p_0a91',
      subject: 'Who lands the auth refactor first — PR #4812 or PR #4830',
      deadline_at: NOW + 11 * 3600 + 24 * 60,
    }),
    parties: 3,
    signed: 1,
  },
  {
    parley: mkParley({
      id: 'p_1b42',
      subject: 'Freeze the harbor-card wire format until the v3 parity vectors land',
      deadline_at: NOW + 40 * 60,
      created_at: NOW - 23 * 3600,
    }),
    parties: 2,
    signed: 1,
  },
  {
    parley: mkParley({
      id: 'p_2c73',
      subject: 'Retire the legacy bearer path on the staging relay',
      state: 'agreed',
      created_at: NOW - 3 * 86400,
      deadline_at: NOW - 2 * 86400,
      resolved_at: NOW - 2 * 86400 - 3600,
    }),
    parties: 4,
    signed: 4,
  },
  {
    parley: mkParley({
      id: 'p_3d04',
      subject: 'Move the nightly dispatch window to 02:00 UTC',
      state: 'lapsed',
      created_at: NOW - 6 * 86400,
      deadline_at: NOW - 5 * 86400,
      resolved_at: NOW - 5 * 86400,
    }),
    parties: 3,
    signed: 2,
  },
];

writeFileSync(
  `${OUT}parley-list.html`,
  renderParleyListPage(alice, {
    harbor: dock,
    harbors: [dock, yard],
    items,
    truncated: false,
    notice: null,
    nowSec: NOW,
  }),
);

// ── detail page ──────────────────────────────────────────────────────────────

const parley = mkParley({
  id: 'p_0a91',
  subject: 'Who lands the auth refactor first — PR #4812 or PR #4830',
  deadline_at: NOW + 11 * 3600 + 24 * 60,
});

const pos = (o: Partial<ParleyPositionRow> & { party_id: string; party_label: string }): ParleyPositionRow => ({
  parley_id: 'p_0a91',
  party_kind: 'user',
  tier: 'human',
  is_party: 1,
  stance: null,
  position: null,
  signed_at: null,
  ...o,
}) as ParleyPositionRow;

const positions: ParleyPositionRow[] = [
  pos({
    party_id: 'u_bob',
    party_label: 'bob',
    stance: 'accept',
    position:
      'Agreed — #4830 lands first. I will rebase #4812 on top of it once the migration is applied to staging, and I will not force-push over anyone else’s review commits while doing it.',
    signed_at: NOW - 5 * 3600,
  }),
  pos({ party_id: 'u_alice', party_label: 'alice' }),
  pos({
    party_id: 'cf19a2b7e4d68a01cf19a2b7e4d68a01cf19a2b7e4d68a01cf19a2b7e4d68a01',
    party_label: 'cf19a2b7e4d68a01cf19a2b7e4d68a01cf19a2b7e4d68a01cf19a2b7e4d68a01',
    party_kind: 'daemon',
    tier: 'oidc',
    stance: 'accept',
    position: 'Standing instruction satisfied: no open claim on apps/relay/src/auth-github.ts before 2026-08-06.',
    signed_at: NOW - 4 * 3600 - 900,
  }),
  pos({
    party_id: 'pd-mediator',
    party_label: 'pd-mediator',
    party_kind: 'mediator',
    tier: 'mediator',
    is_party: 0,
    position:
      'Bob and the daemon party have both signed accept, agreeing that #4830 lands first; alice has not yet signed. The only stated condition on the record is bob’s requirement that the migration reach staging before #4812 is rebased.',
  }),
];

writeFileSync(
  `${OUT}parley-detail.html`,
  renderParleyDetailPage(alice, {
    harbor: dock,
    parley,
    positions,
    viewerSeat: positions.find((p) => p.party_id === 'u_alice') ?? null,
    notice: null,
    nowSec: NOW,
    gate: null,
    summonses: [],
    fleetPaused: false,
    mediatorKilled: false,
  }),
);

// ── mediator-body gate states (grand-plan node mediator-body) ────────────────
//
// A mediator-CONVENED conflict parley: two ranked claimants, a summons ledger
// (one acked by a daemon, one escalated to its human), and the human approve
// gate rendered in its load-bearing states — pending (live buttons), paused
// (the SAME buttons grayed out), and decided-Modify (the write-once record
// with the re-injection text).

const DAEMON_FP = 'cf19a2b7e4d68a01cf19a2b7e4d68a01cf19a2b7e4d68a01cf19a2b7e4d68a01';

const gateParley = mkParley({
  id: 'p_gate',
  subject: '[pd-mediator] Predicted conflict: PR #4812 ↔ PR #4830 — 2 overlapping symbols before merge',
  convened_by: 'mediator',
  deadline_at: NOW + 19 * 3600,
});

const gpos = (o: Partial<ParleyPositionRow> & { party_id: string; party_label: string }): ParleyPositionRow => ({
  parley_id: 'p_gate',
  party_kind: 'user',
  tier: 'human',
  is_party: 1,
  stance: null,
  position: null,
  signed_at: null,
  claim_rank: null,
  ...o,
}) as ParleyPositionRow;

const gatePositions: ParleyPositionRow[] = [
  gpos({ party_id: 'u_alice', party_label: 'alice', claim_rank: 1 }),
  gpos({ party_id: 'u_bob', party_label: 'bob', claim_rank: 2 }),
  gpos({
    party_id: 'pd-mediator',
    party_label: 'pd-mediator',
    party_kind: 'mediator',
    tier: 'mediator',
    is_party: 0,
    position:
      'Predicted symbol collision in octo/repo between PR #4812 (alice) and PR #4830 (bob) at confidence 0.80: src/auth.ts:resolveSession, src/auth.ts:rotateToken. Convened automatically; first claimant is PR #4812.',
  }),
];

const mkSummons = (o: Partial<ParleySummonsRow> & { id: string; party_id: string; party_label: string }): ParleySummonsRow => ({
  parley_id: 'p_gate',
  party_kind: 'user',
  daemon_fingerprint: null,
  summons_channel: 'fp:fleet-cloud:mediator:octo-repo:4812-4830',
  summons_seq: 1,
  summons_hash: '7d1f0c4be92a6358f04e1ab2c97d5e6601aa42bb83cc19dd7e5f2a1b0c9d8e7f',
  issued_at: NOW - 3 * 3600,
  state: 'summoned',
  response_channel: null,
  response_seq: null,
  response_hash: null,
  responded_at: null,
  escalated_at: null,
  ...o,
}) as ParleySummonsRow;

const gateSummonses: ParleySummonsRow[] = [
  mkSummons({
    id: 'sm_a',
    party_id: 'u_alice',
    party_label: 'alice',
    daemon_fingerprint: DAEMON_FP,
    state: 'acked',
    response_channel: 'fp:fleet-cloud:daemon-acks',
    response_seq: 12,
    response_hash: '31e8c5a90d7f2b64ee1a09c8b7d6f5a4432211ffeeddccbbaa99887766554433',
    responded_at: NOW - 3 * 3600 + 240,
  }),
  mkSummons({
    id: 'sm_b',
    party_id: 'u_bob',
    party_label: 'bob',
    state: 'escalated',
    escalated_at: NOW - 3 * 3600,
  }),
];

const mkGate = (o: Partial<ParleyGateRow> = {}): ParleyGateRow => ({
  parley_id: 'p_gate',
  action: 'merge',
  state: 'pending',
  verdict_by: null,
  verdict_by_label: null,
  verdict_at: null,
  modify_text: null,
  created_at: NOW - 3 * 3600,
  ...o,
}) as ParleyGateRow;

const gateView = (over: Record<string, unknown>) =>
  renderParleyDetailPage(alice, {
    harbor: dock,
    parley: gateParley,
    positions: gatePositions,
    viewerSeat: gatePositions[0] ?? null,
    notice: null,
    nowSec: NOW,
    gate: mkGate(),
    summonses: gateSummonses,
    fleetPaused: false,
    mediatorKilled: false,
    ...over,
  });

writeFileSync(`${OUT}parley-gate-pending.html`, gateView({}));
writeFileSync(`${OUT}parley-gate-paused.html`, gateView({ fleetPaused: true }));
writeFileSync(
  `${OUT}parley-gate-modified.html`,
  gateView({
    gate: mkGate({
      state: 'modified',
      verdict_by: 'u_alice',
      verdict_by_label: 'alice',
      verdict_at: NOW - 40 * 60,
      modify_text:
        'PR #4830 rebases onto #4812 after the session-rotation migration lands on staging. Keep bob’s rate-limit change but drop the duplicate resolveSession refactor — #4812 already covers it.',
    }),
  }),
);

// Deadline lapsed under a 'first-proceeds' Helm: the recorded default outcome.
writeFileSync(
  `${OUT}parley-expiry-outcome.html`,
  renderParleyDetailPage(alice, {
    harbor: dock,
    parley: mkParley({
      id: 'p_gate',
      subject: '[pd-mediator] Predicted conflict: PR #4812 ↔ PR #4830 — 2 overlapping symbols before merge',
      convened_by: 'mediator',
      state: 'lapsed',
      deadline_at: NOW - 3600,
      resolved_at: NOW - 3600,
      outcome_json: JSON.stringify({
        default: 'first-claimant-proceeds',
        source: 'helm-default',
        proceeds: { party: 'alice', pr: 4812 },
        rebases: { party: 'bob', pr: 4830 },
        repo: 'octo/repo',
        appliedAt: NOW - 3600,
      }),
    }),
    positions: gatePositions,
    viewerSeat: gatePositions[0] ?? null,
    notice: null,
    nowSec: NOW,
    gate: null,
    summonses: gateSummonses,
    fleetPaused: false,
    mediatorKilled: false,
  }),
);

console.log(
  `wrote ${OUT}parley-list.html, parley-detail.html, parley-gate-pending.html, ` +
    `parley-gate-paused.html, parley-gate-modified.html, parley-expiry-outcome.html`,
);
