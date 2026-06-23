---
license: MIT
name: macos-host-security
description: |
  Durable research for building a macOS host-safety layer that protects a dev box from
  any AI agent or downloaded executable running on it — the primitives, prior art, the
  read-only-vs-privileged trust map, and the no-keyword-NLP secret-detection method behind
  Port Daddy's `pd safe` ("the AI little sniffer", ADR-0088). Covers Endpoint Security
  Framework (ESF) + eslogger, Network Extension (NEFilterDataProvider/DNS/transparent
  proxy), pf forced egress, code-trust CLIs (codesign/spctl/xattr), libproc/nettop/lsof
  read-only inventory, TCC + Full Disk Access, structured-format + Shannon-entropy secret
  scanning, and Santa-fronted binary lockdown. Activate on: "macOS host security", "endpoint
  security framework", "eslogger", "ESF AUTH_EXEC", "NEFilterDataProvider", "network
  extension", "system extension entitlement", "pf forced egress", "codesign trust",
  "quarantine xattr", "Full Disk Access", "TCC", "secret scanner", "gitleaks rules",
  "Shannon entropy detection", "Santa binary lockdown", "pd safe", "AI sniffer", "confine
  agent on macOS", "block rogue executable". NOT for: the TypeScript daemon's coordination
  logic, generic Rust/borrow-checker help (use rust-with-claude-code), web/UI security
  (use agentic-zero-trust-security for crypto/ocap), or prompt-injection defense.
allowed-tools: Read,Write,Edit,Bash,Glob,Grep,WebSearch,WebFetch
metadata:
  category: Security & Trust
  tags:
    - macos-security
    - endpoint-security
    - eslogger
    - network-extension
    - system-extension
    - pf-firewall
    - codesign
    - tcc
    - secret-detection
    - shannon-entropy
    - santa
    - host-safety
    - pd-safe
  pairs-with:
    - skill: agentic-zero-trust-security
      reason: The cryptographic/ocap layer; this skill is the OS-primitive layer beneath it.
    - skill: daemon-development
      reason: pd safe's read-only sensors run in the Port Daddy daemon.
---

# macOS Host Security — the `pd safe` research base

Durable record of the macOS host-safety research so future sessions don't re-research it.
This is the OS-primitive foundation under **`pd safe`** (the AI little sniffer,
[ADR-0088](../../docs/adr/0088-host-safety-layer.md)). The product widens the **Coast
Guard** (`lib/coast-guard.ts`, ADR-0050) from *protect `git push`* to *protect the whole
machine from any agent/executable*.

## The cardinal rule (read this first, every time)

> **Any tool you run as the operator's own UID, a same-UID agent can disable, unset,
> kill, or read around.** Read-only sensors are genuine DETECTION and EVIDENCE — they
> catch runaway loops, accidental exfil, confused-deputy reads, a freshly-downloaded
> unsigned binary phoning home. **They are NOT containment.** Real containment needs an
> authority outside the agent's UID: a SIP-protected system extension (ESF or NE) or a
> separate UID/VM + `pf`. Never market a same-UID watcher as a wall. `lib/coast-guard.ts`
> `HONEST_LIMITS` states this verbatim; echo it.

TCC trap: `~/.env`/`~/.aws`/`~/.ssh`/`~/.config`/`~/.npmrc` are plain POSIX-readable by
the same UID — **TCC does not guard them.** Full Disk Access guards `~/Library/Mail|
Messages|Safari` and other apps' containers, not the dotfiles that hold the crown jewels.

## Read-only vs privileged map

| Tier | Mechanism | Authority | What you get |
|---|---|---|---|
| READ-ONLY (today) | `codesign`/`spctl`/`xattr`/`csrutil`, `libproc`/`ps`/`lsof`/`nettop`/`vm_stat`, dotfile secret scan, persistence diff, `log stream` | none | DETECTION + EVIDENCE; defeatable by the watched process |
| READ-ONLY but elevated | `eslogger`/any ESF NOTIFY read | `sudo` + operator-granted Full Disk Access (NO Apple entitlement) | real-time exec/open/socket telemetry, observe-only |
| PRIVILEGED — self-service | `NEFilterDataProvider`/`NEDNSProxyProvider`/`NETransparentProxyProvider` | `com.apple.developer.networking.networkextension` (no Apple grant) + notarized sysext + user approval | per-flow ENFORCEMENT |
| PRIVILEGED — Apple-granted | ESF `AUTH_EXEC`/`AUTH_OPEN` block | `com.apple.developer.endpoint-security.client` (Apple-reviewed, weeks–months, can be declined) + notarized sysext + user approval | real PREVENTION before exec/open |
| PRIVILEGED — root | separate-UID account + `pf` anchors | root the agent UID can't undo | true CONTAINMENT |

## Primitives by capability

### Process / binary inventory + trust (read-only, no entitlement)

- **Enumerate:** `libproc` (`proc_listallpids` → `proc_pidpath` → `proc_pidinfo` for
  ppid/uid/start). Shell: `ps -axo pid,ppid,uid,lstart,comm,args`. Rust: `libproc-rs`.
- **Trust per binary:** `codesign --verify --deep --strict` + `codesign -dv --verbose=4`
  (Authority chain, `TeamIdentifier`, `CDHash`, ad-hoc flag) + `codesign
  --check-notarization`. Use SecCode / `codesign` for **bare CLI binaries**; reserve `spctl
  -a -t exec` for **`.app` bundles only** (it misreports standalone CLI executables — the
  common agent/MCP shim shape). `csrutil status` for SIP, `spctl --status` for Gatekeeper.
- **Provenance:** `xattr -p com.apple.quarantine`. **Missing quarantine = UNKNOWN, never
  SAFE** — curl|bash, scp, git-clone, npm/pip leave no quarantine xattr; that is the
  dangerous path. Lean on signing + notarization, not provenance.
- **Classify:** `platform | dev-id-notarized | dev-id-unnotarized | ad-hoc | unsigned`.
- **Attribution:** use ESF `responsible_audit_token`, NOT ppid — on macOS the parent is
  almost always `launchd`/`runningboardd`/`xpcproxy`. A ps-only sniffer mis-blames launchd
  for everything.

### Persistence detection (read-only inventory; real-time = ESF)

Scan the KnockKnock location set, diff against a baseline, alert on NEW items:
`~/Library/LaunchAgents`, `/Library/LaunchAgents`, `/Library/LaunchDaemons` plists,
login items (`SMAppService` / BackgroundItems `.btm`), cron (`crontab -l`, `/etc/periodic`),
shell rc files, `launchctl print`.

### Egress observability (read-only)

- `nettop -P -m route -l 1` — per-PID host + byte counters, **no sudo**. Sampled, not
  per-flow-complete (short flows between samples are missed).
- `lsof -i -nP` — own-UID sockets (root for cross-process).
- **Destination without MITM:** TLS **SNI** is cleartext after the handshake (RFC 6066) —
  read the hostname without terminating TLS. **Encrypted Client Hello** (ECH, RFC 9849,
  rolling out ~2026) erases SNI where deployed — fall back to IP + rDNS.
- `log stream --predicate 'subsystem == "com.apple.network" AND category == "connection"'`.
- **Beaconing (RITA-style, explainable, NO ML/keywords):** low coefficient-of-variation on
  inter-request intervals + low time-gap entropy + byte-ratio spikes. Rank + explain; never
  binary alarms (legit AI agents are bursty and many-hosted).

### Real-time telemetry via eslogger (read-only, elevated)

`eslogger exec fork open uipc_connect` ships in macOS 13+ **already entitled** — ESF NOTIFY
telemetry with NO Apple entitlement; cost is `sudo` + the host terminal/app holding Full
Disk Access. **NOTIFY-only by design — it cannot block.** Output is explicitly "NOT API":
schema can change between macOS releases, so parse defensively (tolerate missing/renamed
fields) and version-pin. ESF emits NO general socket-connect events (only UNIX-domain
`UIPC_CONNECT`) — use ESF for process provenance, Network Extension for the flow. The
`tstromberg/esl` Go project is the reference for wrapping eslogger.

### Real enforcement (privileged)

- **Endpoint Security AUTH:** `es_new_client` → subscribe `ES_EVENT_TYPE_AUTH_EXEC` /
  `AUTH_OPEN` → `es_respond_auth_result(ALLOW|DENY)` **before `es_message_t.deadline`** (an
  absolute mach time — miss it and the kernel kills your client; a dead default-deny client
  can soft-brick exec). Mandatory: verdict cache + `es_mute_path`/`es_mute_process`.
  Requires the Apple-granted `com.apple.developer.endpoint-security.client` entitlement.
- **Network Extension:** `NEFilterDataProvider` (per-flow allow/drop keyed on
  `flow.sourceAppAuditToken` — survives `unset HTTPS_PROXY`), `NEDNSProxyProvider`
  (per-process DNS names; DoH/DoT bypasses it), `NETransparentProxyProvider` (redirect +
  in-OS MITM injection point). Entitlement
  `com.apple.developer.networking.networkextension` is **self-service** — the most
  achievable real-enforcement track.
- **pf forced egress:** `pfctl -f -a` anchors loaded by a **root-owned `launchd`** job the
  agent UID cannot flush; `rdr`-redirect agent-UID egress into the broker. `pf` is
  last-match-wins without `quick` — verify with `pfctl -a … -sr` after load or it is
  Potemkin. = ADR-0087 phases 5/6; runbook `docs/operations/tcb-broker-runbook.md`.

## Secret detection — NO keyword NLP (hard rule)

Structured key-format anchors + Shannon entropy, never a keyword wordlist classifier.

1. **Structured formats** (fixed FORMATS, allowed): AWS
   `(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}`, GitHub `gh[pousr]_[0-9A-Za-z]{36}` /
   `github_pat_\w{82}`, OpenAI `sk-(?:proj|svcacct|admin)-…T3BlbkFJ…`, Anthropic
   `sk-ant-api03-…AA`, Slack `xox[baprs]-…`, Google `AIza[0-9A-Za-z\-_]{35}`, Stripe
   `(?:sk|rk)_(?:test|live|prod)_[0-9A-Za-z]{10,99}`, PEM `-----BEGIN … PRIVATE KEY-----`,
   JWT `ey…\.ey…\.…`.
2. **Shannon entropy** `H = -Σ p(c)·log₂ p(c)` as FALLBACK only — base64 floor ≈ 4.5, hex
   ≈ 3.0, length ≥ 20, gated on a structured anchor or a known cred path. Never the sole
   verdict.
3. **Committed baseline** (`.pd-secrets-baseline.json`, detect-secrets model) — re-scan
   surfaces only NEW secrets. Without it the score is noise and trust dies on first run.

Vendor the **gitleaks** MIT rule corpus (`config/gitleaks.toml`) as the format library — a
maintained dependency, refreshed on a schedule. The gitleaks "keyword" stanza is a
candidate-narrowing pre-filter ahead of regex, **never** the verdict — reading it as a
classifier would violate the no-keyword-NLP rule.

Hiding spots: `**/.env`/`.env.*`, `~/.aws/credentials`, `~/.config/gh/hosts.yml`,
`~/.netrc`, `~/.npmrc`, `~/.pip/pip.conf`, `~/.docker/config.json` (base64 `auths.*.auth` —
decode bounded fields before matching), `~/.ssh/*` PEM, shell history, `.mcp.json`,
`~/.cursor/mcp.json`, Claude config. Report `path/line/ruleId/last4/entropy` — **never the
value.** Optional live-verify (`sts:GetCallerIdentity`, `GET /user`, `GET /models`)
collapses false positives but SPENDS the secret over the network — default OFF,
operator-consent-gated, routed through the egress meter.

## Prior-art reuse stance (license-aware)

- **REUSE (link-safe):** gitleaks rule corpus (MIT); `northpolesec/santa` rule model +
  `santactl fileinfo --json` trust extractor (Apache-2.0 — `google/santa` is ARCHIVED as of
  Feb 2025, use the fork; an admin-priv bypass was fixed only in Santa 2025.12, pin
  versions); osquery tables (Apache-2.0); `eslogger` (Apple, pre-entitled).
- **STUDY then reimplement (copyleft — do NOT statically link into PD):** LuLu's
  `NEFilterDataProvider` egress-firewall pattern (GPL-3.0); BlockBlock/KnockKnock
  persistence taxonomy (GPL-family); trufflehog live-verification idea (AGPL-3.0);
  opensnitch rule-DSL (GPL-3.0, the Linux delta). Falco (Apache-2.0) is a rules-DSL design
  reference + the Linux/eBPF tool — it does NOT run on macOS.
- **Existence proofs:** `redcanaryco/mac-monitor` (BSD-3) + Patrick Wardle's tools +
  `momenbasel/puresnitch` (MIT, pf-based) prove an indie can ship a notarized ESF/NE
  system extension.

## Santa-fronted lockdown (real teeth without holding the ESF entitlement)

Operator installs `northpolesec/santa`; PD becomes the rule-authoring + posture layer
(StaticRules + an embedded Moroz-style local sync server, **Standalone** mode = local
approve, no MDM). Real `ES_EVENT_TYPE_AUTH_EXEC` block-before-exec **without PD holding the
Apple-gated ESF entitlement.** Rule precedence: `CDHash > Binary(sha256) > SigningID >
Certificate > TeamID`, most-specific-wins; if code-sig validation fails, only file-hash
rules apply. Modes: 1=Monitor, 2=Lockdown, 3=Standalone.

## Top risk traps (avoid these specific failures)

- **"Green = safe" overclaim** — the cardinal sin. Green means "cooperative-case sensors
  clear," never "sandboxed." The report must say so.
- **Entropy-only false positives** — UUIDs, git SHAs, base64 assets, minified JS. Gate on
  structured anchor + cred path + committed baseline.
- **Missing quarantine ≠ safe** — it is the dangerous path (curl|bash, npm).
- **spctl on bare CLI binaries** — use codesign/SecCode instead.
- **ppid attribution** — use `responsible_audit_token`.
- **ESF AUTH deadline** — slow handler is killed; a dead default-deny client soft-bricks
  exec. Wrap Santa instead of hand-rolling AUTH_EXEC.
- **GPL/AGPL contamination** — LuLu (GPL-3), trufflehog (AGPL-3) cannot be linked into PD;
  gitleaks (MIT), Santa/osquery/Falco (Apache-2), puresnitch (MIT) are safe.
- **ESF entitlement lead time** — Apple-granted, weeks–months, can be declined. Plan the
  read-only/eslogger/Santa-front path as the real near-term track.
- **`kill`-based "block" is a race** — read-only ESF reports an exec already running.
  Observe + best-effort kill, never prevention.
- **Performance/battery** — debounce, watch mtimes via FSEvents not full rescans, cache
  trust by `(path, cdhash)`, mute platform binaries; or the sniffer becomes the hog it
  hunts.

## Key references

- ESF: developer.apple.com/documentation/endpointsecurity ; `es_event_type_auth_exec` ;
  `es_message_t/deadline` ; `es_process_t/responsible_audit_token`.
- eslogger man page: keith.github.io/xcode-man-pages/eslogger.1.html ; wrapper
  `github.com/tstromberg/esl`.
- Network Extension: developer.apple.com/documentation/networkextension/nefilterdataprovider
  ; `…/nednsproxyprovider` ; `…/NETransparentProxyProvider` ; the NE entitlement page.
- Santa: `github.com/northpolesec/santa` ; santa.dev/concepts/rules.html ;
  santa.dev/binaries/santactl.html.
- Secret scanners: `github.com/gitleaks/gitleaks` (MIT corpus) ;
  `github.com/Yelp/detect-secrets` (baseline model) ; `github.com/trufflesecurity/trufflehog`
  (verification idea, AGPL).
- LuLu: `github.com/objective-see/LuLu` (GPL-3, NEFilter pattern).
- TLS SNI / ECH: RFC 6066, RFC 9849.
- PD canon: `docs/adr/0088-host-safety-layer.md`, `docs/adr/0088-build-stage-spec.md`,
  `docs/adr/0050-coast-guard.md`, `docs/adr/0053-out-of-band-enforcement.md`,
  `docs/adr/0087-trusted-computing-base-broker.md`,
  `docs/operations/tcb-broker-runbook.md`, `lib/coast-guard.ts`,
  `lib/coast-guard/egress-meter.ts`, `lib/secret-env.ts`, `core/pd-broker`,
  `core/kernel/pd-anchor`.
