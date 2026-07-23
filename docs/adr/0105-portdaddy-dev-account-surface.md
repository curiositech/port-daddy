# ADR-0105: portdaddy.dev — Account Surface, Receipts, Steering, and the Web↔Device Dance

## Status

PROPOSED — 2026-05-22. Companion to [ADR-0029](0029-user-accounts-and-merkle-audit.md) (local primitives) and [ADR-0027](0027-relay-harbor-mesh.md) (relay substrate).

## TL;DR

ADR-0029 said "accounts and Merkle audit." This ADR says "and here is what the website becomes when accounts exist." Five product surfaces unlock, three security disciplines become non-negotiable, and one set of version-skew rules has to govern everything because the system now has at least three independently-versioned actors per user (web, daemon A, daemon B…).

The five surfaces, ranked by how much they alone justify the work:

1. **Receipts as shareable URLs** — `portdaddy.dev/r/<id>` resolves a signed agent-work receipt anyone can verify in-browser. The Strava-map of code work.
2. **The audit page** — `portdaddy.dev/audit` for the owner, `…/audit/share/<token>` for an auditor. A real answer to "what did the AI actually do."
3. **Cross-device fleet steering** — phone or browser opens a live view of every device's fleet under one account; one tap promotes, pauses, drains.
4. **Fleet ship marketplace** — `pd fleet install @erichowens/web-dev` pulls a signed fleet YAML another operator published. Forkable starter packs.
5. **Localhost tunnel for the web view** — `portdaddy.dev/devices/macbook/at/5173/` proxies through the relay into a dev server running on a laptop, gated by the account.

## Context

Today portdaddy.dev is a static React-SPA marketing/docs site. The CLI is local-first. There is no auth, no per-user state, and no place a user is "signed in." That works for the v0 narrative (download a CLI, run it locally) but caps the product at "the bug tracker for your own laptop."

Three things have shifted since the original framing:

- **ADR-0029** specifies an Ed25519 account keypair, pairing receipts, and a Merkle audit forest sealed monthly per `(account × repo × month)`. The cryptographic substrate exists in `lib/merkle-chain.ts`, the delegation walker, and the receipt JSON the daemon already generates.
- **ADR-0027** specifies a relay-harbor mesh — daemons can address each other via an outbound-only relay. The substrate for "my phone sees my laptop" is in place.
- **Real users**. The blog, whitepapers, and CLI now attract people who want more than docs. The next concrete request is some version of "let me share my work" — which is account-shaped.

This ADR closes the gap between "we have the primitives" and "the website is a product surface."

---

## Part I — Why receipts and audits matter, for three audiences

The cryptographic vocabulary scares non-engineers and bores most engineers. The mistake would be to defend the design to people who already get it. Here is the same idea translated three ways, in the order they need to land.

### For my mother

Right now, when an AI assistant helps me write software, there is no real record of what it did. It logs to my laptop. The logs can be edited. If the AI made a mistake — broke something, spent too much money, did something I didn't ask for — I would have a hard time proving what happened. The company that sold me the AI has its own logs, but those are theirs, not mine. So we'd argue.

Port Daddy makes a **logbook the AI cannot edit**. Every time the AI does work, Port Daddy writes a line in the logbook and signs it with my name. The signature is a kind of mathematical seal — anyone who looks at the logbook can tell the line is real, and that I made it, without trusting anyone in the middle.

The **receipt** is one line of that logbook, printed on a page that anyone can read. If I want to show you that the AI cost me 18 cents to do a task, I send you a link. The link opens a page. The page proves the seal is mine. You don't have to take my word for it; the math does the work.

Why this matters: as AI starts doing more, mistakes will happen, money will be spent, work will be argued about. The people with the best records will win those arguments. Port Daddy is the record-keeper.

### For my childhood best friend

Picture your AI coding assistant running unattended overnight on a refactor. You wake up to a $40 cloud bill, a pile of file changes, and a sinking feeling. You want to know: which files did it touch, which model, did it finish, can I trust the diff?

Today the answer lives in scattered JSON files on your laptop. They could have been written by anyone, including a confused or sneaky AI. There's no way to point at any one of them and say "this is canonical."

A Port Daddy receipt is the **credit card statement for AI work**: `$0.18 for an Anthropic API call at 14:32 PDT, model claude-opus-4-7, touched these three files, here is the SHA-256 of the diff.` The receipt is signed by a key that's bound to *you* (not your laptop, not your cloud provider — *you*, via a pairing-receipt ceremony that hands a slice of trust to each device you own).

When the AI screws up — and it will — you have proof of what it did. You can post the receipt URL in a code review. You can use it to argue a billing dispute. You can compare two engineers' receipts to see who's leaning harder on AI assistance. You can send your incident response team a link that has all the forensics inline.

It's the Strava map for code work. Not because anyone needs to see your code, but because **a verifiable record of work done changes how engineers and managers think about that work**. Right now AI work is invisible; receipts make it visible without making it surveilled.

### For my next boss at Anthropic

The receipt is a **transferable, verifiable claim about agent work**. The substrate is RFC 6962-style Merkle trees keyed by `(account_id, repo_root_hash, calendar_month)`, leaves canonicalized via RFC 8785 JCS, signed by the daemon's Ed25519 key, which is bound to the account by a pairing receipt that both sides countersign.

What this unlocks for Anthropic specifically:

**(a) Asymmetric attestation primitive.** Anthropic signs the model output (provider-side attestation). Port Daddy signs the orchestration around it: which file the call wrote to, which task it was part of, which budget it spent. Provider-side + user-side attestation together give you the first reasonable answer to "what did this agent actually do" that doesn't require either party to trust a central log.

**(b) AI-safety telemetry at the user layer.** When a user reports "Claude did X," the receipt is ground truth that lets you correlate provider-side logs with the user's claim, without trusting either side wholesale. This is what *user-attestable AI behavior* looks like in production infrastructure.

**(c) A new substrate for pricing.** Per-task and outcome-conditional pricing become tractable once both sides can verify what was done without revealing source. Right now "did the AI fix the bug?" is unprovable; receipts plus an outcome predicate make it a transactable claim.

**(d) An open primitive other people will build on.** The leaf schema is public, the verification is in-browser pure-JS, the audit roots can be published to a Rekor-style transparency log. Auditors, insurers, compliance vendors, fleet observability tools all sit on top. Port Daddy ships the substrate; the ecosystem ships the integrations.

**(e) The cultural lever.** A receipt URL pinned in a blog post is a social object. Engineers compete on receipt quality — "I refactored this in $0.42, here's the diff hash." That's the moment AI work moves from invisible infra to first-class artifact. Once that shift happens, AI providers benefit from being the engine behind verifiable receipts, not just behind opaque API calls.

The whitepaper sells this; the receipt page is where someone evaluating it for the first time clicks "verify" and watches the signature check pass in their own browser. That's the moment the pitch lands.

---

## Part II — The five surfaces, in dependency order

### Surface 1 — Receipts as URLs (`portdaddy.dev/r/<receiptId>`)

- The daemon already generates signed JSON receipts on `pd done` and sortie completion.
- New: `pd receipt publish <id>` uploads the receipt to portdaddy.dev (POST to a publish endpoint that stores it under the account, indexed by receipt ID).
- New: `portdaddy.dev/r/<receiptId>` renders the receipt with a "Verify this receipt" button that runs Ed25519 verification **in the browser** against the account's published pubkey. Anyone can read; no auth required.
- Public by default. Operator can mark a receipt private (only visible when signed in as the account owner). The cryptographic content is identical; only the website's serving decision differs.
- **The minimum viable account experience.** If we only ever shipped this and nothing else, accounts would be worth building.

### Surface 2 — Audit page (`portdaddy.dev/audit`)

- Renders the per-month Merkle tree as a vertical timeline. Each row is a leaf (a receipt, a session, a file claim). Each section header is a sealed root.
- Two modes: **owner mode** (signed in, sees everything, can drill into receipts) and **share mode** (`portdaddy.dev/audit/share/<token>` — scoped to a time range and optionally a repo, expires by default in 30 days).
- The share link is what you give an auditor, your insurer, your CFO, your team lead. They get a read-only verified view scoped to what you authorized.
- Tamper-evidence is inline: every page shows the sealed Merkle root and a "verify" button. If portdaddy.dev removes a leaf, the displayed root no longer matches what the daemon sealed locally; the daemon's `pd verify` command will catch it.

### Surface 3 — Fleet steering (`portdaddy.dev/fleet` and `portdaddy.dev/devices/<label>`)

Real operator console. Not a dashboard. Pause an agent from a train. Approve a sortie at dinner. Write a session note from a bedside phone. Spawn a fresh sortie with a one-line purpose at a coffee shop.

- One view per device, plus a "union" view across all devices on the account.
- Live streams use the relay (ADR-0027). The web is a *subscriber* to the relay channels the daemon already publishes for sessions, claims, agents, notes, sortie progress.
- Read interactions (what's running, recent activity, current claims, cost burn) are an authenticated SSE subscription.
- **Write interactions are first-class, not afterthought:**
  - **Spawn:** new sortie purpose, target device, confirm. Daemon receives via relay, runs.
  - **Steer:** pause / drain / kill an agent; promote a worktree to stable; reassign a claim.
  - **Note:** type a `pd note` from the phone, attach to the current session.
  - **Approve:** sortie wants to do something requiring HITL — phone gets a notification, operator approves or rejects with a comment.
  - **Budget:** raise a per-day budget mid-burn from the phone.
- **Confirmation model** for write operations defends against compromised web sessions. Sensitive writes (kill agent, drain fleet, rotate keys) show a 4-digit code on the web; the daemon shows the matching code locally; operator confirms. Routine writes (write a note, approve a HITL prompt for an agent the operator just spawned) can use the standard authenticated session.
- **Phone is a peer, not a thin client.** The phone runs a real PWA that can queue write operations when offline, retry over the relay when reconnected, and show local state from the last sync. Operators on trains stay productive.
- Audit trail: every write from the web/phone writes a leaf to the audit tree with `actor: web:portdaddy.dev` or `actor: phone:<device-label>` so the audit page later shows "the phone paused this agent at 14:32 PDT."

### Surface 4 — Fleet ship marketplace (`portdaddy.dev/@<account>/fleets/<name>`)

- A "fleet ship" is a signed `pd-fleet.yml` plus optional skills, prompts, and a README. The whole package is signed by the publishing account.
- `pd fleet publish web-dev` packages the local fleet config + dependencies, signs, and uploads.
- `pd fleet install @erichowens/web-dev` pulls the signed package, displays the diff against your current fleet, prompts to confirm, and applies.
- Forkable. The install command can take `--fork-as my-web-dev` and you own the copy.
- Cryptographic provenance — you know who published it, and the relay can serve a "what fleets has @erichowens published" feed that's verifiable, not arbitrary metadata.
- This is the cultural lever for sharing operational knowledge. Engineers love good defaults; signed forkable defaults are how good defaults spread. Think Brewfile-for-coordination.

### Surface 5 — Localhost tunnel, full interaction (`portdaddy.dev/devices/<label>/at/<port>/`)

This is **not** "view your laptop's dev server from the phone." It is "your phone is now an operator surface that drives the laptop's running app." Two-way. Real input. WebSocket upgrades. POST/PUT/DELETE forwarded. Service workers proxied.

- `pd tunnel expose 5173 --to relay --label dev` on the laptop registers an HTTP tunnel through the relay. The relay opens a connection mux addressable as `tunnel:{daemonFingerprint}:5173`.
- The web view at `portdaddy.dev/devices/macbook-pro/at/5173/` is a **full proxy**, not an iframe — every method is forwarded, every header preserved, WebSocket upgrade negotiated (so HMR works, so live state syncs, so dev-server reload pings work). Touch-target sizing and viewport meta tags get injected for phone-rendering correctness without changing the underlying app.
- Input is native. Touch events become click events on the laptop's served HTML. Hardware keyboard on the phone types into the app. Pinch-zoom is intercepted at the phone OS layer so it doesn't fight CSS scaling.
- File uploads (camera, photo library) are sent back through the tunnel so a "test the image-upload flow on a phone" interaction actually exercises the laptop's code path.
- The account scopes who can address the tunnel; the relay enforces. Tunnel sessions expire by default in 1 hour; longer requires `--no-confirm` and writes a warning leaf to the audit tree.
- User story 1: "I'm on the train, my AI agent has been running for two hours, I want to *interact* with the staging build to see if its diff is right — not just look at a screenshot."
- User story 2: "I want to demo my product to someone at a coffee shop with my phone, not my laptop."
- User story 3: "I want to debug a mobile layout issue by actually using my own phone's hardware while editing on the laptop, with HMR firing on every save."
- Bonus: paired account → `pd-phone://` deep links that open the right device tunnel without typing URLs. Phone-side device list shows every laptop currently advertising a tunnel.

---

## Part III — Security model for portdaddy.dev

This is what I'd be most paranoid about, and the operational disciplines that actually catch attacks.

### Threat model

| ID | Threat | Severity |
|----|--------|----------|
| T1 | Phishing for pairing receipts | High |
| T2 | Stolen OIDC session takeover | High |
| T3 | XSS leaking session / receipts | High |
| T4 | Audit suppression by hostile site operator | High |
| T5 | Receipt enumeration / spidering | Medium |
| T6 | Audit forgery (claim I did X when I didn't) | Medium (ruled out by signing) |
| T7 | DDoS on verify / login | Medium |
| T8 | Account-takeover via OAuth provider compromise | Medium |
| T9 | Insider threat (future hosting provider) | Medium |
| T10 | Replay of expired pairing receipt | Low (ruled out by nonce + expiry) |

### Defenses

**D1. Pairing receipts must be hard to phish.** Five-minute expiry. Nonce bound. The web shows a 4-digit confirmation code AND a human-readable device label. The daemon refuses to sign until the operator types the code back into the terminal. Defense in depth: the daemon also rejects pairing if the requesting origin isn't on a hard-coded allowlist (`https://portdaddy.dev`).

**D2. OIDC sessions.** Short-lived (1h) httponly samesite=strict cookie. No localStorage for tokens. Re-auth required for sensitive operations (revoke device, rotate key, publish fleet). Logout invalidates server-side too.

**D3. Strict CSP.** `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' wss://relay.portdaddy.dev; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; report-to /csp-report`. A reporting endpoint that pages me on a real anomaly.

**D4. Audit suppression detected by signing.** The Merkle roots are published to a transparency log (Surface 2 + Phase W3). Even if portdaddy.dev removes a leaf, the sealed root doesn't change. The daemon's `pd verify` cross-checks the local sealed root against what the web serves and screams on mismatch. Users who care can `pd verify --against transparency-log` for the strongest guarantee.

**D5. Receipts use random 128-bit IDs.** Not because the content is secret, but to prevent enumeration. Verification is computationally cheap (one Ed25519) so an attacker who guesses IDs gets nothing — they still need the matching signature, which they cannot forge.

**D6. WAF + per-IP rate limits.** Cloudflare in front. Login: 5/min. Pairing receipts: 5/hour per account. Verify endpoint: 30/min per IP. Burst gracefully — return a Retry-After header.

**D7. The website holds no private keys, ever.** Pairing receipt design enforces this. The web stores: account pubkey, device fingerprints, receipt JSON (signed payload + public sig), audit roots. It can't sign anything as the account. Worst case the database is wiped, devices re-publish their receipts and the index rebuilds.

**D8. OAuth provider compromise.** Mitigated by a second-factor opt-in for sensitive operations (TOTP, WebAuthn, or "confirm on the daemon"). Default is no 2FA but the prompt nudges toward it.

### Detection

This is where the budget actually goes. Defenses prevent; detection catches what slipped through.

- **Anomaly alerts on login**: new device + new IP geo + first login of the day → out-of-band confirmation prompt at the user's primary device (the daemon shows a notification).
- **Failed-pairing lockout**: 5 failed pairing-code entries → 1-hour cooldown on the account + email to the registered address.
- **CSP violation feed**: piped into a daily report. Real attacks almost always trip CSP first because they need to inject script.
- **Server-side error firehose**: Sentry-equivalent on the website. Any uncaught error pages someone.
- **Daily "weird stuff" report**: a job that runs nightly, scans the day's auth events, lists outliers (unusual user-agent strings, suspicious IP ranges, more-than-N failed verifications from one IP). Delivered via `pd note --type security` and the website's `/account/security` page.
- **Honeypot endpoints**: a few intentionally-tempting paths (`/admin`, `/internal/debug`) that trip an alert when hit.

### Recovery

- **Stolen device:** revoke from the website (one click). The web publishes a revocation receipt signed by the account. Other devices honoring it stop trusting the stolen device. The revoked device cannot sign new leaves; existing leaves remain verifiable but are noted as "from a since-revoked device" in the audit page.
- **Account compromise (private key stolen):** rotate. Generate a new account key, publish a key-rotation receipt signed by the OLD key (proves the rotation is authorized). Devices re-pair against the new key. Old receipts remain verifiable against the published-old pubkey.
- **Account key lost (no backup):** the account is dead. Old receipts under the old key remain verifiable forever. A new account is created and the user's history fork-points there. This is harsh but honest — the alternative (custodial recovery) defeats the cryptographic guarantees.
- **Website wiped:** devices re-publish. The receipts are content-addressed and signed; the website is a cache. Time to rebuild = how long the slowest device takes to push its receipts.
- **Relay compromised:** the relay never sees plaintext or signing material. Worst case it learns metadata (who talks to whom, when). Compromise → rotate relay keys, daemons reconnect.

---

## Part IV — The version-skew dance

Three actors with independent versioning means three pairwise compatibility surfaces. The rules below are not aspirational; they are constraints the design must hold so that an operator with three devices on three different versions doesn't have to think about it.

### Actors

- **S** — `portdaddy.dev` server, version `V_s`
- **D_n** — daemon on device `n`, version `V_{d,n}`
- **R** — relay, version `V_r` (mostly opaque)

### Cases that must not break user experience

| Case | Scenario | Strategy |
|------|----------|----------|
| C1 | S upgrades, D hasn't | Forward-compatible schema; S can read leaves emitted by older D. New fields default-null. |
| C2 | D upgrades, S hasn't | S stores unknown fields as opaque blobs and renders gracefully. Never strip unknown fields. |
| C3 | D_A and D_B on different versions, same account | Leaf schema is versioned (`leaf_version: N`); verifiers handle all known versions. The tree doesn't care — it hashes bytes. |
| C4 | S restarts mid-session | Reconnect on the daemon side, replay missing events from the local outbox. |
| C5 | S changes pairing-receipt schema | Old pairings stay valid (they were signed at issue time). Only new pairings use the new schema. |
| C6 | Daemon offline for a month | On reconnect, daemon publishes accumulated receipts; idempotent by content hash. |
| C7 | S OIDC integration breaks | Re-auth prompt, not error. Devices keep working — they don't depend on the web for the day-to-day. |
| C8 | Daemon breaking change | Old daemon support window: 12 months from release. Compat layer in S that translates v_{n-1} requests for one cycle. |

### Core rules (in priority order)

**R1. Receipts are self-contained.** A receipt JSON includes `account_pubkey`, `daemon_fingerprint`, `leaf_version`, `signature`, and the payload. A receipt on a USB stick verifies against the JSON alone. The server is a publisher, not a gatekeeper.

**R2. The web is stateless w.r.t. account secrets.** Worst case the server's DB is wiped, devices re-publish.

**R3. Schema versioning is mandatory.** Every protocol object has `version: N`. Servers emit the highest version both sides know; daemons accept all versions up to their own. ADR-required.

**R4. Pairing receipts are immutable.** Once signed, they're a record. Never re-signed; only revoked.

**R5. Revocation is published, not enforced.** The account publishes a revocation; honoring it is correct device behavior. A hostile device can't forge new receipts (no private key); the worst it can do is replay old ones, which fail uniqueness checks.

**R6. The server's view is a cache.** Daemons work without the server. The web is a faster lookup layer + a publishing host. If portdaddy.dev is down, `pd` keeps working locally and accumulates receipts in an outbox.

**R7. Upgrades are advertised, not pushed.** A manifest at `portdaddy.dev/.well-known/portdaddy.json` declares current server version, minimum supported daemon version, latest released daemon version. Daemons poll occasionally and surface "upgrade available" without auto-upgrading. Forward-compat keeps old daemons safe.

**R8. Migrations are additive.** Database schema changes never break old daemon submissions. New columns get defaults. Renames are done as add-new + dual-write + drop-old over at least two releases.

### Operational practices

- **Blue-green deploys** for portdaddy.dev (Cloudflare Pages already supports this).
- **Canary daemons:** the daemon's update channel can opt into beta; the beta channel exercises new server features first.
- **Compatibility CI:** the release workflow runs a matrix that spawns "v_{n-2}, v_{n-1}, v_n" daemons against the current server and asserts all three submit receipts that verify.
- **A killswitch on the server:** if a daemon version is found to corrupt the audit tree, the server can refuse submissions from that version. The killswitch is itself signed and published; daemons honor it. This is the "we found a bug, please upgrade" lever.
- **No silent kicks.** The server never closes a session without explanation; the daemon shows the reason to the operator.

---

## Part V — Phasing

### Phase W0 — Authentication (week 1–2)
- GitHub OIDC sign-in on portdaddy.dev
- `/account` page: profile, devices, settings stubs
- Pairing receipt flow: web shows 4-digit code + label, daemon countersigns
- Device list + revoke
- CSP, rate limits, basic Sentry-equivalent

### Phase W1 — Receipts as URLs (week 3–5)
- `pd receipt publish <id>` uploads to portdaddy.dev
- `portdaddy.dev/r/<receiptId>` renders + verifies in-browser
- Anonymous read access; account holder can mark private
- Audit-tree publishing primitive (the leaves all go in but only the receipt page is built yet)

### Phase W2 — Audit page (week 6–9)
- `portdaddy.dev/audit` (owner) + `/audit/share/<token>` (scoped)
- Per-month timeline rendering
- Share-link issuance with expiry
- Transparency-log opt-in (publish roots only)

### Phase W3 — Fleet steering (week 10–13)
- Relay subscription from the browser (SSE over the relay)
- Per-device live view (current sessions, claims, agents)
- Write-confirmation via daemon-side 4-digit code
- Mobile-friendly layout

### Phase W4 — Fleet ship marketplace (week 14–17)
- `pd fleet publish` packages + signs + uploads
- `portdaddy.dev/@<account>/fleets/<name>` resolves the signed package
- `pd fleet install @<account>/<name>` with fork-as flag
- Discovery feed (`/fleets/popular`, `/fleets/recent`) gated on account

### Phase W5 — Localhost tunnel (week 18–20)
- `pd tunnel expose <port> --to relay --label <name>`
- `portdaddy.dev/devices/<label>/at/<port>/` proxies via relay
- Phone deep links

Each phase ships on its own. After W1 you have something genuinely new — a verifiable receipt URL anyone can read. After W2 the AI-safety narrative becomes concrete. W3–W5 expand surface but build on the same auth + relay substrate.

---

## Consequences

### Positive
- The whitepaper's "verifiable agent work" claim becomes a clickable URL.
- The account substrate unlocks five product surfaces, each individually shippable.
- Receipts become a social object; that's the cultural lever the rest of the product runs on.
- The fleet marketplace turns Port Daddy into ecosystem infrastructure, not just a CLI.

### Negative
- Port Daddy is now a SaaS surface, not only a CLI. Account-takeover, abuse, support, uptime become real.
- "Local-first" pitch needs an honest revision: CLI is local-first, web surface is hosted.
- New code paths in the daemon for publish, pair, tunnel — each is its own security surface.
- Privacy default is "receipts public" which is opinionated and will surprise people.

### Neutral
- The relay (ADR-0027) becomes load-bearing for fleet steering + tunnel. Investing in relay resilience is now a product requirement.
- The transparency-log path (ADR-0029 v2) becomes the "trust no one, not even me" backstop. Real cost, real value.

---

## Open questions

1. **Custodial publish key vs non-custodial.** Phase W1 needs to publish receipts. Should the website hold a "publish key" different from the device signing key? Probably yes — a publish key is a delegated capability the device issues to the web; can be revoked without affecting signing material.
2. **Headless devices** (CI runners, servers) — how do they pair? Long-lived service-account tokens with quotas, in their own threat model.
3. **GitHub OIDC outage.** Add Google + email-magic-link as v0.5 fallbacks.
4. **Privacy default for receipts.** My current take: receipts public by default with body-redaction options, audit trees private by default, fleet ships public by default. Each is configurable per account but the defaults shape behavior. Worth a separate decision doc.
5. **Marketplace abuse.** Spam fleets, malicious YAML, prompt-injection-as-a-skill. Signed publisher gives attribution but not moderation. Initial answer: account reputation + a "verified publisher" tier + community reports. Long-term needs an actual policy.
6. **Mobile app vs PWA.** Mobile-first surfaces (steering, tunnel viewing) could be a PWA initially; an iOS app comes later if the PWA is friction. Out of scope here.
7. **Tunnel security.** A tunnel to localhost on a laptop is a serious capability. Default to short-lived (1h) tunnels with the operator approving each one on the daemon. Long-lived tunnels require explicit `--no-confirm` and write a warning entry to the audit tree.
8. **Cost.** Hosting, OIDC, relay, transparency log — all have ongoing cost. Phase W4 (fleet marketplace) is where a paid tier becomes natural. Phase W1–W3 should be free; the substrate IS the product.

---

## See also

- [ADR-0027](0027-relay-harbor-mesh.md) — the relay substrate this depends on
- [ADR-0029](0029-user-accounts-and-merkle-audit.md) — the local account + audit-tree primitives
- [ADR-0030](0030-talent-phonebook-coordination-router.md) — the phonebook becomes a public-by-default profile here
- [ADR-0033](0033-roadmap-pop-atomic-claim.md) — claim mechanics that pair receipts borrow from
- [ADR-0034](0034-roadmap-claim-session-link.md) — session ↔ claim ↔ account chain
