# Serverless GPU Platforms (May 2026)

The contenders, with honest pricing + cold-start + DX tradeoffs.

---

## Modal (modal.com)

**Pricing per GPU-second (May 2026)**:
- B200: $0.001736/s ($6.25/hr)
- H200: $0.001261/s ($4.54/hr)
- H100: $0.001097/s ($3.95/hr)
- A100 80GB: $0.000694/s ($2.50/hr)
- A100 40GB: $0.000583/s ($2.10/hr)
- L40S: $0.000542/s ($1.95/hr)
- T4: ~$0.000164/s ($0.59/hr)

**Deployment format**: Python decorators.
```python
import modal

app = modal.App("flux-dev")
volume = modal.Volume.from_name("flux-weights", create_if_missing=True)

image = modal.Image.debian_slim().pip_install("torch", "diffusers", "transformers")

@app.function(gpu="H100", volumes={"/cache": volume},
              enable_memory_snapshot=True, min_containers=1)
@modal.fastapi_endpoint()
def generate(prompt: str) -> bytes:
    # ... pipeline.run(prompt)
    ...
```

**Cold start in 2026**:
- Without optimization: 20–60s for typical diffusion.
- **CPU memory snapshots**: ~2–8s.
- **GPU memory snapshots** (alpha, 570/575 driver, CUDA checkpoint/restore): **0.5–2s** for ViT, **~5s** for vLLM-served small LLM, **~2s** for Parakeet (down from 20s). Tolga Oğuz documented ComfyUI cold starts under 3s.

**Persistent storage**: `modal.Volume` (write-once-read-many distributed FS — weights belong here), `modal.Dict`, `modal.Queue`, ephemeral `/tmp` per container.

**Networking/secrets**: `modal.Secret`, built-in HTTPS endpoints, `@web_endpoint`, WebSocket via FastAPI.

**Strengths**:
- Best-in-class DX for Python ML engineers.
- Real per-second billing.
- Memory snapshots are state-of-the-art.
- `.map()` for embarrassingly-parallel batch is exceptional.

**Weaknesses**:
- GPU snapshots still alpha.
- No first-class TS/JS SDK (HTTP only).
- Cost adds up if you sleep workers carelessly.

**Pick this if**: Python team, full control over GPU, custom pipelines, batch jobs, or anything beyond "call FLUX."

---

## Replicate

- **Acquired by Cloudflare in 2026** — strategic shift in progress, R8 hardware integration with CF in flight.
- **Pricing per image** (hosted models): FLUX.1 [schnell] $0.003, FLUX.1 [dev] $0.030, FLUX.1 [pro] $0.055. Custom Cog deployments billed per-GPU-second.

**Deployment format**: Cog (`cog.yaml` + `predict.py`). Push to `r8.im/<user>/<model>`.

**Tiers**:
- **Public models** = pay-per-prediction.
- **Deployments** = dedicated hardware with `min_replicas` / `max_replicas`.

**Cold start in 2026**:
- Public model first call: 10–180s depending on model size.
- Deployments with `min_instances=1`: 3–10s.
- Fine-tuned LoRA models advertised under 1 second cold boot.

**Storage**: **No persistent volumes — weights bake into the Cog image.** This is a real limitation for big models.

**Strengths**:
- Easiest "I have a Python script, give me an HTTP endpoint" tool ever made.
- Webhooks reliable.
- Public model marketplace.

**Weaknesses**:
- Cold starts on public models notoriously bad.
- Pricing opaque on dedicated.
- "Weights in image" model means a 30GB container that takes forever.

**Pick this if**: One-line API for a published model, or shipping a SaaS that calls FLUX-pro and don't want to manage GPUs.

---

## fal.ai

- **Hosted catalog pricing**: per-output for FLUX, Wan 2.5, Veo 3, etc. — $0.025/image typical, $0.05/s for Wan 2.5 video, $0.40/s for Veo 3.
- **Custom serverless deployments**: H100 at $1.89/hr (~$0.000525/GPU-s) — significantly cheaper than Modal H100.

**Deployment format**: `fal-serverless` Python decorators (`@fal.function`). Custom endpoints can run any Python container; pre-built optimized FLUX/SDXL paths exist.

**Cold start in 2026**:
- 5–10s for custom endpoints.
- Advertised "no cold starts" for hosted catalog (always-on warm pools).

**Strengths**:
- Genuinely the fastest for diffusion — custom kernels, optimized FLUX runtimes.
- Catalog covers nearly every released image/video model within days.

**Weaknesses**:
- Per-output pricing on hosted catalog is opaque vs raw GPU time; you pay for the "it just works" experience.
- Less general-purpose than Modal.

**Pick this if**: Diffusion is your product. You want FLUX/Wan/SDXL endpoints fast and don't want to compile TensorRT yourself.

---

## RunPod (Serverless + Pods + Hub)

**Serverless pricing** (Flex / Active per second):
- B200: $0.00248 / $0.00211
- H100: $0.00116 / $0.00093
- A100: $0.00116 / $0.00093
- RTX 4090: $0.00031 / $0.00021
- L40S: ~$0.00060 / ~$0.00050

Active = always-on (~20% discount, no cold starts). Flex = scale-to-zero.

**Pods** (rented VMs):
- H100 80GB on Community Cloud ~$1.99/hr, Spot ~$1.25/hr, On-demand Secure ~$2.99/hr.
- RTX 4090 from $0.34/hr.

**Deployment format**: Docker container with RunPod handler:
```python
import runpod

def handler(event):
    prompt = event["input"]["prompt"]
    # ... run inference, upload to R2/S3, return URL
    return {"output_url": "..."}

runpod.serverless.start({"handler": handler})
```

**Cold start in 2026 (FlashBoot)**: 48% of cold starts under 200ms; large containers 6–12s.

**Storage**: **Network Volumes** (per-region, attach at `/runpod-volume/`). Standard pattern: cache HF weights at `/runpod-volume/huggingface-cache/hub/`. ~3min first download; ~20s warm restart.

**Strengths**:
- **Cheapest serverless H100 by far.**
- Zero idle cost.
- Network volumes solve weights-in-image.
- Pods give you a real Linux box for anything weird.

**Weaknesses**:
- Worker handler model is awkward vs Modal decorators.
- H100 capacity sometimes scarce.
- Logs/observability are basic.

**Pick this if**: Scaling and the bill matters. Or you want the same provider for both serverless and rented Pods.

---

## Beam.cloud

- Per-second billing, **2–3s cold starts** (warm <100ms), no cold-start charges.
- Free tier 10 GPU-hours.
- Python SDK, hot-reload local dev.
- Open-source companion runtime `beta9`.

**Pick this if**: Latency matters, want Modal-style DX without lock-in. Good for AI agents.

---

## Baseten

- **Per-minute billing.** T4 $0.63/hr, A10G $1.21/hr, A100 80GB $4.00/hr, H100 $6.50/hr, B200 $9.98/hr — **clearly the most expensive of this group.**
- Truss format (`config.yaml` + `model.py`).
- Heavy investment in TensorRT-LLM compilation, custom inference runtime.
- `min_replicas` to eliminate cold starts (and pay continuously).

**Pick this if**: Enterprise, throughput-optimized LLM inference, have the budget. For pure media-gen, you're paying ~2× Modal for not much.

---

## Together AI / Fireworks

- Strong on LLM endpoints; image/audio limited.
- Together hosts FLUX (schnell free for promo, dev/pro/Kontext available) and SDXL.
- Fireworks: ~5 image models + Whisper V3.

**Pick this if**: Already using for LLMs and want one bill. **Don't pick as primary diffusion platform.**

---

## Banana.dev — DEAD

- Sunset **March 31, 2024**.
- Founder cited GPU shortage economics + scale-to-zero unit-cost crisis.
- **Don't ship code targeting Banana.** Some old tutorials still reference it.

## Mystic AI — DEAD / pivoted

- No meaningful 2026 footprint. Treat as gone.

## Lightning AI Studios

- Studios are interactive dev environments, not a serverless inference target.
- Free tier (15 credits, 4-hr restarts). Pro $50/mo (annual). T4 $0.68/hr, L4 $0.70/hr, A10G $1.80/hr; Teams plan unlocks A100/H100/H200.

**Pick this if**: Want a notebook-style "Studio" for prototyping diffusion training. **Not for production serving.**

---

## Decision Matrix

| Profile | Pick |
|---|---|
| Solo dev, low traffic, simple SaaS | **Replicate** for hosted FLUX, **R2** for storage, Inngest for orchestration |
| Scaling past $10K/mo on Replicate | Move hot models to **Modal** or **RunPod Serverless**; keep Replicate for tail |
| Custom ComfyUI workflows | **ComfyDeploy** if managed; **RunPod with `worker-comfyui`** if control |
| $0 idle cost is non-negotiable | **RunPod Flex** or **Beam** |
| Predictable <1s latency | **Modal Active** with GPU snapshots, **RunPod Active workers**, or **fal hosted** |
| Fine-tune + serve custom model | **Modal** (`.train()` then `@app.function`) or **Replicate Deployments** |
| Pure batch, one-off | **Modal `.map()`**. Nothing else is close. |
| Diffusion, want it to "just work fast" | **fal.ai** |
| Already on Cloudflare ecosystem | **Workers AI** for what fits, **CF Containers + R2 + Queues** orchestrating Modal/RunPod for the rest |
| Enterprise, throughput-optimized LLM serving | **Baseten** (worth the price for TRT-LLM compilation) |

For Cloudflare-specific stack details, see `cloudflare-stack.md`. For self-hosted patterns (Vast, Lambda, CoreWeave), see `self-hosted.md`. For deployment-format detail (Cog vs Truss vs Modal), see `deployment-formats.md`.
