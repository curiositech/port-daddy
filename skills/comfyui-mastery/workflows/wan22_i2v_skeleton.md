# Wan 2.2 14B I2V — Workflow Skeleton

The official template ships in **ComfyUI → Workflow → Browse Templates → Video → Wan2.2 14B I2V**. Load it from there rather than crafting by hand — the model loaders + sampler chain are tuned and update with new ComfyUI releases.

This file documents the parameters you'll tune.

---

## Required files

| Path | Files |
|---|---|
| `models/diffusion_models/` | `wan2.2-i2v-14b.safetensors` (FP16, ~32GB) **or** `wan2.2-i2v-14b-Q4_K_M.gguf` (Q4, ~8GB) |
| `models/clip/` | `umt5_xxl_fp16.safetensors` (or fp8/Q5 variant) |
| `models/vae/` | `wan2_2_vae.safetensors` |

For 8GB cards: switch the diffusion model to **`wan2.2-ti2v-5b.safetensors`** with offloading enabled.

---

## Node sequence (high level)

```
LoadCheckpoint / UnetLoaderGGUF (Wan 2.2 I2V)
    ↓
LoadCLIP (UMT5)         LoadVAE (Wan VAE)
    ↓                       ↓
CLIPTextEncode (positive motion prompt)
LoadImage (start_frame.png)
    ↓
WanImageToVideo / WanI2VConditioning(start_frame, prompt)
    ↓
WanVideoSampler  ← see params below
    ↓
VAEDecode (Wan video VAE)
    ↓
VHS_VideoCombine(frame_rate=24, format="video/h264-mp4")
```

---

## WanVideoSampler tuned defaults

| Parameter | Value | Notes |
|---|---|---|
| `steps` | 20 | 30 for hero shots, 15 for previews |
| `cfg` | 5.0 | Range 4–6; higher = more prompt adherence, less smooth motion |
| `frames` | 81 | 81 frames @ 24fps = 3.4s. Bump to 121 for ~5s |
| `fps` | 24 | Standard |
| `width` × `height` | 1280 × 720 | 720p I2V |
| `scheduler` | flowmatch | Wan is trained for flow matching |
| `seed` | (your choice) | Pin for reproducibility |
| `flow_shift` | 5.0 | Wan-specific; default works |

---

## Memory profile (rough)

| GPU | Wan 2.2 path | Frames | Time per clip |
|---|---|---|---|
| 8GB | TI2V-5B + offload | 81 | 8–15 min |
| 12-16GB | I2V-14B GGUF Q4 | 81 | 5–10 min |
| 24GB | I2V-14B FP8 | 81 | 3–6 min |
| 80GB H100 | I2V-14B FP16 | 121 | 2–3 min |
| Apple M3 Max (64GB unified) | TI2V-5B via Wan2GP | 81 | 8–12 min |
| Apple M4 Max (128GB unified) | I2V-14B GGUF Q4 (slow) | 81 | 15–20 min |

For Apple Silicon, **LTX-2.3 via MLX** is faster and shipped as a first-class target.

---

## Prompting Wan 2.2 I2V

Wan responds well to **explicit motion descriptions**. The start frame anchors composition; the prompt drives motion.

✅ Good:
```
The woman in the photo turns her head slowly to the left, looking out the window.
Soft camera push-in. Hair sways gently in the breeze.
Cinematic, golden hour lighting, shallow depth of field.
```

❌ Bad:
```
woman moves
```

Specify:
- **Subject motion** (turns, walks, blinks, smiles)
- **Camera motion** (push-in, pan left, dolly out, hold)
- **Speed** (slowly, suddenly, gently)
- **Lighting consistency** (match the start frame)

---

## Common gotchas

- **Start frame resolution mismatch**: if your input is 512×512 and you ask for 1280×720 output, you'll get artifacts. Match resolutions, or upscale the start frame before I2V.
- **Wrong VAE**: Wan 2.2 uses its own VAE. Don't substitute Flux's `ae.safetensors`.
- **Audio**: Wan 2.2 doesn't generate audio. Add it post via ElevenLabs / Suno / ACE-Step (see `generative-music-audio` skill) and combine via FFmpeg.
- **Bleeding-edge features**: if a feature isn't in the native template yet, switch to `kijai/ComfyUI-WanVideoWrapper`. Migrate to native when it lands.

---

## Scaling to production

Once you have a working API-format JSON for this workflow:

1. POST to `/prompt` (see `../references/architecture.md`).
2. Subscribe to `/ws` for progress events.
3. Fetch the result via `/view?filename=...&type=output`.
4. For RunPod / Modal / fal deployment patterns: see the `media-gen-deployment` skill.
5. For multi-shot stitching with character consistency: see the `generative-video-2026` skill (Veo 3.1 Ingredients vs Runway References vs IP-Adapter keyframe pipelines).
