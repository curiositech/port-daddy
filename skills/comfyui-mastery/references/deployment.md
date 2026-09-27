# ComfyUI Deployment (May 2026)

Local install paths, headless serving, Docker images, hosted services. For broader media-gen-deployment patterns (Modal, fal, queues, cost engineering), see the `media-gen-deployment` skill.

---

## Local — Apple Silicon

ComfyUI Desktop ships a **signed macOS app for Apple Silicon only** at `comfy.org/download`. Under the hood: PyTorch with the **MPS** backend.

**M-series unified memory is a gift** — a 64GB M3 Max can run Flux dev fp8 + a video model in the same session that would OOM a 24GB 4090.

**Caveats**:
- MPS still has missing/slow ops vs CUDA.
- Custom nodes calling **triton, xformers, or FlashAttention won't work**. Most don't, but check.
- Flux on MPS: ~30–60s per 1024² image on M2 Max at fp16; M4 Max closes the gap to ~15–25s.
- Wan 2.2 5B on MPS via Wan2GP: viable.
- Wan 2.2 14B native fp16 on MPS: **not viable** — use GGUF Q4 at quality cost.
- LTX-2.3 via MLX (`ltx-2-mlx` / `phosphene` / `ltx-video-mac`): **the best open video stack on Mac** because Lightricks shipped MLX as a first-class target.

---

## Local — NVIDIA

The reference target. CUDA 12.x, PyTorch 2.4+.

### Install (portable, recommended for power users)
```bash
git clone https://github.com/comfyanonymous/ComfyUI
cd ComfyUI
uv venv .venv && source .venv/bin/activate
uv pip install -r requirements.txt
python main.py --use-sage-attention
```

### ComfyUI Desktop (NVIDIA + Mac signed apps)
- Signed installer from `comfy.org/download`.
- Bundles ComfyUI-Manager.
- Pinned frontend version.
- Easier for non-power-users; less flexible than portable.

### Critical launch flags

```bash
python main.py \
  --listen 127.0.0.1 \
  --port 8188 \
  --normalvram \
  --use-sage-attention \
  --reserve-vram 1.5 \
  --front-end-version Comfy-Org/ComfyUI_frontend@latest
```

VRAM tuning: `--lowvram | --normalvram | --highvram | --gpu-only | --cpu | --novram`. With **Dynamic VRAM** (early 2026), default `--normalvram` is correct — let it use the new "cached but never paged" RAM scheme.

### Sage Attention install (worth it)
```bash
uv pip install sageattention
```
Then `--use-sage-attention`. ~1.3–1.7× DiT attention speedup on 30/40/50-series.

---

## Local — AMD ROCm

Linux only in practice. PyTorch ROCm 6.x.
- Most Flux paths work.
- Some quantization (Nunchaku) is CUDA-only.
- 7900 XTX performance ~70% of a 4090 for SDXL, less for Flux.

---

## Headless / API Mode

Bind to localhost (default), or **bind to Tailscale/VPN IP**, or **front with a reverse proxy + auth**. **Never `--listen 0.0.0.0`** without an upstream auth proxy — see `security.md`.

### Reference Python client
```python
import json, uuid, urllib.request, websocket

server = "127.0.0.1:8188"
client_id = str(uuid.uuid4())

def queue_prompt(api_format_workflow: dict) -> str:
    payload = {"prompt": api_format_workflow, "client_id": client_id}
    req = urllib.request.Request(
        f"http://{server}/prompt",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    return json.loads(urllib.request.urlopen(req).read())["prompt_id"]

def wait_for(prompt_id: str) -> dict:
    ws = websocket.WebSocket()
    ws.connect(f"ws://{server}/ws?clientId={client_id}")
    while True:
        msg = json.loads(ws.recv())
        if msg.get("type") == "executing" and msg["data"].get("prompt_id") == prompt_id and msg["data"].get("node") is None:
            break
    ws.close()
    return json.loads(urllib.request.urlopen(f"http://{server}/history/{prompt_id}").read())
```

### Endpoints reference
See `architecture.md`.

---

## Docker Images

| Image | Notes |
|---|---|
| **`yanwk/comfyui-boot`** | Most actively maintained community image. Latest tag pattern: `base-cu130-pt211-cache-YYYYMMDD`. Boots clean, sane defaults. |
| **`ai-dock/comfyui`** | Includes auth + improved UX layer. Better for multi-tenant or shared dev. |
| **`runpod-workers/worker-comfyui`** | Official RunPod serverless wrapper. Use when targeting RunPod. |
| **`ashleykleynhans/comfyui-docker`** | Canonical reproducible RunPod build. |
| **`replicate/cog-*` family** | Reference Cog wrappings. Templates only — don't run as-is. |
| **`eisai/comfy-ui`** | Minimalist base. |

---

## RunPod Pattern

Build the image once with ComfyUI + your custom nodes pinned. **Ship models on a Network Volume** so the cold-start image stays small.

```
RunPod Network Volume mounted at /runpod-volume/
  /runpod-volume/huggingface-cache/hub/...
  /runpod-volume/comfyui-models/checkpoints/
  /runpod-volume/comfyui-models/diffusion_models/
  /runpod-volume/comfyui-models/clip/
  /runpod-volume/comfyui-models/vae/
```

Set `HF_HOME=/runpod-volume/huggingface-cache` so HF downloads land in the volume. First boot: ~3 min download. Warm restart: ~20s.

Deploy as a **Serverless Worker** with the `runpod-workers/worker-comfyui` handler:

```python
import runpod, json

def handler(event):
    workflow = event["input"]["workflow"]      # API format JSON
    images = event["input"].get("images", [])  # base64 inputs
    # ... POST to local ComfyUI /prompt, wait via WS, fetch /view, return result
    return {"output_url": "..."}

runpod.serverless.start({"handler": handler})
```

The serverless endpoint exposes `/runsync` (blocking) and `/run` (async + status polling). Hearmeman + ashleykleynhans maintain popular RunPod templates.

---

## Hosted ComfyUI Services

| Service | Audience | Strengths |
|---|---|---|
| **Comfy Cloud** (comfy.org/cloud) | Anyone | First-party, partner-licensed commercial models, no setup |
| **RunComfy** (runcomfy.com) | Artists | Pre-configured envs + workflow library + autoscaling production API |
| **ComfyICU** (comfy.icu) | Developers | Serverless, queue-based, parallelization-friendly |
| **ComfyDeploy** (comfydeploy.com) | Teams | "Vercel for ComfyUI" — versioning + staging + prod, multi-machine orchestration. OSS at `BennyKok/comfyui-deploy`. Backends: RunPod / Modal / managed. |
| **Replicate** | API users | `replicate/cog-comfyui` and `comfyui/any-comfyui-workflow`. Pay per second. |
| **fal.ai** | API users | Custom endpoints, very fast. |
| **Salad / Mystic / Modal** | DIY | General-purpose GPU clouds with documented ComfyUI patterns. |
| **ViewComfy** (newer 2025) | Production | Pick workflow + GPU → autoscaling API. |

---

## ComfyUI → Standalone Code

When the workflow is locked and you don't need the server:

- **`pydn/ComfyUI-to-Python-Extension`** exports any workflow as a runnable Python script that imports ComfyUI's nodes directly. Tight, no HTTP overhead.
- **BentoComfy** — BentoML's ComfyUI adapter. Defines schema, deploys to BentoCloud.
- **comfyui-deploy** — produces SDK-friendly endpoints with versioning.

---

## Memory Management

| Flag | Behavior |
|---|---|
| `--lowvram` | Aggressive offload to CPU. Use on <12GB. |
| `--normalvram` (default) | Smart offload. Right answer 99% of the time. |
| `--highvram` | Keep more in VRAM. Use on 24GB+ when not running other workloads. |
| `--gpu-only` | Everything in VRAM. Use only on 32GB+ for big models. |
| `--cpu` | No GPU. For testing only. |
| `--novram` | Aggressive minimum. Last resort. |

**Dynamic VRAM** (early 2026, NVIDIA Linux/Win): RAM caching that never spills to pagefile, instant unload when other apps demand memory. Combined with safetensors uncommitted file-backed memory, model loaders are near-instant after first load. Default `--normalvram` activates it.

---

## Reproducibility

In production:
1. **Pin ComfyUI commit** in your Dockerfile / install script.
2. **Pin frontend version** with `--front-end-version Comfy-Org/ComfyUI_frontend@1.X.Y`.
3. **Pin every custom-node commit** via `manager-snapshot.json` (see `custom-nodes-2026.md`).
4. **Reference models by exact filename** in workflow JSON; document the manifest separately.
5. **Save seeds** (rgthree Seed defaults to fixed; use that).
6. **Tag node titles** with sampler/scheduler/steps/CFG so a year later you can read the workflow.
7. **Check API-format JSON into git.** Optionally UI-format alongside.

For broader production patterns (job queues, webhooks, cost engineering, multi-vendor failover), see the `media-gen-deployment` skill.
