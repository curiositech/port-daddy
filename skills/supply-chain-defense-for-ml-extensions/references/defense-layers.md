# Defense Layers — Sigstore, SLSA, SBOM, Sandboxing, Allowlists

The toolkit. Pick layers that match your stakes; sequence them so each one is independently load-bearing.

---

## Layer 0 — Don't run untrusted code

The cheapest defense. Some packages, you simply don't need:
- "Free upscaler" with 50 stars and a 3-day-old commit history → use Ultimate SD Upscale instead.
- "Speed-boost" custom node from a single-issue maintainer → use Nunchaku from a known-good org.

**Cost**: minor inconvenience. **Benefit**: defeats every attack class because the code never runs.

---

## Layer 1 — Lockfiles, commit pinning, immutable builds

### Lockfiles you should be using

| Ecosystem | Lockfile | Hash-verify? |
|---|---|---|
| Python | `requirements.txt` with `--hash=sha256:...` | Yes (pip --require-hashes) |
| Python | `poetry.lock` / `uv.lock` | Yes (default) |
| Python | `Pipfile.lock` | Yes |
| npm | `package-lock.json` | Yes (npm ci --enforce-integrity) |
| npm | `pnpm-lock.yaml` | Yes |
| ComfyUI | `manager-snapshot.json` | Commits, not hashes |
| Cog | `cog.yaml` + image digest in CI | Image digest (sha256) |
| Docker | `image@sha256:...` in deploy manifests | Yes |

**Rule**: every dependency in production has a lockfile entry pinning to a SHA, not a version range. Never `^1.2.3`. Never `main` / `master`.

### Immutable build pipeline

```
git commit → CI builds image with pinned digests → image pushed with sha256 digest
                                                  ↓
                                            production pulls @sha256:abcd...
                                                  ↓
                                            never installs at runtime
```

The daemon's running container has **no write access to its own deps**. To update: build new image, deploy new image, atomic rollover. No in-place mutation.

---

## Layer 2 — Code review on adoption + every update

### The 5-minute pre-adoption review

(See SKILL.md.) GitHub repo URL → recent commits → `requirements.txt` / `package.json` → grep for dangerous imports → maintainer continuity.

### Update review

Diff every dependency bump. Even patch bumps. Tools:
- `pip-compile --upgrade-package foo` then review the diff.
- `npm-check-updates --interactive`.
- ComfyUI Manager → Snapshot diff.

**Auto-merge for security-sensitive packs is malpractice** — that's how ua-parser-js spread.

### Continuous code review (light)

For your top 20 most-trusted packs, set up a monthly cron that:
1. Diffs `git log` since last review.
2. Sends a summary email.
3. Flags any new contributor or suspicious pattern.

Lightweight; catches the slow-burn class of attacks.

---

## Layer 3 — Capability sandboxing

### Process UID

```bash
useradd -r -s /bin/false -d /opt/comfyui comfyui
chown -R comfyui:comfyui /opt/comfyui
# Daemon runs as comfyui, NOT as root, NOT as your login user
sudo -u comfyui /opt/comfyui/venv/bin/python main.py
```

`comfyui` user can't read `~/.aws`, can't sudo, can't see other users' processes.

### Container sandbox

```dockerfile
FROM python:3.11-slim
RUN useradd -r -u 1000 comfyui
USER comfyui
WORKDIR /app
COPY --chown=comfyui . .
RUN pip install --no-deps -r requirements.txt
ENTRYPOINT ["python", "main.py"]
```

Run with restrictive flags:
```bash
docker run \
  --read-only \
  --tmpfs /tmp:size=1g \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --memory 32g --cpus 8 \
  --gpus all \
  -v /srv/models:/app/models:ro \
  -v /srv/outputs:/app/outputs \
  -p 127.0.0.1:8188:8188 \
  comfyui:pinned-sha
```

Key flags:
- `--read-only` + tmpfs `/tmp` → can't persist payload to disk.
- `--cap-drop ALL` → no kernel capabilities (no raw sockets, no ptrace, no mount).
- `--security-opt no-new-privileges` → setuid binaries can't escalate.
- `models:ro` → custom node can't tamper with weights.
- `127.0.0.1:8188` → not bound public.

### Linux namespace / seccomp

For higher-stakes deployments: seccomp profile that whitelists syscalls (no `ptrace`, `mount`, `unshare`, `bpf`); user namespace; `--security-opt seccomp=profile.json`.

### macOS

`launchd` with `SoftResourceLimits`, `EnvironmentVariables` scoped tight, no `RunAtLoad: root`. macOS sandboxing via `sandbox-exec` is undocumented but powerful.

### Windows

Run as low-priv user (not Administrator); Windows Sandbox or Hyper-V container for higher isolation.

---

## Layer 4 — Egress allowlist

The single highest-leverage defense for class-1 (opportunistic crypto) attacks.

### Allowed destinations for a typical ComfyUI box

- `huggingface.co` (model weights)
- `civitai.com` (community models, if used)
- `github.com` + `raw.githubusercontent.com` + `api.github.com` (custom-node clones)
- `pypi.org` + `files.pythonhosted.org` (Python deps)
- `registry.comfy.org` (Manager + registry)
- Your own asset endpoints (R2 / S3)

Block everything else by default. **Every published 2024–26 ML supply-chain attack required outbound C2 to a host outside this list.**

### Implementation options

| Tool | Best for |
|---|---|
| **Cloudflare Zero Trust + cloudflared** | Easy; allowlists by hostname; works behind NAT |
| **AWS NACL + VPC endpoints** | Cloud workloads; per-subnet; integrates with Security Groups |
| **iptables + `ipset`** | Self-hosted Linux; per-IP/CIDR (less convenient than hostname) |
| **`dnsmasq` + `tinyproxy`** | Hostname-based outbound proxy on a self-hosted box |
| **Pi-hole / NextDNS at network edge** | Home/lab; coarse-grained |
| **Kubernetes NetworkPolicy** | K8s; egress from pod scope |

Test the allowlist by trying to `curl pool.minexmr.com:443` from inside the daemon — should fail.

---

## Layer 5 — Auth at the control plane

The daemon's API endpoint is a separate attack surface. Defense:

- **Never `--listen 0.0.0.0` without an upstream auth proxy.**
- **Tailscale / Tailnet** for dev access — works behind NAT, MagicDNS, no public exposure.
- **Cloudflare Access** for production — OIDC + per-org rules, browser-friendly.
- **Reverse proxy with auth** — Caddy + basic auth, nginx + OIDC, traefik + forward-auth.
- **mTLS for service-to-service** — when daemons talk to each other.

For the broader runtime hardening playbook, see the `gpu-hosted-asset-hardening` skill.

---

## Layer 6 — Observability

### Per-process

- `ps`, `top`, `htop` baselines — alert on unexpected processes.
- ComfyUI-Crystools HUD (or Prometheus node_exporter) for VRAM / GPU util.
- File-integrity monitoring on `models/`, `custom_nodes/` (auditd, AIDE, Tripwire).

### Network

- `netstat -tlnp` periodic; alert on new listening ports.
- `ss -tnp` periodic; alert on new outbound destinations not on allowlist.
- NetFlow / VPC Flow Logs centralized to a SIEM (Datadog, Better Stack, Honeycomb).

### Logs

- Daemon logs to a central log sink (not just `/var/log/...`).
- Tag with deployment SHA + image digest.
- Alert on `execution_error`, `execution_cached`, novel custom-node imports.

### Metrics that matter

- GPU utilization > 80% with no active jobs (cryptominer signal).
- Outbound connection count to non-allowlist hosts > 0 (exfil signal).
- File-modification rate in `custom_nodes/` (unexpected install signal).
- Process count delta (new daemon thread / process).
- Persistence-mechanism changes (cron, systemd, ~/.bashrc).

---

## Layer 7 — Incident response runbook

Pre-write the playbook for "we think we're compromised." See the `comfyui-incident-response` skill.

Key elements:
- Triage decision tree (real or false alarm).
- Containment (kill, isolate, snapshot).
- Forensic collection (what to preserve before rebuild).
- Recovery (rebuild from clean snapshot).
- Postmortem template.

Drill it before you need it. **An untested runbook is worse than none** — it gives false confidence.

---

## SLSA, Sigstore, SBOM (the maturity ladder)

For higher-stakes deployments, climb this ladder:

### SLSA (Supply-chain Levels for Software Artifacts)

| Level | What you get |
|---|---|
| L1 | Build process documented |
| L2 | Build is hosted on a build service with auth |
| L3 | Build platform is hardened, provenance signed |
| L4 | Two-person review, hermetic + reproducible builds |

Most ML projects in 2026 are at L1–L2. Aim for L3 if you ship customer-facing.

### Sigstore (cosign / fulcio / rekor)

- Sign every image at build time: `cosign sign --identity-token $TOKEN registry/image@sha256:...`.
- Verify at deploy: `cosign verify --identity ... registry/image@sha256:...`.
- The Rekor transparency log gives auditable provenance.
- Works for OCI images, Python wheels (via PEP 740), npm packages (Sigstore provenance).

### SBOM (Software Bill of Materials)

- Generate at build time: `syft packages dir:. -o spdx-json > sbom.json` or `cyclonedx-py`.
- Store with the artifact.
- Diff SBOMs across releases to catch unexpected new dependencies.
- Required by EO 14028 for US federal contractors; increasingly required by enterprise customers.

### Vulnerability scanning

- `trivy image registry/image:tag` for OS + language CVEs.
- `pip-audit` for Python.
- `npm audit` (noisy but useful).
- Run in CI; block deploys on critical CVEs.

---

## The "1% of effort, 80% of safety" minimum

If you only do four things:

1. **Lockfile with hashes** committed to git.
2. **Daemon runs as low-priv user**, not root, not your login user.
3. **Egress allowlist** to known-good hosts.
4. **Control plane behind auth** (Tailscale or reverse proxy).

These four defeat every published 2024–26 ML supply-chain attack against ComfyUI. Total setup cost: half a day. Maintenance: minor.

For ecosystem-by-ecosystem differences and case studies, see `ecosystem-comparison.md` and `case-studies.md`.
