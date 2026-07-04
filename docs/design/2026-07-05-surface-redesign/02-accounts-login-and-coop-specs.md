# portdaddy.dev Accounts, Login, and Remote Harbor Co-op — Design Specs

**Status:** Design target · companion to `00-unified-design-language.md`. Mockups: `mockups/login.html`, `mockups/account.html`, `mockups/coop-harbor.html`.
**Grounds:** binder ch. 05/06, ADR-0029 (OIDC + account key), ADR-0039 (website surfaces, session model, tunnel), ADR-0040 (actor ULIDs, newcomer floor), ADR-0027 (relay mesh).

## Login (`/login`)

Storefront room: cobalt + teal on warm paper, Swiss-modern editorial, cold-confidence voice. The page's job is not conversion — it is **establishing the trust model in one screen**:

1. **Local-first honesty above the fold.** "Port Daddy works without an account" is the first bordered block a visitor reads. An account adds only what a server can add: signed downloads, pairing, receipts, team harbors. This is the anti-SaaS-dark-pattern statement and it is brand-defining (ch. 06: *"Local-only users should be able to use Port Daddy without an account"*).
2. **GitHub OIDC primary** (ADR-0029 W0), magic-link secondary. Session captions state the facts: 1-hour httponly session, re-auth for sensitive writes, no tokens in localStorage.
3. **Pairing as a ritual, not a hidden setting.** The 4-digit code entry lives on the login page itself — four large square mono digit boxes — because pairing a daemon *is* the product's real "sign-in." Caption points at the FleetBar "Pair this device" affordance (the `pd account pair` CLI remains the power-user alternative); ADR-0029's invariant is stated plainly: pairing requires OIDC proof **and** account-key co-signature.
4. **The key truth, unsoftened.** "The website never holds your private keys." / "No custodial recovery — lose your account key and the account is dead by design." Cold confidence: state it as a feature, because it is one.

Anti-requirements: no testimonials, no gradient hero, no "supercharge your workflow," no social proof theater, no ship/anchor imagery.

## Account home (`/account`)

The account is **a keyring, a receipt drawer, and a consent ledger** — not a dashboard. Sections in priority order:

1. **Identity plate** — name, violet identity chip (account key type, keychain location, creation date), OIDC linkage. Violet is the L3 identity hue; this is its canonical use.
2. **Devices** (ADR-0027 roles made visible): each paired device shows its *role in plain words* — "primary control plane," "thin approval surface — approvals + replies only," "compute worker — accepts render+test requests only." Capability summaries in prose, never capability strings (ch. 05 join-flow rule). One-click revoke per device (stolen-device story), pair-new via the 4-digit ritual.
3. **Receipts** (ADR-0039 surface #1 — *"the Strava-map of code work"*): cards with the verifiable `portdaddy.dev/r/<id>` URL, run title, stat strip (agents · commits · cost · duration), scoped-share button. Caption: link-holders see the proof, not the code.
4. **Harbors** — governance tiers as cards (Personal / Team + seats / Guest card with expiry / Federated teaser). The guest card displays its capability summary and expiry — a Harbor Card is a visible object, not a row in a permissions table.
5. **Plan & caps** — plan plate (Local-only $0 → Hybrid relay → Hosted → Team per-seat), usage bars, and the **cost-cap editor** (daily / per-run / monthly). Caption carries the architecture truth: *caps are enforced by your daemon, mirrored here* — the website is never the enforcement point.
6. **Danger strip** — export everything; delete account ("server data purged, local daemon unaffected").

## Remote harbor co-op (`/harbor/<name>` — the vibe-coding-together surface)

The flagship experience. Binder ch. 05 verbatim: *"Cooperative vibe coding is not 'many agents all touching the repo.' It is a governed collaboration pattern where humans and agents have visible intentions, bounded permissions, durable transcripts, and ways to reconcile conflicts."* The page renders those four nouns as its four regions:

1. **Visible intentions → Crew rail.** Humans and agents in one presence list, roles in plain words. Humans: operator ("the conn") and collaborators with their Harbor-Card capability summary inline ("can: edit src/checkout, open PRs · cannot: spend, delete"). Agents: ICS state flags with plain-word current steps. Newcomers fly Quebec + `[NEW]` with their reduced ceiling stated ("until first clean exit") — the pratique flow made visible.
2. **Bounded permissions → Claims map.** The center panel shows claims as first-class objects over the shared surface: symbol claims, region claims, intent types (modify/add/delete). Human and agent claims share one visual system (edge color differs, shape doesn't — co-equal peers). Conflicts render in mayday with Victor and a **Parley** affordance. Caption: *"A clean Git merge is not proof of semantic safety."*
3. **Ways to reconcile → Parley panel.** Structured reconciliation, not chat: topic, positions with evidence links, resolution controls (adopt A / adopt B / freeze contested region). Gates queue sits beneath — merges and spends wait on explicit consent with cost shown.
4. **Durable transcripts → Ledger strip.** The bottom band tails the append-only event ledger with sequence numbers. The checkpoint rule is printed on the surface: *"hot messages move the UI; durable events decide history."*

**Remote-truth discipline** (ADR-0027): a relay chip in the header ("connected · outbound-only · last ack 3s"); any pane rendering another device's state past freshness threshold gets an amber stale chip ("showing cached truth — last sync 47s"). Never pretend live authority while disconnected.

**Invite flow:** QR or magic link that resolves to a plain-language capability card preview *before* joining — the invitee sees exactly what they can and cannot do, phrased in prose.

## Rollout sketch

1. `login.html` → website-v2 route `/login` (W0 auth per ADR-0039: GitHub OIDC + pairing).
2. `/account` overview + devices first (receipts need the receipt pipeline; ship the section with a teaching empty state until then).
3. Co-op harbor ships read-only first (presence + claims + ledger over the relay), then parley controls, then gates — mirroring the relay mesh phasing in ADR-0027.
