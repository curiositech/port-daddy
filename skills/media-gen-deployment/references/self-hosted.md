# Self-Hosted GPU Patterns (May 2026)

When serverless markup gets unacceptable, or you need control over the bare metal. Vast, RunPod Pods, Lambda, CoreWeave, FluidStack — plus Docker images and weight-storage patterns.

---

## "I just need a 4090 for a few hours"

### Vast.ai
- RTX 4090 from **~$0.29/hr**.
- H100 80GB ~$1.38/hr (P2P).
- **Cheapest in the world.**
- **Reliability varies by host — instances can disappear mid-job.**
- Use for batch / recoverable workloads only. Not user-facing real-time inference.

### RunPod Pods (Community Cloud)
- 4090 ~$0.34/hr.
- H100 ~$1.99/hr.
- Spot H100 ~$1.25/hr.
- **Calmer experience, predictable.**
- Pre-built "RunPod templates" for ComfyUI, A1111, Ollama.

---

## Sustained Workloads (24/7 inference)

### CoreWeave
- H100 PCIe ~$4.25/GPU-hr.
- 8×H100 HGX node bundles at ~$6.15/GPU-hr with CPU/RAM.
- **Premium, enterprise-grade.**
- Best for institutional buyers with reserved-capacity contracts.

### Lambda Labs
- H100 ~$2.99/hr on-demand.
- Solid mid-tier.

### TensorDock
- H100 ~$1.99–$2.25/hr.
- Aggregator model.

### FluidStack
- Aggregates Tier-4 datacenters globally.
- Quote-based, often best for sustained 8×H100 / 8×B200 reservations.

---

## Working Docker Images

| Image | Notes |
|---|---|
| **`yanwk/comfyui-boot`** | Most actively maintained. Latest tag: `base-cu130-pt211-cache-YYYYMMDD`. Boots clean, sane defaults, weights cache directory mounted right. |
| **`ai-dock/comfyui`** | Includes auth + improved UX layer. Better for multi-tenant / shared dev. |
| **`runpod-workers/worker-comfyui`** | Official RunPod serverless wrapper. Use when targeting RunPod. |
| **`ashleykleynhans/comfyui-docker`** | Canonical reproducible RunPod build. |
| **`replicate/cog-*` family** | Reference Cog wrappings of FLUX/SDXL/etc. Useful as templates. |
| **`eisai/comfy-ui`** | Minimalist base. |

For ComfyUI-specific deployment detail, see the `comfyui-mastery` skill.

---

## Saving Model Weights — The Single Most Important Production Rule

**Never bake giant weights into the container image.**

A 30GB image:
- Builds in 20+ minutes.
- Pulls in 30+ seconds even on fast registries.
- Cold-boots in 60+ seconds the first time on each node.
- Wastes registry storage at every push.

**Weights belong on a network volume.**

### RunPod Network Volumes

```
RunPod Network Volume mounted at /runpod-volume/
  /runpod-volume/huggingface-cache/hub/...
  /runpod-volume/comfyui-models/checkpoints/
  /runpod-volume/comfyui-models/diffusion_models/
  /runpod-volume/comfyui-models/clip/
  /runpod-volume/comfyui-models/vae/
```

Set `HF_HOME=/runpod-volume/huggingface-cache` so HF downloads land in the volume.
- First boot: ~3 min download
- Warm restart: ~20s

### Modal Volumes

```python
volume = modal.Volume.from_name("model-weights", create_if_missing=True)

@app.function(volumes={"/cache": volume}, gpu="H100")
def generate(prompt: str):
    import os
    os.environ["HF_HOME"] = "/cache/hf"
    # First call downloads to volume; subsequent calls reuse
    ...
```

Distributed FS, write-once-read-many, optimized exactly for weights. Survives container teardown.

### R2 + custom loader

For maximum portability: weights in R2, downloaded once into a network volume on first boot. Combined with `hf_transfer` for parallel chunked downloads.

---

## HuggingFace Caching Tricks

```bash
# 3-5x faster downloads
export HF_HUB_ENABLE_HF_TRANSFER=1
uv pip install hf_transfer
```

Pre-download in your build step (Modal `image.run_function`) so the snapshot already contains weights:

```python
def download_weights():
    from huggingface_hub import snapshot_download
    snapshot_download("black-forest-labs/FLUX.1-dev",
                      cache_dir="/cache/hf")

image = (modal.Image.debian_slim()
    .pip_install("huggingface_hub[hf_transfer]", "diffusers")
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1", "HF_HOME": "/cache/hf"})
    .run_function(download_weights, volumes={"/cache": volume}))
```

Use `local_dir_use_symlinks=False` when copying between volumes to avoid broken symlinks.

---

## Spot / Interruptible Pricing

- **RunPod Spot** (~30–40% cheaper) — for training, batch generation, anything checkpointable.
- **Vast.ai interruptible** (cheaper still) — for fully recoverable batch.
- **Don't run user-facing real-time inference on spot.** Period.

---

## When Self-Hosting Wins

Roughly:

| Workload | Break-even vs serverless |
|---|---|
| Continuous high-throughput inference | ~30–40% utilization → Pods beat serverless |
| Batch with checkpoint/resume | Spot Pods almost always |
| Long-running training | Spot or reserved Pods |
| Burst-y unpredictable load | Serverless (Modal / RunPod Serverless) |
| <2K media gens/day | Hosted API (Replicate, fal) — your time costs more |

---

## Sample: RunPod Pod Setup for ComfyUI Production

```bash
# 1. Spin up Pod (Community Cloud, RTX 4090, $0.34/hr)
runpodctl create pod \
  --name comfyui-prod \
  --image yanwk/comfyui-boot:base-cu130-pt211-cache-20260501 \
  --gpu-type "RTX 4090" \
  --volume-size 100 \
  --network-volume comfyui-models

# 2. SSH in
runpodctl exec --pod-id <id> bash

# 3. Inside the pod — pin custom-node commits
cd /workspace/ComfyUI/custom_nodes
git clone --branch <pinned-commit> https://github.com/...

# 4. Run with auth proxy
caddy reverse-proxy --from :443 --to :8188 \
  --internal-certs &
python /workspace/ComfyUI/main.py --listen 127.0.0.1
```

Then put basic auth or Cloudflare Access in front of port 443 — never expose 8188 directly.

---

## Anti-Patterns

### Weights baked into image
30GB image, 60s cold start, registry costs. **Use network volumes.**

### Spot for user-facing inference
Eviction in the middle of a request → 5xx. Spot is for batch + training only.

### Forgetting `HF_HUB_ENABLE_HF_TRANSFER=1`
3-5× slower downloads on every cold boot.

### Public `--listen 0.0.0.0` ComfyUI
Mass-compromise event April 2026 (1000+ instances). Always behind auth. See `comfyui-mastery` skill's security reference.

### Storing customer outputs in container `/tmp`
Vanishes on teardown. Always upload to R2/S3/Modal Volume immediately after generation.

---

## Multi-Vendor GPU Strategy

For sustained workloads where capacity matters:

1. **Primary**: RunPod Pods (Community 4090s for cost; H100 Spot for hero) with Network Volume.
2. **Secondary**: Vast.ai for batch overflow.
3. **Burst**: Modal `.map()` for one-off batches.
4. **Reserve capacity**: FluidStack or CoreWeave for guaranteed access during launches.

H100 capacity is regional and spiky in 2026. **Plan for outages.** Real outages observed:
- RunPod H100 capacity exhaustion in us-east during February 2026 (8+ hour queues).
- fal Wan 2.5 queue depth >5 minutes during peak Veo 3 launch week.
- Modal usually meets demand but B200 is constrained — request capacity ahead of campaigns.

For broader production patterns (queues, webhooks, streaming), see `production-patterns.md`.
