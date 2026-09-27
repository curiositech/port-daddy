# Ecosystem Comparison — npm vs PyPI vs HF Hub vs Comfy Registry vs VS Code (May 2026)

Where each ecosystem stands on moderation, signing, and defense-in-depth. Use to calibrate trust + know which extra controls a given ecosystem demands.

---

## Comfy Registry

- **Moderation**: Curated default channel (active scanning post-Akira); broader registry has reactive bans.
- **Signing**: **Signed publisher identities rolling out 2026** (not yet universal).
- **Lifecycle hook**: Import on ComfyUI start (next restart after install).
- **Default sandboxing**: None.
- **Notable incidents**: CVE-2025-45076 (Manager < v3.31 RCE, March 2025); Akira upscalers (Oct 2025–Jan 2026); Pickai (May 2025); April 2026 botnet.
- **Maturity verdict**: Roughly where npm was in 2017. Ecosystem governance is ~12–18 months behind the threat reality.
- **Required extra controls**: Lockfile (`manager-snapshot.json`), commit-pin nodes, code review every install + update, low-priv UID, egress allowlist, never `--listen 0.0.0.0`.

---

## npm

- **Moderation**: Reactive takedowns; ~$50M annual security investment post-2018.
- **Signing**: Sigstore-based provenance opt-in (npm provenance, since 2023). ~10% of top packages signed.
- **Lifecycle hook**: `preinstall`, `postinstall`, `prepare` — runs at install time as the invoking user.
- **Default sandboxing**: None. Workarounds: `npm install --ignore-scripts`, pnpm with explicit script allowlist.
- **Notable incidents**: event-stream (2018), ua-parser-js (2021), node-ipc (2022), continuous typosquats.
- **Maturity verdict**: Most mature of the lot for security tooling, but still has weekly typosquats. Sigstore adoption growing.
- **Required extra controls**: `package-lock.json` committed; `npm ci --ignore-scripts` in CI by default; review postinstall hooks; pin transitive deps with `overrides`; consider socket.dev / Snyk for live scanning.

---

## PyPI

- **Moderation**: Typosquat takedowns reactive; no upload review.
- **Signing**: PEP 740 (Sigstore-based) opt-in, lands 2025+. Adoption nascent.
- **Lifecycle hook**: `setup.py` build phase, `pyproject.toml` build hooks (PEP 517), import time.
- **Default sandboxing**: None. `pip install --no-build-isolation=False` runs build in venv but full filesystem access.
- **Notable incidents**: `torchtriton` (Dec 2022, dependency confusion against PyTorch nightly); ongoing typosquat campaigns; `colorama`-clones; `request`-typosquats.
- **Maturity verdict**: Lagging npm on tooling. Sigstore + 2FA mandates for top maintainers in flight.
- **Required extra controls**: `requirements.txt` with `--hash=sha256:...`; `pip install --require-hashes`; uv (faster + safer defaults); inspect `setup.py` and `pyproject.toml` build hooks before adoption; prefer wheels over sdist when possible.

---

## Hugging Face Hub

- **Moderation**: Pickle-scanning warnings on `.ckpt`/`.pt` files; safetensors preferred.
- **Signing**: Sigstore verification rolling out; not yet universal.
- **Lifecycle hook**: `from_pretrained` loads pickle → arbitrary code execution.
- **Default sandboxing**: None. Runs as the calling Python process.
- **Notable incidents**: Periodic malicious `.ckpt` findings on Civitai; lower volume on HF Hub itself due to scanning.
- **Maturity verdict**: HF Hub better than Civitai; the safetensors push has shifted the bulk of risk away from pickle-loaded models. But `transformers` and `diffusers` model_index.json + custom code allows non-pickle execution paths too.
- **Required extra controls**: **Safetensors-only policy.** `from_pretrained(..., trust_remote_code=False)` (the default). For unavoidable `.ckpt`, use restricted unpickling or sandbox.

---

## Hugging Face Spaces

- **Moderation**: Container build review minimal; user-supplied Dockerfiles run on HF infra.
- **Signing**: n/a.
- **Lifecycle hook**: Dockerfile build, container start.
- **Default sandboxing**: Container UID; sometimes shared GPU; HF-side network restrictions vary.
- **Maturity verdict**: HF's problem more than yours, but if you embed Spaces in your product, you inherit the trust.
- **Required extra controls**: Don't embed third-party Spaces in customer-facing flows without isolation. Use Inference Endpoints (paid, dedicated) for production.

---

## VS Code Marketplace

- **Moderation**: Microsoft scanning + reactive takedowns.
- **Signing**: Publisher verification (blue checkmark); not cryptographic.
- **Lifecycle hook**: Activation events — any file open, command palette invoke, etc.
- **Default sandboxing**: Extension Host process; restricted but powerful (full file system, network, command-execution APIs).
- **Notable incidents**: Periodic malicious extensions targeting wallets, GitHub tokens; typosquats of popular extensions.
- **Maturity verdict**: Mid-tier. Microsoft has resources but the surface is huge. Workspace Trust (a per-workspace consent model) was 2021's biggest improvement.
- **Required extra controls**: Don't install extensions from unverified publishers; restrict `host_permissions`; use Workspace Trust to gate auto-tasks; review what extensions ask `Activation Events` for.

---

## Cog (Replicate)

- **Moderation**: Replicate-side container scanning.
- **Signing**: Sigstore for Replicate-published images; user-pushed Cog models less so.
- **Lifecycle hook**: Cog build, predict runtime.
- **Default sandboxing**: Container UID; weights baked into image (no network volume); R8 hardware isolation.
- **Maturity verdict**: Container model means weaker blast radius than ComfyUI; but image-baked weights mean any compromise during training/build pipeline becomes shipped product.
- **Required extra controls**: Sign Cog images with Sigstore; verify on deploy; pin base image digests; audit `predict.py` for unexpected imports.

---

## Triton Inference Server custom backends

- **Moderation**: None by default — customer's responsibility.
- **Signing**: n/a.
- **Lifecycle hook**: `.so` loaded on model load.
- **Default sandboxing**: Triton process UID; **access to all model inputs** (other tenants' data!).
- **Maturity verdict**: Enterprise-grade in deployment but supply chain is "ship it yourself."
- **Required extra controls**: Sign + verify `.so` files; per-tenant Triton instances if multi-tenant; SELinux/AppArmor; SBOM the backend builds.

---

## Ray

- **Moderation**: None — `pip install` happens in the user's worker image.
- **Signing**: n/a.
- **Lifecycle hook**: Worker startup, dynamic actor spawn.
- **Default sandboxing**: Cluster service account (often K8s SA with broad RBAC).
- **Maturity verdict**: Ray is a research-first ecosystem; production hardening is the customer's problem.
- **Required extra controls**: K8s NetworkPolicy on workers; minimal ServiceAccount permissions; pin image digests; ephemeral clusters for untrusted workloads.

---

## Browser extensions (Chrome / Firefox / Safari)

- **Moderation**: Static + dynamic analysis; reactive takedowns.
- **Signing**: Verified publishers (some).
- **Lifecycle hook**: Activation events (URL match, browser action click).
- **Default sandboxing**: Extension sandbox + `host_permissions` granted at install. **Powerful**: can read DOM of permitted sites, intercept requests, access cookies.
- **Notable incidents**: Wallet-stealing extensions, ad-injection, cookie hijack.
- **Maturity verdict**: Best-tooled of the lot (Manifest V3 restricts dangerous APIs); still has incidents.
- **Required extra controls**: Minimal `host_permissions`; review every extension on install; audit installed extensions monthly; consider Chrome Enterprise policies.

---

## Cross-Ecosystem Maturity Score (May 2026)

| Ecosystem | Lockfile? | Signed publishers? | Sandboxing? | Audit logs? | Score |
|---|---|---|---|---|---|
| npm | ✅ strong | ⚠ partial Sigstore | ❌ install-side; ⚠ runtime | ✅ npm registry logs | **B+** |
| PyPI | ⚠ via uv/pip | ⚠ PEP 740 nascent | ❌ | ⚠ partial | **B–** |
| HF Hub (models) | n/a | ⚠ rolling out | ❌ pickle | ✅ commit history | **B–** |
| Comfy Registry | ⚠ snapshot | ⚠ rolling out | ❌ | ⚠ partial | **C+** |
| VS Code | ✅ via versions | ✅ verified publisher | ⚠ extension host | ✅ marketplace | **B** |
| Cog / Replicate | ✅ digest | ⚠ partial | ✅ container | ✅ R8 logs | **B+** |
| Triton custom backends | ❌ | ❌ | ❌ | ❌ | **D** |
| Ray | ⚠ image digest | ❌ | ⚠ K8s SA | ⚠ partial | **C** |
| Browser extensions | ✅ versions | ✅ partial | ✅ sandbox | ✅ web store | **A–** |

The pattern: ecosystems that have suffered prominent incidents (npm, browser extensions) have invested in tooling. Newer ecosystems (Comfy Registry, Triton, Ray) lag because the incidents haven't been costly enough yet.

**For your specific deployment**, the relevant question isn't "is the ecosystem mature" but "do my external defense layers (1 / 3 / 4 / 5 from defense-layers.md) make up for the ecosystem's gaps?" — usually yes if you do them.

For concrete incident postmortems, see `case-studies.md`. For runtime detection, see `detection-runbook.md`.
