# Models and Quantization (May 2026)

What runs in ComfyUI today, what files you need, and how to fit big models on small GPUs.

---

## Flux Family

### FLUX.1 dev
- 12B DiT, **non-commercial** license (BFL).
- Quality king for general-purpose open-weight image gen.
- Files:
  - `flux1-dev.safetensors` → `models/diffusion_models/`
  - `t5xxl_fp16.safetensors` (9.5GB) or `t5xxl_fp8_e4m3fn.safetensors` (4.7GB) → `models/clip/`
  - `clip_l.safetensors` → `models/clip/`
  - `ae.safetensors` (the VAE) → `models/vae/`
- Loader chain: `UNETLoader` → `DualCLIPLoader` (type `flux`) → KSampler → `VAEDecode`.
- Guidance via `FluxGuidance` node, default 3.5.
- Recommended sampler: `euler` + `simple` or `beta`, 20 steps.

### FLUX.1 schnell
- 4-step distilled, **Apache 2.0**.
- Use `euler` + `simple`, 4 steps, guidance 1.0.
- ~10× faster than dev.

### FLUX.1 Kontext dev
- Image-edit / instruction-conditioned. Open-weight parity with closed image-editing APIs.
- Uses `ReferenceLatent` + image conditioning path.
- GGUF available: `bullerwins/FLUX.1-Kontext-dev-GGUF`, `QuantStack/FLUX.1-Kontext-dev-GGUF`. Q4_K_M sweet spot for 12GB.
- Sampler: `euler` + `simple`, 20 steps, **guidance 2.5** (lower than dev), instruction-style prompt ("change the sweater to red").

### FLUX.1.1 Pro
- Closed, BFL API only. Access via `comfyui-replicate` node or BFL API node. **No local weights.**

### FLUX.1 Krea dev
- BFL × Krea collaboration. Tuned for natural / non-"AI-look" photographic output.
- Same loader path as Flux dev, different weights.

### FLUX 2
- Late 2025/early 2026. Day-zero ComfyUI support.

---

## SDXL / SD3.5

### SDXL
Still alive as the workhorse for fine-tuned style models: Juggernaut XL, RealVisXL, Pony, Illustrious. Sampler: `dpmpp_2m` + `karras`, 25 steps, CFG 6.

### SD3.5 Large / Medium
- Triple text encoder requirement: `clip_l.safetensors` + `clip_g.safetensors` + `t5xxl_fp16.safetensors`, loaded via `TripleCLIPLoader`.
- Large: competitive with Flux dev on prompt adherence; loses on photorealism.
- Medium: fast and decent on 12GB.
- Stability's licensing cleanup made commercial use viable for both.

---

## 2025–2026 Image Alternatives Worth Knowing

### HiDream-I1 (Full / Dev / Fast)
Native ComfyUI support via `comfyanonymous/ComfyUI_examples/hidream/`. Full needs ~20GB VRAM; **Dev is the practical choice** and is genuinely competitive with Flux on certain prompt categories.

### Lumina-Image-2.0 (Alpha-VLLM)
Native support. Lighter than Flux, MIT-licensed, good at compositional prompts.

### Sana (NVIDIA)
4K-capable, very fast. Native. The speed king for high-res when you don't need Flux fidelity.

### OmniGen 2
Unified gen + edit + IP. Native. Worth knowing for unified pipelines.

### AuraFlow / Pixart-Sigma
Still natively supported but largely superseded by Flux-family for new work.

---

## Video Models

### Wan 2.2 (Alibaba, Apache 2.0)
**Current open-weights video king.** Three variants:
- **5B (TI2V-5B)** — 8GB-friendly with offloading, can be coaxed into 8GB with optimization, comfortable on 24GB.
- **14B T2V-A14B** — needs 24GB minimum with FP8 + offloading, or 80GB for headroom.
- **14B I2V-A14B** — same as T2V; 720p I2V, broadcast-quality output.

MoE architecture, strong motion coherence. Native ComfyUI templates: **Workflow → Browse Templates → Video → Wan2.2 14B I2V**.

| GPU | Recommended Wan 2.2 path |
|---|---|
| 8GB | 5B with native offload + GGUF Q4 |
| 12-16GB | 14B GGUF Q4 |
| 24GB+ | 14B native FP8 |
| Apple Silicon | 5B via Wan2GP (deepbeepmeep) |

### HunyuanVideo / HunyuanVideo-1.5 (Tencent)
- **HunyuanVideo (13B)**: SOTA quality; **60GB+ VRAM** at 720p. Server-side only.
- **HunyuanVideo-1.5 (Nov 2025, 8.3B)**: **5s clips in ~75s on a single 4090.** Low-VRAM forks down to **6GB**. The "consumer hardware can finally do real video" moment.
- **HunyuanVideo-I2V**, **Hunyuan-Custom**: subject-conditioned variants with strong character consistency.
- **HunyuanVideo-Avatar / Hunyuan3D-2.0**: avatar-from-image, text-to-3D.
- Tooling: Kijai's `ComfyUI-HunyuanVideoWrapper` is the practical entry point.

### LTX Video (Lightricks)
- **The speed champion**. 2–8s clips in **<1 min on a 4090**.
- LTX 0.9.7 distilled is the practical choice.
- **LTX-2 / LTX-2.3** (current): native synchronized audio, T2V, I2V, audio-to-video at up to 1080p, native 9:16.
- **MLX ports** (`ltx-2-mlx`, `phosphene`, `ltx-video-mac`, `mlx-video`) — **the best open-weights video stack on M-series Macs in 2026**.
- Native ComfyUI support since v0.3+.

### Mochi 1 (Genmo)
10B DiT, Apache 2.0, **480p ceiling**. Largely surpassed by Wan 2.2 for new work but still in plenty of pipelines. Native support.

### CogVideoX-5B / CogVideoX1.5
Best open I2V quality through early 2026. 24GB cards comfortable. Native + `ComfyUI-CogVideoXWrapper`.

### AnimateDiff
Still relevant for **SD1.5/SDXL stylized animation** + ControlNet. Not for new T2V/I2V projects.

---

## Audio Models in ComfyUI

### Stable Audio Open
Native template. Short SFX / loops. ~47s output, 12GB VRAM. CC-licensed training data. Stability Community License (commercial OK <$1M ARR).

### ACE-Step v1.5 / XL (Apache-2.0)
**The standout open music model in 2026.** Native template at Workflow → Browse Templates → Audio → ACE-Step. On-device, 30s+ tracks from text. Mac/AMD/Intel/CUDA. See the `generative-music-audio` skill.

### F5-TTS (MIT)
Via `niknah/ComfyUI-F5-TTS` or the unified `diodiogod/TTS-Audio-Suite`. Zero-shot voice cloning. 7× realtime (33× Fast variant).

### TTS-Audio-Suite
Unifies F5-TTS, Chatterbox, Higgs Audio 2, Step Audio EditX, IndexTTS-2, Cozy Voice 3, RVC. **Install if you do any TTS in ComfyUI.**

---

## Quantization & Acceleration

### GGUF (city96)
DiT models tolerate quantization much better than UNet-style. K-quants:
- **Q4_K_M** — visually near-lossless to most observers
- **Q5_K_M** — slightly safer
- **Q6_K / Q8_0** — minimal quality loss, larger files
- Q4_K_S / Q4_0 — for very tight VRAM
- Q2_K — emergency only

Drop file in `models/unet/`, replace `UNETLoader` with `UnetLoaderGGUF`. For text encoders, `models/clip/` and `DualCLIPLoaderGGUF`.

### TeaCache (`welltop-cn/ComfyUI-TeaCache`)
Timestep-embedding-aware caching that skips redundant DiT steps. **~1.5–2× speedup** on Flux/Wan/Hunyuan with minimal quality loss. Tunable threshold (0.4 default).

### FBCache / First-Block-Cache
Caches the output of the first DiT block when input change between steps is below a threshold. Often stacks with TeaCache.

### Nunchaku / SVDQuant
**The single highest-impact perf install for Flux on consumer GPUs.** ICLR 2025 spotlight. INT4 W4A4 with low-rank outlier absorption.
- ~3× faster than NF4 W4A16
- ~3.6× model-size reduction
- Multi-LoRA, ControlNet, FP16 attention, 20-series GPUs supported (v1.0+)

### Sage Attention / Flash Attention 3
Launch with `--use-sage-attention` (RTX 30/40/50). ~1.3–1.7× over xFormers/SDPA in DiT attention.

### Stacking
TeaCache + Nunchaku + SageAttention compose. Real-world Flux dev on a 4090: ~1s/image at 20 steps with all three enabled.

---

## Conditioning Models

### ControlNet
For Flux: `Shakker-Labs/FLUX.1-dev-ControlNet-Union-Pro` + `XLabs-AI/flux-controlnet-collections`. Apply via `ControlNetApplyAdvanced` against positive conditioning.

### IPAdapter
- SD1.5/SDXL: `cubiq/ComfyUI_IPAdapter_plus`. Plus / Plus-Face / FaceID / FaceID-Portrait / Composition.
- **Flux: native Flux Redux** (Black Forest Labs) is now the go-to.

### InstantID
SDXL identity-preserving face transfer. Highest fidelity, most resource-hungry. Requires InsightFace + InstantID checkpoint.

### PuLID-Flux
Flux portrait identity preservation. Lighter than InstantID.

### ReActor
Direct face-swap (post-process, not generation-time conditioning). Built on InsightFace. Censored/uncensored fork drama 2024–25; current upstream ships with NSFW filter.

---

## Quick Reference — File Layout

```
ComfyUI/
├── models/
│   ├── checkpoints/        # SD1.5/SDXL/SD3 single-file ckpts
│   ├── diffusion_models/   # Flux dev/schnell/Krea/Kontext
│   ├── unet/               # GGUF UNet variants
│   ├── clip/               # T5, CLIP-L, CLIP-G (incl. GGUF)
│   ├── vae/                # ae.safetensors, sdxl_vae, etc.
│   ├── controlnet/
│   ├── ipadapter/
│   ├── loras/
│   ├── upscale_models/
│   └── embeddings/
├── custom_nodes/           # one folder per pack
├── workflows/              # your saved workflow JSONs
├── output/                 # generated files
└── snapshots/              # manager-snapshot.json files
```

For the recipes that combine all this into actual workflows, see `workflow-recipes.md`.
