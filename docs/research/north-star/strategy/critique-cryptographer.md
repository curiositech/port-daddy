# The Coast Guard Layer: A Skeptical Cryptographer's Verdict

## PART I — The Steelman (Port Daddy at its best)

Let me state the strategy the way its sharpest defender would, because the dossiers actually contain a defensible thesis underneath the marketing.

**The structural claim is correct and unusually honest.** Port Daddy's wedge is not "novel crypto." It is *neutrality at an unoccupied chokepoint*: the operator-side, local-first, vendor-agnostic coordination layer for a heterogeneous swarm of agents (Claude Code + Codex + Cursor + Aider) chewing one live working tree on one laptop. Every funded incumbent — Anthropic (MCP), Google (A2A), Cloudflare (Durable Objects), GitHub (Copilot "My Work"), the identity startups (Attestix, cheqd, SPIFFE) — is captive to a conflict of interest PD does not have: they either sell the agent's brain, rent the cloud it runs in, or build a *cross-org* registry. None can be the neutral authority that constrains *their own* agent on the operator's behalf. That seat is genuinely empty, and PD already occupies it with shipped primitives (claims, sessions, the daemon, the bond ledger, Ed25519 Harbor Cards).

**Crucially, the L4 dossier already does my job for me.** It does not claim novel crypto saves the operator. It states the impossibility up front (§1.2): *a secret a process can use, it can copy.* It correctly concludes that the only sound move is a **trust-domain boundary** — the Cutter — that holds the key the agent never sees, meters spend at the only point money leaves, and signs an append-only log with a Secure-Enclave key. It explicitly grades MPC-on-one-machine, encryption-whose-key-the-agent-reads, and attestation-of-an-interpreted-process as **theater**. It demotes the Coast Guard's detection to *post-hoc attribution behind the confinement hull*, citing Schneider's execution-monitor result against itself. This is a threat model written by someone who has already internalized the critique I'm being asked to deliver.

That is the steelman, and it is strong: **the defensible product is OS confinement + a broker, with crypto relegated to honest, tamper-evident accountability — and the strategy says so in writing.**

Now I attack — not the strawman the marketing reaches for, but the *actual residual claims* even the honest version still smuggles in.

---

## PART II — The Attack

### Attack 1 — The "novel crypto" framing is dead on arrival, and the dossier's own best section proves it

There is **no novel cryptography in this stack and there cannot be.** Every primitive named is forty years old and off-the-shelf:

- **Macaroons** — Birgisson et al., Google, 2014. HMAC caveat chains. Not novel.
- **Hash-chained / Merkle audit logs** — Haber–Stornetta 1991, Crosby–Wallach 2009, Certificate Transparency (RFC 6962, 2013), Sigstore/Rekor. Not novel.
- **Secure Enclave / TPM non-extractable keys** — TPM 2.0 spec, Apple SEP. Hardware you didn't build. Not novel.
- **Ed25519 JWTs** — RFC 8032/8037. Not novel.

The honest L4 verdict ("the only cryptography that helps is the cryptography that moves the key out of the agent's address space") is **correct and is an argument *against* leading with crypto at all.** Moving a key into a separate process is an *operating-systems* result (privilege separation — Provos et al., OpenSSH, 2003), not a cryptographic one. The crypto is bookkeeping on top. **Any pitch that says "novel crypto security layer" is selling the bookkeeping as the vault.** The redteam instinct here is right: the word "novel" should be struck from every deck. The strongest version of PD *abandons* the crypto-novelty claim entirely.

### Attack 2 — The Cutter is a brokered-credential proxy. On a machine the operator's UID fully controls, it degrades to advisory the instant the agent declines to use it.

This is the brutal one. The entire security value rests on a single load-bearing assumption buried in §3.1:

> "a local daemon can enforce real OS-level confinement **only by being the thing that spawns the agent**."

Pull that thread and the layer unravels against the *stated adversary* — a prompt-injected agent running as the operator's UID with `bash`:

1. **The sandbox only binds children of `pd spawn`.** A turned agent does not have to respawn itself inside Seatbelt. It already has a shell. Seatbelt/Landlock confine a *process you launched confined*; they do not retroactively confine the agent that is *already running unconfined* when the operator typed `claude` by hand — which is how 99% of these tools are actually started. The dossier admits this ("PD cannot retroactively confine an agent the operator launched by hand") and then waves it away with "make raw launches second-class." **Second-class is a euphemism for advisory.** The agent that ignores `session_files` rows (the L0 critique's own example) also ignores your suggestion to launch via `pd spawn`.

2. **Same-UID can unwrap Seatbelt's children.** `sandbox-exec` profiles are inherited, but a process inside a permissive-enough profile that retains `process-exec` and any writable temp can stage a fresh interpreter; and critically, **the *operator's other unconfined processes* (the editor, the shell, a second agent) share the UID and can read the same files.** Confinement of agent A is worth nothing if agent B, or the operator's own `node` REPL, is unconfined and reachable via a socket, a dropped file, or a `launchctl` call. You have to confine *everything* or you've confined *nothing* — and a vendor-neutral tool by definition does not control how Cursor or a hand-run Codex launches.

3. **`sandbox-exec` is deprecated and Apple has been clear it is unsupported.** Building a paid security product's *prevention* guarantee on a deprecated SPI that Apple ships warnings about, can change SBPL semantics on any point release, and explicitly tells developers not to use — is the kind of foundation that turns "impossible by construction" into "impossible until macOS 27." The honest tier is the App Sandbox or a VM; both break the "your real local checkout" pitch.

**Real comparable:** This is *exactly* the failure surface of `git` hooks and `pre-commit` as "security." A pre-commit hook that scans for secrets is trivially bypassed by `--no-verify`, and the operator's own MEMORY file already encodes this lesson ("Guardrails never advertise their bypass"). The Cutter is a network-layer pre-commit hook. It stops the *cooperative* mistake (the runaway loop, the confused deputy that *tries* to behave) and stops *nothing* the moment the adversary is genuinely the stated one: a malicious process with your shell.

### Attack 3 — The spend-cap "impossible to bankrupt me by construction" claim is false against the stated adversary; true only against a weaker one.

The §4.2 QED — "spending money requires the Cutter; the Cutter refuses past the cap; QED" — contains a smuggled premise: *that all spend flows through the Cutter.* It does not, and cannot, on a machine the agent controls:

- **The agent can talk to `api.openai.com` directly.** Header injection only works if the agent has *no other key*. But the threat model (§1) grants the agent "full read of the filesystem the UID can read… `~/.aws`, `~/.claude.json`." If *any* usable key exists anywhere on the disk — and on a developer's machine running five agent tools, it does — the agent reads it and POSTs straight to the upstream, bypassing the Cutter entirely. The Cutter only caps spend on *the key it exclusively holds*. The pitch requires that the Cutter hold the *only* key on the entire machine, which is unachievable the moment the operator uses any tool PD didn't wrap.
- **Unsetting `HTTPS_PROXY` is one line.** A turned agent does `unset HTTPS_PROXY; curl ...`. Proxy env-vars are advisory to the *application*, not enforced by the kernel. To make them enforced you need a per-process network namespace / pf-rule that *forces* egress through the proxy and drops everything else — which is back to Attack 2's full-confinement problem, and which a vendor-neutral local tool cannot impose on processes it didn't spawn.

**Real comparable:** This is the **DLP (Data Loss Prevention) industry's permanent embarrassment.** Endpoint DLP that lives as the user and tries to mediate the user's own egress is routinely bypassed; the only DLP that *works* is network-perimeter (a box the user can't be) or kernel-enforced full-device-management (MDM the user doesn't control). PD is endpoint DLP run *by the very principal it's policing.* The spend cap is real against a **cooperative** agent or a **dumb** loop. It is theater against the **malicious same-UID** agent the threat model centers. The dossier's Phase-A monetization note actually concedes this in passing ("this only defends the *cooperative* same-machine case… **not** a truly malicious local adversary") — which directly contradicts the §4.2 "bankrupt me becomes impossible by construction" headline. **Pick one. The honest one is the Phase-A footnote, not the QED.**

### Attack 4 — Where real guarantees actually stop: the silicon line, and PD is on the wrong side of it.

Cryptography gives you exactly one hard guarantee against a same-UID adversary, and it is narrow:

> **Non-repudiation of events the agent voluntarily routed through a hardware-keyed signer, *up to the moment the agent stops routing them.***

That is real. A Secure-Enclave-signed, externally-witnessed log means the agent cannot *forge* or *silently rewrite* history. But note the three holes the silicon does **not** close:

1. **Truncation / silence is not forgery.** A turned agent simply *stops emitting log entries* and does its damage off-book. The hash chain proves nothing about events that never entered it. The dossier's fix ("anchor the head to an external witness") helps detect *truncation of a previously-witnessed chain* but does nothing about actions that were never brokered in the first place (Attack 3's direct-egress path). You get a beautiful, signed, tamper-evident record of *the attacks the agent was polite enough to route through you.*
2. **The signer signs whatever the broker tells it.** The Enclave guarantees the *key* isn't stolen; it guarantees nothing about the *truth of the statement signed.* If the agent compromises the Cutter process (same UID — it can debug, `DYLD_INSERT_LIBRARIES`, or just kill-and-replace the unprivileged daemon), it makes the Enclave sign lies. **Hardware-bound keys move the trust boundary to the process holding the key — and that process is same-UID with the adversary.** The Enclave is a vault with the door-keys held by someone standing next to the burglar.
3. **Attestation of the agent is impossible and the dossier admits it.** You cannot attest an interpreted, dynamically-composed LLM process against a same-UID attacker. So you never actually know the thing you're metering and signing for is the agent you think it is.

**The line, stated precisely:** real guarantees stop at *"undeniable accountability for cooperatively-brokered actions, assuming the broker process itself is not compromised by the co-resident adversary."* That last clause is doing enormous work, and against the stated threat model it is **not satisfiable** without a separate trust domain that is *not* same-UID — i.e., a different user account, a VM, an MDM agent, or remote infrastructure. Every one of those breaks the "local-first, your real checkout, single operator" identity that is the *entire positioning moat.* The security story and the positioning story are in direct tension, and nobody has priced that.

### Attack 5 — The category is funded, and PD's honesty is a go-to-market liability against louder liars.

Pipelock (open-source agent firewall), Archestra ($10M, agent credential broker), Portal26 (agentic token controls) are doing the *same broker pattern* and are willing to say "we stop your agent from going rogue" without the seven paragraphs of caveats. PD's honest version — "we stop the *cooperative* failure and give you a signed log of the rest" — is **more correct and harder to sell.** The redteam-honest framing the operator (rightly) demands is a *truth* advantage and a *fundraising* disadvantage simultaneously. That's not a reason to lie; it's a reason to know the knife-fight you're walking into is against people who will out-claim you.

---

## PART III — The single change that most blunts my attack

**Stop spawning agents as the operator's own UID. Make `pd spawn` create each agent under a dedicated, unprivileged macOS/Linux *user account* (or a per-agent VM via `Virtualization.framework`), and make the Cutter the broker process owned by a *different* account the agents cannot debug, kill, or `DYLD`-inject.**

This is the one move that converts the whole stack from advisory to enforced, because it relocates the trust-domain boundary from "two processes, same UID" (where the OS gives the adversary parity) to "two processes, *different* UIDs" (where `chmod 0600` and process isolation become the *real* boundary the dossier keeps claiming they already are). It makes:

- **Attack 2 fail:** the agent's UID literally cannot read the Cutter's key file or attach to its process — `keychain.ts`'s own stated boundary ("UNIX permissions are a boundary between *users*, not processes of one user") finally bites *for* you instead of against you.
- **Attack 3 fail:** the agent's account can be put behind a pf/nftables egress rule that *forces* all traffic through the Cutter, because PD controls that account's entire environment — and there is no stray `~/.aws` key in the agent's home because it's a fresh account.
- **Attack 4's clause 2 close:** the Enclave's door-keys are now held by a process the adversary is *not* same-UID with.

The cost is exactly the cost the dossier flinched from: it is **no longer "your real local checkout, edited in place."** The agent works a *copy* in its own home, and you merge results back across the UID boundary — which looks a lot like E2B/Daytona/Cloudflare's sandbox model that PD's whole positioning defined itself *against.*

So the sharpest version of my attack is also the sharpest strategic question: **the security you can actually enforce requires the isolation your positioning sold against.** Resolve that tension honestly — pick "real confinement via a second UID/VM, and reframe local-first as *the operator owns the box*, not *the agent edits the live tree*" — and the Coast Guard stops being theater. Refuse to, and you're shipping a beautifully-signed logbook of the attacks your agent chose to tell you about.",