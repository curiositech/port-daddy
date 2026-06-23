# 0088. The Host-Safety Layer — `pd safe`, the AI little sniffer

## Status

Proposed — 2026-06-23

Numbering note: 0087 is the highest *new-series* ADR on disk; 0088 is the next free
number. (The duplicate-number hygiene problem recorded in
[ADR-0087](0087-trusted-computing-base-broker.md) is still open and is not fixed here.)

Reconciles and extends (does not supersede):
[ADR-0050](0050-coast-guard.md) (the rent compulsion + the same-UID honesty rule),
[ADR-0053](0053-out-of-band-enforcement.md) (the 3-layer out-of-band spine),
[ADR-0087](0087-trusted-computing-base-broker.md) (the separate-UID broker = the TCB).

## Context

The operator stated the threat plainly: the machine is *"a fertilized, tilled flower
bed with no protection."* API keys sit in plaintext in **dotenv files** (a
`.env`/`.env.local` file of `KEY=value` lines a process reads with plain POSIX
permissions — no consent prompt), AI agents run **as the operator** with full access,
and any downloaded executable, **MCP server** (a Model Context Protocol tool server an
agent loads and calls — modelcontextprotocol.io), or `npm`/`pip` package can phone home
or read everything. Port Daddy's prior security work all aimed at one verb: *protect
`git push`*. This ADR widens the target to *protect the whole machine from any agent or
executable* — and names the product that does it: **`pd safe`, the AI little sniffer.**

The crown jewels are not behind any wall today. macOS's **TCC** (Transparency, Consent
& Control — the user-data permission gate; support.apple.com) protects `~/Library/Mail`,
`~/Library/Messages`, Safari data, and other apps' containers behind **Full Disk Access**
(`kTCCServiceSystemPolicyAllFiles`). It does **not** protect `~/.env`, `~/.aws`,
`~/.ssh`, `~/.config`, `~/.npmrc`, or `~/.docker/config.json` — a same-UID agent reads
those with zero prompts. That gap *is* the threat model. (Apple Endpoint Security
overview: developer.apple.com/documentation/endpointsecurity.)

### What already exists (compose, do not reinvent)

Port Daddy already ships real security surfaces. This ADR is their **host-wide
superset**, not a parallel stack:

- **Coast Guard** — `lib/coast-guard.ts` ships `scrubRawSecretsFromEnv()` (strip raw keys
  from a child's environment), `defaultCrownJewels()` (the seed deny-list of secret
  paths), `buildSeatbeltProfile()`/`wrapWithSandbox()` (a **Seatbelt** sandbox profile —
  macOS's SBPL policy language run via `sandbox-exec`; the cooperative-child confinement),
  `buildBrokerRules()` (egress header injection), and `coastGuardStatus()`. Its constant
  `HONEST_LIMITS` (`lib/coast-guard.ts`) states the cardinal rule verbatim: *"A secret a
  process can use, it can copy. Real enforcement against this needs a separate UID / VM +
  pf/nftables forced egress."* Every `pd safe` receipt echoes that string.
- **Egress meter** — `lib/coast-guard/egress-meter.ts` is a loopback `CONNECT` proxy
  (pointed at via `HTTPS_PROXY`) that already meters per-host request count + tunnelled
  bytes and hard-refuses over a spend cap (`402 Spend Cap Exceeded`). It is wired into
  `lib/spawner.ts` as the default for spawned agents. It sees the CONNECT destination host
  (the **SNI**-equivalent target — Server Name Indication, the cleartext destination
  hostname in a TLS handshake; RFC 6066) *without* terminating TLS.
- **Credential broker** — `core/pd-broker` (Rust, unix-domain socket, scoped short-lived
  tickets; the raw secret never crosses the socket) is the corral *target* for secrets we
  pull off disk.
- **The macaroon gate / kernel** — `core/kernel/pd-anchor` holds the **macaroon** keys (a
  bearer credential whose authority only narrows — Birgisson et al. 2014) and the
  issue-iff-paid decision.
- **The TCB** — [ADR-0087](0087-trusted-computing-base-broker.md) makes the separate-UID
  Rust broker the single trusted spine; its phases 5/6 (separate UID + `pf` forced egress;
  runbook at `docs/operations/tcb-broker-runbook.md`) are exactly the enforcement
  authority this ADR's read-only sensors *cannot* hold.

The honest move is therefore: **`pd safe` is a detection-and-evidence layer that
composes on top of the existing Coast Guard / broker / TCB, and hands its enforcement
verbs off to authorities the agent's own UID must not hold.**

## The trust boundary, stated first (the cardinal honesty rule)

This is the load-bearing constraint and it gates every claim in this document.

> **Any tool Port Daddy runs as the operator's own UID, a malicious same-UID agent can
> also disable, unset, kill, or read around.** A same-UID agent can `unset HTTPS_PROXY`
> and egress with a raw socket; it can `kill` the watcher; it can read a corralled key
> if its own binary is in the Keychain item's ACL; it can copy a secret the scan never
> enumerated (a browser cookie DB, a tool-specific creds file).

So the entire **read-only tier** of `pd safe` is genuine, valuable **DETECTION and
EVIDENCE** — it catches the *common* painful cases (runaway loops, accidental exfil,
confused-deputy reads, a freshly-downloaded unsigned binary phoning home) and produces a
blast-radius receipt. **It is not containment.** Real **containment** only exists when
the enforcement authority lives **outside the agent's UID**: a SIP-protected **System
Extension** (a notarized out-of-process plugin macOS runs with tamper protection;
developer.apple.com/documentation/systemextensions) holding the **Endpoint Security**
(ESF) or **Network Extension** authority, or a separate UID/VM + `pf` (the ADR-0087
phase-5/6 line). The product surface must say this — green never means "sandboxed," only
"cooperative-case sensors clear." This restates [ADR-0050](0050-coast-guard.md)'s own
disclosed rule; `pd safe` makes refusing to overclaim a feature, not a footnote.

## Decision

**Ship `pd safe` — a host-safety layer for an AI-saturated dev box — as a phased program
whose Phase A (a read-only posture scan + scored report) is shippable now with zero Apple
entitlement, and whose enforcement phases are gated behind explicit, operator-owned verbs
that hand authority to a boundary the agent cannot hold.**

### The five capabilities

`pd safe` is one product with five composable capabilities. Each has an unprivileged
detection floor and a privileged enforcement ceiling; the floor ships first.

| Capability | Read-only floor (ships now) | Privileged ceiling (gated, later) |
|---|---|---|
| **Secret corralling** | structured-format + entropy scan of dotfiles/`.env`; report path/line/rule-id/last-4, never the value; reversible corral into the broker/Keychain | ESF `AUTH_OPEN` deny of any non-broker process reading `~/.aws`/`~/.ssh`/`**/.env` |
| **Process / binary sentinel** | `libproc`/`ps` inventory + `codesign`/`spctl`/`xattr` trust + persistence diff; a cdhash-keyed trust ledger | Santa-fronted `AUTH_EXEC` lockdown (real block-before-exec) |
| **Egress sniffer** | `nettop`/`lsof` per-process flow map joined to the spawn registry; `eslogger` exec↔socket correlation; beaconing score | `NEFilterDataProvider` per-flow drop; `pf` forced egress |
| **Confinement** | Seatbelt profile + scrubbed env + egress-meter cap (cooperative; already shipped) | separate-UID spawn account (ADR-0087 phase 5) |
| **Posture / remediation** | a 0–100 score, a blast-radius list, reversible auto-fixes (`chmod`, corral), a Safe Room light | a macaroon-signed `pd safe attest` receipt that enumerates its own blind spots |

### Secret detection method (hard-constraint compliant — NO keyword NLP)

Detection is **structured key-format anchors + Shannon entropy**, never a keyword
wordlist classifier:

1. **Structured formats** (fixed FORMATS, not free-text keywords — the allowed path): AWS
   `(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}`, GitHub `gh[pousr]_[0-9A-Za-z]{36}`
   and `github_pat_\w{82}`, OpenAI `sk-(?:proj|svcacct|admin)-…T3BlbkFJ…`, Anthropic
   `sk-ant-api03-…AA`, Slack `xox[baprs]-…`, Google `AIza[0-9A-Za-z\-_]{35}`, Stripe
   `(?:sk|rk)_(?:test|live|prod)_[0-9A-Za-z]{10,99}`, PEM `-----BEGIN … PRIVATE KEY-----`.
   We **vendor the gitleaks MIT rule corpus** (`config/gitleaks.toml`) as the format
   library — a maintained dependency, refreshed on a schedule, not a constant.
2. **Shannon entropy** `H = -Σ p(c)·log₂ p(c)` as the *fallback* for unknown high-entropy
   blobs (base64 floor ≈ 4.5 bits/char, hex ≈ 3.0; length ≥ 20), gated on a structured
   anchor or a known cred path so it is never the sole verdict.
3. **A committed baseline** (`.pd-secrets-baseline.json`, the Yelp detect-secrets model)
   so a re-scan surfaces only NEW secrets. Without it the score is noise and trust dies on
   first run.

The gitleaks "keyword" stanza is a candidate-narrowing pre-filter ahead of regex, never
the verdict — reading it as a classifier would violate the no-keyword-NLP rule. We do not.

### Prior-art reuse stance (license-aware)

- **REUSE (link-safe):** gitleaks rule corpus (MIT); the Santa rule model + `santactl
  fileinfo --json` trust extractor (Apache-2.0, `northpolesec/santa` — Google's
  `google/santa` is archived as of Feb 2025); osquery tables (Apache-2.0) if a SQL sensor
  substrate is wanted; `eslogger(1)` (ships in macOS 13+, *pre-entitled*).
- **STUDY-then-reimplement (copyleft — do NOT statically link):** LuLu's
  `NEFilterDataProvider` egress-firewall architecture (GPL-3.0); BlockBlock/KnockKnock's
  persistence-location taxonomy (GPL-family); trufflehog's *live-verification idea*
  (AGPL-3.0).
- **Existence proofs:** `redcanaryco/mac-monitor` (BSD-3) and Patrick Wardle's tools prove
  an indie can ship a notarized ESF/NE system extension — the privileged ceiling is
  reachable, not theoretical.

## The phased roadmap

Phase A is the product; the later phases are real teeth on authorities the agent cannot
hold. Nothing privileged is ever auto-applied.

### Phase A — read-only posture scan + report (SHIPS NOW, zero entitlement)

`pd safe scan`: a one-shot, 100% read-only audit emitting a 0–100 score + a concrete
blast-radius list (*"here is exactly what an agent running as you could read right now"*).
Checks: (1) plaintext secrets at rest (gitleaks corpus + entropy over the full
hiding-spot list, seeded from `defaultCrownJewels()`); (2) crown-jewel file permissions +
whether Coast Guard's deny-list is in force (`coastGuardStatus()`); (3) a
process/binary trust inventory (`codesign`/`spctl`/`xattr` quarantine); (4) a per-process
egress snapshot (`nettop`/`lsof`); (5) an MCP/skill config inventory flagging unpinned
`npx`/`uvx` fetches. Ships with `.pd-secrets-baseline.json` from day one, the
cdhash-keyed trust ledger, and the Safe Room posture light (green/amber/red) in FleetBar +
pd-console. Every receipt footer echoes `HONEST_LIMITS`. **The full Phase A component +
file + test list is the build spec at
[ADR-0088 build spec](0088-build-stage-spec.md).**

### Phase B — secret corralling to broker / Keychain (read-only detect + operator-gated write)

`pd safe corral <key>`: `saveManagedSecret()` (`lib/secret-env.ts`) the raw value into the
broker store / login Keychain, rewrite the source line to `pd-secret://KEY`, keep a `.bak`
under `~/.port-daddy/recovered` (never `/tmp`), and verify a resolver
(`withSecretsInChildEnv()`) is in the exec path and round-trips *before* rewriting.
Dry-run by default, idempotent, reversible. Plus a `--staged`/pre-push secret guard hooked
into the existing ADR-0053 guard surface — the highest-value, lowest-cost win, because it
stops NEW leaks at the boundary. **Honest limit:** a same-UID agent can still read the
Keychain item if its binary satisfies the ACL — corralling reduces blast radius and stops
disk-resident leaks; it is not confidentiality against a malicious agent (that needs the
separate-UID broker, ADR-0087 phase 5).

### Phase C — process / binary sentinel via `eslogger` (read-only real-time)

`pd safe watch`: wrap `eslogger exec fork uipc_connect` (ships in macOS 13+ already
entitled; cost is `sudo` + the host terminal holding Full Disk Access — a TCC grant the
operator gives once, **no Apple entitlement**) as a streaming source, join exec events to
the trust ledger and to socket-connect events, attribute via `responsible_audit_token`
(NOT ppid — on macOS the parent is almost always `launchd`). Fires on (a) an
unsigned/ad-hoc/quarantined binary exec, (b) an interpreter (`python`/`node`/`bash`)
opening an outbound socket = a phone-home signal, (c) a read-dotenv-then-egress
correlation. **Honest limit:** read-only ESF cannot block; by the time the exec is
reported the process is already running, so this is *observe + alert + best-effort
`kill`*, a tripwire, **never** prevention. `eslogger` output is explicitly "NOT API" — its
schema can change between macOS releases, so the parser must be defensive and
version-pinned.

### Phase D — egress observability (read-only)

`pd safe` promotes the existing egress-meter to a first-class sniffer (it already sees
CONNECT destinations + per-host bytes per spawned agent) plus a host-wide `nettop` view
joined to the spawn registry, a per-agent allowlist drift flag, and a **RITA-style**
beaconing scorer (explainable statistics — coefficient-of-variation of inter-request
intervals, time-gap entropy, byte-ratio spikes; no ML, no keywords). **Honest limits:**
this is volumetric + destination-based, not content-based (TLS bodies are opaque without
MITM); destination visibility leans on cleartext SNI, which **Encrypted Client Hello**
(ECH, RFC 9849, rolling out ~2026) erases where deployed — fall back to IP + rDNS; legit
AI agents are bursty and many-hosted, so scores must be *ranked and explained*, never
binary alarms.

### Phase E — enforcement via system extension / Network Extension / `pf` (GATED, operator-owned)

The real teeth, each requiring an authority the agent's UID must not hold. None ship
without explicit operator action; none are ever auto-applied.

- `pd safe enforce-egress` — a notarized **`NEFilterDataProvider`** system extension
  (LuLu-class) doing per-flow allow/drop keyed on `sourceAppAuditToken`, driven by the
  per-agent allowlist. The `com.apple.developer.networking.networkextension` entitlement is
  **self-service** (any Developer-ID account enables it; no Apple grant) — the *most
  achievable* real-enforcement track. It survives `unset HTTPS_PROXY` because it filters at
  the flow layer. Closes the ADR-0050 phase-4 / ADR-0087 phase-6 gap on the achievable
  entitlement.
- `pd safe lockdown` — front **`northpolesec/santa`** (Apache-2.0): the operator installs
  Santa; PD authors rules (StaticRules + an embedded Moroz-style local sync server, Santa's
  **Standalone** mode = local approve, no MDM) and presents posture. Real
  `ES_EVENT_TYPE_AUTH_EXEC` block-before-exec of rogue/unsigned binaries **without PD
  holding the Apple-gated ESF entitlement itself.**
- ESF `AUTH_OPEN` file-read wall — a PD-owned notarized ESF system extension that DENIES
  any non-broker process opening `~/.aws`/`~/.ssh`/`**/.env`. This needs the
  **Apple-granted** `com.apple.developer.endpoint-security.client` entitlement (a managed
  capability requiring a justification form; weeks-to-months lead time, can be declined) +
  notarization + user approval. AUTH events are deadline-bounded — a slow handler is killed
  by the kernel and a default-deny client that dies can soft-brick exec, so verdict-cache +
  `es_mute_path` discipline is mandatory. Plan it as a long-horizon, approval-contingent
  track, **never** a near-term deliverable.
- Separate-UID spawn + `pf` forced egress — = ADR-0087 phases 5/6. Run agents under a
  dedicated low-priv account (POSIX perms actually deny the crown jewels) with root-owned
  `launchd` `pf` `rdr` anchors the agent UID cannot flush, forcing egress through the
  separate-UID broker. This converts every cooperative sniffer above into actual
  containment — the line between sniffer (safe, today) and wall (privileged, authority the
  agent cannot hold).

### Read-only vs privileged, stated honestly

| Tier | Mechanism | Authority needed | What it is |
|---|---|---|---|
| READ-ONLY / safe today | `codesign`/`spctl`/`xattr`, `libproc`/`ps`/`lsof`/`nettop`, dotfile secret scan, persistence diff, `log stream` | none (most), or `sudo` + operator-granted Full Disk Access for `eslogger`/ESF-read | DETECTION + EVIDENCE; defeatable by the watched process |
| PRIVILEGED — self-service entitlement | `NEFilterDataProvider` / `NEDNSProxyProvider` egress block | `com.apple.developer.networking.networkextension` (no Apple grant) + notarized sysext + user approval | real per-flow ENFORCEMENT |
| PRIVILEGED — Apple-granted | ESF `AUTH_EXEC`/`AUTH_OPEN` block | `com.apple.developer.endpoint-security.client` (Apple-reviewed, weeks–months) + notarized sysext + user approval | real before-the-fact PREVENTION |
| PRIVILEGED — root | separate-UID account + `pf` anchors | root provisioning the agent UID can't undo | true CONTAINMENT (ADR-0087 5/6) |

## Implementation Matrix (the spine, roadmap-linked)

Cartographer-owned; each phase promotes to a `roadmap_items` row (`adr-0088-<slug>`).
Phase A is the shippable slice; later phases are sequenced so each is independently useful.

| Phase | Slug | Depends on | What ships |
|---|---|---|---|
| A | adr-0088-safe-scan-readonly | — | `pd safe scan` read-only posture audit + 0–100 score + blast-radius report + `.pd-secrets-baseline.json` + trust ledger + Safe Room light. Zero entitlement. (Spec: [0088 build spec](0088-build-stage-spec.md).) |
| B | adr-0088-secret-corral | A | `pd safe corral` reversible corral into broker/Keychain + `--staged`/pre-push guard on the ADR-0053 surface. |
| C | adr-0088-sentinel-watch | A | `pd safe watch` `eslogger` exec↔socket sentinel (observe/alert/best-effort-kill). |
| D | adr-0088-egress-observe | A | egress-meter promotion + `nettop` host view + per-agent allowlist drift + RITA-style beaconing scorer. |
| E1 | adr-0088-enforce-egress-nefilter | D | `pd safe enforce-egress` notarized `NEFilterDataProvider` sysext (self-service NE entitlement). |
| E2 | adr-0088-lockdown-santa | C | `pd safe lockdown` Santa-fronted `AUTH_EXEC` block (no PD-held ESF entitlement). |
| E3 | adr-0088-esf-fileread-wall | B | ESF `AUTH_OPEN` deny of non-broker reads of crown jewels (Apple-granted entitlement; long-horizon). |
| E4 | adr-0088-separate-uid-pf | E1 | separate-UID spawn + `pf` forced egress (= ADR-0087 phases 5/6; operator-owned). |
| F | adr-0088-safe-attest | A | `pd safe attest` macaroon-signed receipt enumerating which sensors ran + its own blind spots. |

## Consequences

- **Positive:** the operator gets a shippable-now, evidence-backed "you are safe (with
  caveats)" surface that widens Coast Guard from *protect `git push`* to *protect the whole
  machine*; the existing broker/macaroon/TCB work becomes the enforcement ceiling the
  read-only floor hands off to, rather than four overlapping efforts; the no-overclaim rule
  becomes a product feature (`pd safe attest` lists its own blind spots).
- **Cost / disclosed tension:** the privileged tiers (Phase E) are a real shipping cost —
  notarized system extensions, a self-service NE entitlement *and* an Apple-granted ESF
  entitlement (weeks–months, can be declined), user approval friction, and the separate-UID
  boundary that breaks "the agent edits your live tree" (the same tension ADR-0050/0087
  disclosed). A security app that is not itself notarized would fail the Gatekeeper it
  audits — credibility own-goal.
- **What this does NOT claim:** the read-only tier is a tripwire, not a wall; green means
  "cooperative-case sensors clear," not "sandboxed"; entropy/secret scanning has false
  positives the baseline must suppress; `eslogger`'s schema is unstable; ECH erases SNI;
  TCC does not guard the dotfiles `pd safe` cares about; and a same-UID agent can disable
  any same-UID sensor. Every receipt says so.
- **Operator-owned:** the Full Disk Access grant, the system-extension approvals, the ESF
  entitlement request, the `pd-broker` UID, and the `pf` anchors are privileged actions the
  operator authorizes; the agent cannot self-provision them — that would defeat the point.

## References

- ADR-0050 — the Coast Guard (rent compulsion; the same-UID honesty rule this echoes).
- ADR-0053 — out-of-band enforcement (the 3-layer spine; the `--staged` guard hooks here).
- ADR-0087 — the TCB broker (separate-UID Rust broker; its phases 5/6 are this ADR's
  enforcement ceiling).
- ADR-0057 — unified distribution (the system-extension bundles are signed limbs of the
  one whole).
- `lib/coast-guard.ts` — `scrubRawSecretsFromEnv`/`defaultCrownJewels`/`coastGuardStatus`/
  `HONEST_LIMITS`; the shipped surface `pd safe scan` composes with.
- `lib/coast-guard/egress-meter.ts` — the loopback CONNECT proxy `pd safe` promotes to a
  first-class egress sniffer.
- `lib/secret-env.ts` — `saveManagedSecret`/`withSecretsInChildEnv`; the corral target.
- `core/pd-broker` — the credential broker secrets are corralled into.
- `core/kernel/pd-anchor` — the macaroon kernel that signs the `pd safe attest` receipt.
- `lib/spawner.ts` — where the egress meter is wired into spawned agents today.
- `docs/operations/tcb-broker-runbook.md` — the separate-UID + `pf` runbook Phase E4 reuses.
- `skills/macos-host-security/SKILL.md` — the durable macOS-primitives research this ADR
  distills. <!-- proposed: lands in this same change -->
- `docs/adr/0088-build-stage-spec.md` — the concrete Phase A build spec. <!-- proposed: lands in this same change -->
- Birgisson et al. 2014, "Macaroons: Cookies with Contextual Caveats" — the macaroon model.
- gitleaks (MIT), `northpolesec/santa` (Apache-2.0), LuLu (GPL-3.0), trufflehog (AGPL-3.0),
  detect-secrets (Apache-2.0) — the prior art, reuse stance above.
- RFC 6066 (TLS SNI), RFC 9849 (Encrypted Client Hello) — the destination-visibility floor
  and its erosion.
