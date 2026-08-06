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
import type { UserRow, ParleyRow, ParleyPositionRow, HarborRow } from '../src/db.js';

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
  }),
);

console.log(`wrote ${OUT}parley-list.html and ${OUT}parley-detail.html`);
