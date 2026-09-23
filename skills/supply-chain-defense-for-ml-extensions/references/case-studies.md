# Case Studies — What Actually Happened (May 2026)

Postmortems extract the L3 lesson. For each: what happened, why it worked, what would have stopped it.

---

## Case 1: Akira upscaler nodes (ComfyUI, Oct 2025 – Jan 2026)

**What**: Two custom nodes (`upscaler-4k`, `lonemilk-upscalernew-4k`) published to the Comfy Registry. Pass-through wrappers around real upscalers; ran the **Akira stealer** (credential + browser-data exfil) in a daemon thread.

**Why it worked**:
- Plausible name + working functionality — passed casual review.
- Background thread didn't impact the foreground operation users tested.
- Registry scanning at the time didn't catch behavior-only IOCs.

**Detection delay**: Weeks before community + Comfy Org caught it.

**Tracked at**: `Comfy-Org/ComfyUI` issue #11791.

**What would have stopped it**:
- Egress allowlist (Layer 4) — Akira C2 was outside HF/GitHub/PyPI; would have failed.
- Code review at install (Layer 2) — `threading.Thread(target=_steal, daemon=True)` is a clear IOC if you grep for it.
- Process / connection monitoring (Layer 6) — unexpected outbound HTTPS to non-allowlist host.

**L3 lesson**: Background threads in nodes whose stated purpose is pure-compute are a category-1 red flag. Add `grep -rEn 'threading.Thread.*daemon=True' custom_nodes/` to your hygiene cron.

---

## Case 2: Pickai C++ backdoor (ComfyUI, May 2025)

**What**: PyPI wheel containing a compiled C++ component (`pickai`) published as a ComfyUI dependency. Established a remote-control backdoor; **~700 ComfyUI servers compromised**.

**Why it worked**:
- Compiled artifact in a wheel — code review tools that grep Python miss compiled `.so`/`.dll` payloads.
- Once installed, runs at Python import time with no further user interaction.
- CNCERT issued a high-risk advisory after the campaign was already widespread.

**Detection delay**: Weeks; CNCERT publication after large-scale compromise.

**What would have stopped it**:
- Lockfile + manual review (Layer 1+2) — checking that pinned wheel against a known-good hash.
- Sigstore provenance (Layer 1) — would have failed verification (no signed publisher).
- Container sandbox + seccomp (Layer 3) — backdoor's syscall set wouldn't pass a tight profile.
- Egress allowlist (Layer 4) — backdoor C2 outside known-good hosts.

**L3 lesson**: Wheels with compiled components require **hash-pinning** + **publisher verification**. `pip install --require-hashes` + `cosign verify` for Sigstore-signed packages. Compiled artifacts deserve more scrutiny than pure-Python.

---

## Case 3: April 2026 ComfyUI mass cryptomining botnet

**What**: Unknown actor mass-scanned the public internet for port 8188; found 1000+ ComfyUI instances bound to `0.0.0.0` with no auth. Submitted crafted workflows that triggered a malicious custom-node payload to install Monero miners.

**Why it worked**:
- Default `--listen 0.0.0.0:8188` was a tutorial-recommended pattern.
- No auth on `/prompt` endpoint by design.
- Some users had ComfyUI-Manager security at `weak`, allowing arbitrary node install via API.
- Documented by The Hacker News in April 2026.

**Detection delay**: Some boxes ran for weeks before owners noticed power bills.

**What would have stopped it**:
- **Layer 5 alone** — never bind public without auth. Tailscale / Cloudflare Access / reverse proxy with basic auth would have prevented every successful infection.
- **Layer 4** — egress allowlist would have caught miner C2.
- **Layer 6** — GPU util monitoring would have flagged within minutes.

**L3 lesson**: The single most important network-config rule for any AI/ML daemon is **never expose the unauthenticated control plane**. The April 2026 incident is the canonical case for this; cite it in your platform-security wiki.

---

## Case 4: ComfyUI-Manager CVE-2025-45076 (March 2025)

**What**: Unauthenticated RCE in ComfyUI-Manager versions before v3.31. Crafted POST to the Manager's install endpoint executed arbitrary code as the daemon user.

**Why it worked**:
- Manager exposed install endpoints accessible to any client that could reach the ComfyUI HTTP server.
- No CSRF token, no authentication on Manager API.
- Combined with `--listen 0.0.0.0` it became fully remote.

**Fix**: v3.31+ added auth checks. Pin to >= v3.38 in production.

**What would have stopped it**:
- Layer 5 (auth on control plane) — Manager API behind same auth as ComfyUI.
- Layer 1 (pinned versions in production) — staying current with security patches.

**L3 lesson**: First-party tools (the Manager itself!) are part of your supply chain. CVE feeds for ComfyUI-Manager belong in your patching cadence.

---

## Case 5: npm event-stream → flatmap-stream (2018)

**What**: Original `event-stream` maintainer transferred ownership to a "helpful contributor." That contributor added `flatmap-stream` as a dependency, which contained a payload targeting **Copay** Bitcoin wallet.

**Why it worked**:
- Maintainer transfer was social engineering; npm at the time had no way to flag this.
- Targeted payload activated only when included in a specific downstream product.
- Dormant for weeks before activation.

**Detection delay**: Months; community detected payload via CPU spike.

**What would have stopped it**:
- Diff every dependency update (Layer 2).
- Sigstore provenance (Layer 1) — would have shown an unfamiliar publisher.
- Outbound allowlist on Copay's build hosts (Layer 4).
- Build-time SBOM diffs (Layer 1+2).

**L3 lesson**: **Maintainer transfer is a security event.** Most ecosystems still don't surface it well. Include "ownership change" as a trigger for re-review of any dep.

---

## Case 6: ua-parser-js (npm, 2021)

**What**: Maintainer's npm credentials phished. Three malicious versions of a wildly-popular package (~7M weekly downloads) published. Contained Linux/Windows-specific cryptominers + credential stealers.

**Why it worked**:
- Compromised maintainer = legitimate-looking publisher.
- `postinstall` scripts ran at `npm install` time.
- Auto-update tooling (Renovate, Dependabot) propagated the bad versions widely.

**Detection delay**: Hours from publish to detection (community), but auto-updaters propagated faster than manual review.

**What would have stopped it**:
- `npm install --ignore-scripts` (Layer 1+3).
- Disable auto-merge for dependency updates (Layer 2).
- Sigstore provenance (Layer 1) — postcompromise would have shown a new attestation.
- Egress allowlist on dev/CI machines (Layer 4).

**L3 lesson**: **Auto-merging dependency updates is the worst-case multiplier.** A compromised maintainer + auto-update propagates compromise faster than human response. Set Renovate / Dependabot to require human approval for security-sensitive packages.

---

## Case 7: torchtriton dependency confusion (PyPI, Dec 2022)

**What**: PyTorch nightly used an unscoped internal package `torchtriton`. Attacker registered the same name on public PyPI with a higher version number; `pip install` pulled the public (malicious) one due to default index resolution.

**Why it worked**:
- Internal package not scoped (`@pytorch/triton` vs `torchtriton`).
- Default `pip` resolution prefers PyPI fallback.
- Build hooks exfiltrated SSH keys and `~/.aws`.

**Detection delay**: Days. Disclosed publicly within ~48 hours.

**What would have stopped it**:
- Scope or namespace internal packages.
- `pip install --index-url internal --no-deps` for internal packages.
- Build sandbox without filesystem access to `~/.ssh`, `~/.aws` (Layer 3).
- Egress allowlist on build runners (Layer 4).

**L3 lesson**: **Build runners are equally a target as production daemons** — they have access to signing keys, deploy credentials, source code. Apply the same defense layers.

---

## Case 8: leftpad (npm, 2016) — *not* a security incident, but an availability lesson

**What**: Maintainer unpublished `leftpad` over a naming dispute. Thousands of downstream builds broke instantly.

**Why it matters here**:
- Demonstrated that the **registry itself is a SPOF**.
- Catalyzed npm's "no-unpublish-after-72h" policy.
- The lesson generalizes to ML: HF Hub, Civitai, registry.comfy.org are all single points of failure for your build pipeline.

**Defense**:
- Mirror critical dependencies (e.g., Verdaccio / pulp / artifactory).
- Cache HF model weights on your own object storage.
- Document a "vendor unavailable" runbook.

**L3 lesson**: Supply-chain *availability* is part of the supply-chain threat model. Plan for "the registry is down" as well as "the registry served us malware."

---

## Patterns across all cases

| Lesson | Frequency | Defense |
|---|---|---|
| Compromised maintainer / new contributor | 4 of 8 | Diff-on-update + Sigstore |
| Postinstall / build-time hook | 3 of 8 | `--ignore-scripts` + sandbox |
| Outbound C2 / exfil | 6 of 8 | Egress allowlist |
| Public-facing unauth control plane | 2 of 8 | Reverse proxy + auth |
| Compiled artifact in package | 2 of 8 | Hash-pin + Sigstore + sandbox |
| Auto-update propagation amplifier | 3 of 8 | Disable auto-merge for security-sensitive |

**The strongest cross-case finding**: Layer 4 (egress allowlist) would have detected or contained 6 of 8 incidents. It's the highest-leverage single defense to add.

For the runbook to find these IOCs in your own deployment, see `detection-runbook.md`. For attack-pattern shapes, see `attack-patterns.md`.
