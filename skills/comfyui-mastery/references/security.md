# ComfyUI Security (May 2026)

Custom nodes are arbitrary Python with full process privileges — file system, network, env vars, your `models/` directory, your shell. The 2025–2026 incident log is sobering. **Run ComfyUI like you'd run any code-execution sandbox.**

---

## Recent Incident Log

### Feb 2025 — Cryptominer in image-enhancement custom node
- Popular pack (500+ stars) with 30-day delayed activation to evade casual review.
- Lesson: stars and "looks legit" are not signals. Read the code.

### March 2025 — CVE-2025-45076 (ComfyUI-Manager < v3.31)
- **Unauthenticated RCE** via crafted node-install request.
- Anyone running an exposed ComfyUI with old Manager was compromisable.
- **Fix**: pin Manager to >= v3.38. Don't run any older version anywhere.

### May 2025 — "Pickai" C++ backdoor
- Embedded in custom nodes; **~700 servers compromised**.
- CNCERT high-risk advisory issued.
- Nodes spread via ComfyUI Manager defaults at the time.

### Oct 2025 – Jan 2026 — Malicious upscaler nodes
- `upscaler-4k` and `lonemilk-upscalernew-4k` published to Comfy Registry.
- Trojan-horse pass-through nodes ran **Akira stealer** in the background.
- Tracked in [Comfy-Org/ComfyUI#11791](https://github.com/Comfy-Org/ComfyUI/issues/11791).
- The Registry has since added scanning + bans, but coverage isn't perfect.

### April 2026 — Mass cryptomining botnet
- **1000+ exposed ComfyUI instances** mass-compromised.
- Vector: unauthenticated `/prompt` endpoint on `--listen 0.0.0.0` instances + a malicious node payload → Monero miner.
- Documented by The Hacker News.
- **The single biggest preventable disaster of 2026.**

---

## The Defense Playbook

### 1. ComfyUI-Manager security level
Set `security_level` in Manager's `config.ini`:
- `strong` — networked / shared boxes
- `normal` (default) — your workstation
- `normal-` — relaxed channel inclusion
- `weak` — never on anything you care about

Pin Manager to **>= v3.38**.

### 2. Never bind public without auth
**The mistake that ate 1000 boxes.** Default `--listen 127.0.0.1` is fine for local. To allow remote access:

| Goal | Approach |
|---|---|
| Just me, from elsewhere | **Tailscale** + `--listen 100.x.x.x` (your Tailscale IP) |
| Small team | **Cloudflare Access** in front of `--listen 127.0.0.1` (proxied via cloudflared tunnel) |
| Production multi-user | **Reverse proxy with auth** (Caddy + basic auth, nginx + OIDC, etc.) |
| Public demo | **Don't.** Use a hosted ComfyUI service instead. |

### 3. Run as a low-privilege user / in a container
- Dedicated `comfyui` user with no sudo.
- Bind-mount only `models/` and `output/`.
- No write access to system paths.
- For real isolation: Docker + read-only root + tmpfs `/tmp`.

### 4. Review custom nodes before installing
Before clicking Install in Manager:
1. Open the GitHub repo URL in a new tab.
2. Read the latest commits — anything suspicious in the last 30 days?
3. Check `requirements.txt` — unfamiliar networked deps?
4. Skim the node files — unusual `requests` / `urllib` / `subprocess` / `socket` / base64-blob imports?
5. Check the maintainer — known to the ecosystem? Contributing for a while?

**Red flags**:
- New repo (created in last 60 days) with very few commits.
- Disproportionate `requirements.txt` (tens of unrelated network libs).
- Imports that don't match the node's stated purpose.
- Hardcoded URLs to non-public domains.
- Base64-encoded blobs in source.
- Hooks into HF cache or model directories beyond what the node should touch.

### 5. Pin commits in production
Run Manager → Snapshot → Save. Generates `manager-snapshot.json` with every custom-node commit hash.
- Check this into git.
- Restore via Manager → Restore Snapshot.
- **Don't auto-update.**
- When updating, update one pack at a time and test before committing the new snapshot.

### 6. Don't load `.ckpt` from untrusted sources
`.ckpt` uses `pickle` — arbitrary code execution on load. ComfyUI defaults to safetensors-preferred; **keep it that way**. Treat any `.ckpt` from anywhere except an established repo as malware until proven otherwise.

### 7. Watch the resource HUD
**ComfyUI-Crystools** shows live VRAM/RAM/CPU/network. If a node spike a long-running CPU process or unexpected outbound traffic during a "simple txt2img," that's an indicator. Especially after installing a new node pack.

### 8. Keep frontend pinned
ComfyUI Desktop pins it; portable doesn't. A frontend update can ship UI changes that interact unexpectedly with custom nodes. Pin via `--front-end-version Comfy-Org/ComfyUI_frontend@1.X.Y`.

### 9. Network egress monitoring
Production: pf rules / iptables / a network-policy proxy that allows only HuggingFace, Civitai, GitHub raw, and the Comfy Registry. Block everything else. The crypto-miner / stealer payloads in the 2025–26 incidents all required outbound C2 — if the box can't reach C2, the attack is degraded.

### 10. Backups + isolation
- Models on a network volume that's read-only after initial setup.
- `output/` backed up regularly.
- Workflows in git (API format JSON).
- If compromise is suspected: isolate, snapshot, scrub. Don't try to "clean" a compromised ComfyUI install — rebuild from snapshot + verified custom-node hashes.

---

## What the Registry Now Does (May 2026)

- **Scans nodes** for known malicious patterns + reported issues.
- **Bans nodes** — `upscaler-4k` etc. are gone.
- **Surfaces warnings** in Manager UI for newly-flagged packs.
- **Long-term**: signed publisher identities — rolling out 2026, not yet universal.

This is real protection but **not a guarantee**. The default channel is moderated; the wider Registry is a larger surface.

---

## TL;DR Hardening Checklist

- [ ] ComfyUI-Manager pinned >= v3.38 (CVE-2025-45076 fix)
- [ ] `security_level=normal` minimum (`strong` if networked)
- [ ] Not bound to `0.0.0.0` without an upstream auth proxy
- [ ] Custom-node commits pinned via `manager-snapshot.json`, in git
- [ ] No `.ckpt` from untrusted sources; safetensors-only policy
- [ ] Reviewed code before installing every custom-node pack
- [ ] Running as low-privilege user / containerized
- [ ] Crystools HUD enabled; spikes are noticed
- [ ] Frontend version pinned
- [ ] Network egress restricted to known-good hosts (production)
- [ ] Backups of models + outputs + workflows separate from runtime

For broader media-gen production patterns (auth at the API layer, multi-tenant isolation, queue + worker security), see the `media-gen-deployment` skill.
