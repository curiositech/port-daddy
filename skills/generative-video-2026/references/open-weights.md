# Open-Weights Video Models (May 2026)

For local generation on consumer hardware (4090, M-series Mac, rented H100). VRAM tables, license caveats, ComfyUI paths.

For deeper ComfyUI integration (Kijai wrappers, samplers, FP8/GGUF), see the `comfyui-mastery` skill.

---

## Wan 2.2 family (Alibaba) — the open-weights video king

- **Variants**: Wan 2.2 T2V-A14B, I2V-A14B, **TI2V-5B** (unified text+image at 5B params).
- **License**: Apache 2.0 (verified at release). **Re-verify per release** — derivatives sometimes have NC riders.
- **VRAM**:
  - 14B: **24 GB minimum** (4090/5090) with offloading + FP8 + CPU offload. **80 GB (H100) for headroom.**
  - 5B (TI2V-5B): **fits cleanly in 24 GB**, can be coaxed into **8 GB** with optimization.
- **Output**: 720p @ 24 fps, T2V + I2V.
- **Speed on 4090 with FP8**: 5B → 5s @ 720p in ~30–60s. 14B → several minutes per clip.
- **Apple Silicon**: Via **Wan2GP** (deepbeepmeep) and ComfyUI MPS backends. M3 Max ~5–10× slower than 4090; M4 Max closes some.
- **How to run**:
  - **Native ComfyUI templates** (Workflow → Browse Templates → Video → Wan 2.2 14B I2V).
  - **Kijai's `ComfyUI-WanVideoWrapper`** for bleeding-edge features.
- **Replicate**: Wan 2.6 / 2.7 hosted at ~**$0.07/s**.

| GPU | Wan 2.2 path | 81-frame clip time |
|---|---|---|
| 8 GB | TI2V-5B + offload | 8–15 min |
| 12-16 GB | I2V-14B GGUF Q4 | 5–10 min |
| 24 GB | I2V-14B FP8 | 3–6 min |
| 80 GB H100 | I2V-14B FP16 | 2–3 min |
| M3 Max 64GB | TI2V-5B via Wan2GP | 8–12 min |
| M4 Max 128GB | I2V-14B GGUF Q4 (slow) | 15–20 min |

---

## HunyuanVideo & HunyuanVideo-1.5 (Tencent)

- **HunyuanVideo (13B)**: SOTA quality. **60 GB VRAM minimum, 80 GB recommended** at 720p. Realistically server-side.
- **HunyuanVideo-1.5** (Nov 2025, **8.3B**): **Polished 5s clips in ~75s on a single RTX 4090.** Low-VRAM forks support **6 GB**. The "consumer hardware finally does real video" moment.
- **HunyuanVideo-I2V** and **Hunyuan-Custom**: subject-conditioned, strong character consistency for an open model.
- **HuanyuanVideo-Avatar / Hunyuan3D-2.0**: avatar-from-image talking and text-to-3D.
- **Tooling**: Kijai's **ComfyUI-HunyuanVideoWrapper** — supports FP8/GGUF, block swapping, attention caching, torch.compile, LoRA management.

---

## LTX-Video — the speed champion + Apple Silicon answer

- **Versions**: LTX 0.9.5 / 0.9.6 / 0.9.7 / **LTX-2 / LTX-2.3 (current)**.
- **LTX 0.9.7**: First DiT-based video model capable of **real-time** 30 fps @ 1216×704 on suitable GPUs. **TeaCache** training-free caching gives ~2× more.
- **LTX-2 / LTX-2.3** (current 2026): First-class **synchronized audio**, T2V + I2V + audio-to-video at up to **1080p**, native 9:16.
- **Apple Silicon**: **Native MLX ports exist and actually work** — `ltx-2-mlx`, `phosphene`, `ltx-video-mac`. **MLX-Video** (Blaizzy) is the unifying package. **The single best open-weights stack on M-series Macs in 2026** because Lightricks shipped MLX as a first-class target rather than an afterthought.
- **Hardware**:
  - 4090: 5s clip in ~10–20s with TeaCache.
  - M4 Max: same ballpark.
  - M3 Max: ~2× slower than M4 Max.

**Use as the iteration model**: generate 20 candidates with LTX, re-render the winner with Wan 2.2 for production quality.

---

## Mochi 1 (Genmo)

- **10B-param diffusion transformer, Apache 2.0** (genuinely Apache).
- 5.4s / 162 frames @ 480p / 30 fps.
- Best raw open T2V quality below 720p.
- HD variant promised; image-to-video and improved control on roadmap.
- **Practical note**: 480p ceiling is the dealbreaker for most 2026 use cases. Use as a stylistic engine, not a hero generator.

---

## CogVideoX-5B / CogVideoX1.5

- Best open **I2V** quality by community consensus through early 2026.
- 5B and 1.5 (5B with stronger conditioning) variants.
- Runs on 24 GB cards comfortably.
- CogVideoX is now mostly used as a feature inside ComfyUI graphs rather than as a top-line model.

---

## Specialty Open: Avatar/Motion/Animation

### OmniHuman
Multimodal-conditioned human generation from a single image + (audio | video | both). **Strongest open option for "image of a person + audio → talking video"** in 2026. Apache-style license terms and weights have been a moving target — **check current status before commercial use.**

### MimicMotion (Tencent)
Confidence-aware pose-guided generation for human motion. Long-form via progressive latent fusion. ICML 2025.

### Champ
3D-parametric pose guidance for consistent character animation. Niche but excellent for non-human or stylized characters.

### AnimateDiff
**Still relevant in 2026** specifically as a controllability backbone in ComfyUI — paired with ControlNet, IP-Adapter, and LoRAs for keyframe-driven workflows. **Not a frontier model**, but a flexible component for SD1.5/SDXL stylized work. **Does not work with Flux/Wan/Hunyuan.**

---

## State of T2V on Consumer Hardware (May 2026)

| Hardware | Reality |
|---|---|
| **RTX 4090** (24 GB) | Real local T2V at 720p @ 5s in 30–90s. Wan 2.2 5B, Hunyuan-1.5, LTX-2.3 all comfortable. 14B with FP8 + offload possible but slow. |
| **RTX 5090** (32 GB) | Same as 4090 with headroom; FP8 14B becomes pleasant. |
| **M4 Max** (64–128 GB unified) | **LTX-2.3 via MLX recommended.** Wan 2.2 5B via Wan2GP works. Hunyuan-1.5 via ComfyUI MPS works but slower than 4090. |
| **M3 Max** | Same software stack, ~1.5–2× slower. |
| **8–12 GB cards** | Hunyuan-1.5 low-VRAM fork (6 GB min), Wan 2.2 5B with aggressive optimization. Slower but possible. |

---

## Setup — Wan 2.2 5B on a 4090 (recommended starting point)

1. Install ComfyUI (see `comfyui-mastery` skill for full setup).
2. Install Kijai's wrapper for cutting-edge features:
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/kijai/ComfyUI-WanVideoWrapper
cd ComfyUI-WanVideoWrapper
pip install -r requirements.txt
```
3. Download weights (use HF caching):
```bash
export HF_HOME=/path/to/shared/hf-cache
huggingface-cli download Wan-AI/Wan2.2-TI2V-5B
```
4. Load native template: **Workflow → Browse Templates → Video → Wan2.2 14B I2V** — switch the loader to TI2V-5B for the smaller variant.
5. Run.

---

## Setup — LTX-2.3 on M4 Max via MLX (best Mac stack)

```bash
# Install MLX-Video unifying package
uv pip install mlx-video

# Or one of the dedicated LTX-2 ports
git clone https://github.com/dgrauet/ltx-2-mlx
cd ltx-2-mlx
uv pip install -r requirements.txt

# Run inference
python infer.py --prompt "..." --duration 5 --output out.mp4
```

Expect ~10–20s for a 5s clip on M4 Max — competitive with a 4090.

---

## License Verification (Critical Per Release)

- **Mochi 1**: genuinely Apache 2.0.
- **Wan 2.2**: Apache 2.0 verified at release. Re-check per release.
- **HunyuanVideo / 1.5**: open weights, **review per release** for face-ID / commercial restrictions.
- **OmniHuman**: license has been a moving target.
- **LTX-Video**: Lightricks-permissive; verify before shipping commercial.
- **CogVideoX**: Apache; verify per release.

**Anti-pattern**: assuming "open weights = commercial OK." Read every model card.

---

## Bottom Line — Pick for Your Hardware

| Hardware | Quality leader | Speed leader | Versatility |
|---|---|---|---|
| 24GB GPU (4090) | Wan 2.2 14B FP8 | LTX-2.3 | Hunyuan-1.5 (best balance) |
| 12-16GB GPU | Wan 2.2 14B GGUF Q4 | LTX-2.3 distilled | Hunyuan-1.5 low-VRAM |
| 8GB GPU | Wan 2.2 TI2V-5B | LTX-2.3 distilled | Hunyuan-1.5 low-VRAM fork |
| Apple Silicon (M3/M4 Max) | LTX-2.3 via MLX | LTX-2.3 via MLX | Wan 2.2 5B via Wan2GP |
| H100 / 80GB | HunyuanVideo (full) | LTX-2.3 | Wan 2.2 14B FP16 |

For the hosted alternatives, see `hosted-models.md`. For deployment / cost economics, see the `media-gen-deployment` skill.
