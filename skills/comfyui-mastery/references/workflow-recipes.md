# Workflow Recipes (May 2026)

Eight reference workflows. Each lists the node sequence, the gotchas, and the parameters that actually matter. The official **Workflow → Browse Templates** browser has many of these as one-click loads — check there first.

For an actual API-format JSON example, see `workflows/flux_dev_teacache.json`. For Wan 2.2 I2V, see `workflows/wan22_i2v_skeleton.md`.

---

## Recipe 1: Flux dev txt2img with TeaCache (8–16GB cards)

**Goal**: 1024×1024 photo-quality image, fast iteration, fits on a 12GB 4070.

```
UnetLoaderGGUF(flux1-dev-Q4_K_M.gguf)
    ↓
ApplyTeaCache(threshold=0.4)
    ↓
DualCLIPLoaderGGUF(t5xxl-Q4_K_M.gguf, clip_l.safetensors, type="flux")
    ↓
CLIPTextEncode(positive_prompt)
EmptyLatentImage(1024, 1024, batch=1)
KSamplerSelect(euler) + BasicScheduler(simple, steps=20)
SamplerCustomAdvanced(denoise=1.0)
FluxGuidance(3.5)
    ↓
VAELoader(ae.safetensors) → VAEDecode → SaveImage
```

**Gotchas**:
- T5 FP16 OOMs on 12GB. Always use Q4_K_M GGUF or fp8 e4m3fn.
- `denoise=1.0` for fresh latent. Lower (0.3–0.55) only on a refine pass.
- `FluxGuidance=3.5` is the sweet spot. 1.0 → muted; 7.0 → over-saturated.

---

## Recipe 2: Flux Kontext image edit

**Goal**: instruction-conditioned image edit ("change the sweater to red").

```
UnetLoaderGGUF(flux1-kontext-dev-Q4_K_M.gguf)
DualCLIPLoaderGGUF(t5, clip_l, type="flux")
LoadImage(source.png) → VAEEncode → ReferenceLatent
CLIPTextEncode("change the sweater to red")
KSamplerSelect(euler) + BasicScheduler(simple, steps=20)
FluxGuidance(2.5)  ← lower than dev
SamplerCustomAdvanced(denoise=1.0)
VAEDecode → SaveImage
```

**Gotchas**:
- Phrase prompt as an **instruction**, not a description.
- Guidance **2.5** (not 3.5) — Kontext is tuned lower.
- Source image quality matters. Don't feed it 512² when you want 1024² output.

---

## Recipe 3: SDXL + IPAdapter style transfer

**Goal**: generate an image in the style of a reference photo.

```
CheckpointLoaderSimple(juggernautXL_v9.safetensors)
    ↓
IPAdapterUnifiedLoader(preset="PLUS")
LoadImage(style_reference.png)
IPAdapter Style/Composition(weight=0.7, weight_type="style transfer")
    ↓
CLIPTextEncode(positive)
CLIPTextEncode(negative)
EmptyLatentImage(1024, 1024)
KSampler(dpmpp_2m, karras, steps=25, cfg=6, denoise=1.0)
VAEDecode → SaveImage
   ↓
[optional] FaceDetailer(threshold=0.5, dilation=10) → SaveImage
```

**Gotchas**:
- Style weight 0.7 is the starting point. 1.0 = too literal copy. 0.4 = subtle hint.
- IPAdapter "Plus" tends to copy composition; "Plus-Face" is portrait-oriented; "Composition" is layout-only.
- For Flux, use **Flux Redux** (native) instead — IPAdapter Plus development on Flux has slowed.

---

## Recipe 4: Wan 2.2 14B I2V (24GB GPU)

**Goal**: animate a still image into 5–6 seconds of 720p video.

Use the native template: **Workflow → Browse Templates → Video → Wan2.2 14B I2V**.

Node sequence:
```
LoadCheckpoint(wan2.2-i2v-14b)  [or UnetLoaderGGUF for Q4]
LoadCLIP(t5_xxl_umt5)           [Wan uses T5 + UMT5]
LoadVAE(wan2.2_i2v_vae)
LoadImage(start_frame.png)
CLIPTextEncode(positive_motion_prompt)
WanI2VConditioning(start_frame, prompt)
WanVideoSampler(steps=20, cfg=5.0, fps=24, frames=81)
VAEDecode (Wan video VAE)
VHS_VideoCombine(frame_rate=24, format="video/h264-mp4")
```

**Gotchas**:
- 81 frames @ 24fps = 3.4s. Bump to 121 for ~5s if VRAM allows.
- `FlowMatch` is the right scheduler for Wan; the native template handles this.
- I2V quality is sensitive to start-frame resolution. Match it to the output resolution.
- For 8GB cards: switch to `wan2.2-ti2v-5b` with offloading.

---

## Recipe 5: Hunyuan Video T2V

**Goal**: 5s 544×960 video from a text prompt only.

Use the native template: **Workflow → Browse Templates → Video → HunyuanVideo**.

```
LoadCheckpoint(hunyuan_video_dit_fp8_e4m3fn)  [or GGUF Q4 for 16GB]
LoadCLIP(llama-3.1-8B-textencoder, hunyuan_clip_l)
LoadVAE(hunyuan_video_vae)
CLIPTextEncode(positive)
EmptyHunyuanLatent(544, 960, frames=49)
HunyuanSampler(steps=30, cfg=6, scheduler="flowmatch")
VAEDecode → VHS_VideoCombine
```

**Gotchas**:
- 49 frames @ 24fps default. Bump to 121 with VRAM headroom.
- Hunyuan-1.5 (8.3B) variant cuts requirements: **6GB VRAM in low-VRAM forks, ~75s per 5s clip on a 4090**.
- For bleeding-edge features, use Kijai's `ComfyUI-HunyuanVideoWrapper`.

---

## Recipe 6: LTX Video fast preview

**Goal**: iterate on motion ideas in 30-60s per 5s clip.

```
LoadCheckpoint(ltx-video-2b-distilled)  [or LTX-2 / 2.3 if you want audio]
LoadCLIP(t5_xxl)
LoadVAE(ltx_vae)
CLIPTextEncode(positive)
LTXEmptyLatent(720, 1280, frames=121)
KSampler(euler, simple, steps=5-8, cfg=3.0)
VAEDecode → VHS_VideoCombine(fps=24)
```

**Gotchas**:
- 5-8 steps. More just slows it down without much quality gain on the distilled variant.
- LTX-2.3 (current) supports native synchronized audio via `LTXAudioConditioning`.
- Use as the **iteration model**: generate 20 candidates with LTX, re-render the winner with Wan 2.2 for production quality.

---

## Recipe 7: Upscale Chain (Ultimate SD Upscale)

**Goal**: take a 1024² image to 4096² with detail enhancement.

```
LoadImage(source.png)
UpscaleModelLoader(4x-UltraSharp.pth)
ImageUpscaleWithModel  [model-based 4x first pass]
    ↓
[For SD1.5/SDXL refinement:]
CheckpointLoaderSimple(sdxl_base or juggernautXL)
    ↓
UltimateSDUpscale(
    upscale_by=4.0,
    seed=42,
    steps=20,
    cfg=6,
    sampler=dpmpp_2m,
    scheduler=karras,
    denoise=0.25,
    mode_type="Linear",
    tile_width=1024,
    tile_height=1024,
    mask_blur=8,
    seam_fix_mode="Half Tile",
    seam_fix_denoise=0.25,
    seam_fix_padding=16
)
    ↓
SaveImage
```

**For Flux**: replace the SD checkpoint + ControlNet Tile with Flux dev + Flux ControlNet Union Pro tile.

**Gotchas**:
- `denoise=0.25` is the typical refine value. Higher → more detail change, more chance of artifacts.
- Tile 1024×1024 is the sweet spot for 24GB; use 768 for 12GB.
- `seam_fix_mode="Half Tile"` cleans tile boundaries.

---

## Recipe 8: Faceswap pipeline (high quality)

**Goal**: reliable face replacement on portraits.

For SDXL:
```
LoadImage(source.png)
LoadImage(reference_face.png)
    ↓
IPAdapterFaceID(face_image=reference, weight=0.8)
    ↓
CheckpointLoaderSimple(juggernautXL)
KSampler(dpmpp_2m, karras, 25 steps, cfg=6)
    ↓
FaceDetailer(
    bbox_detector=face_yolov8m,
    sam_model=sam_vit_b,
    feather=10,
    denoise=0.35
)  [with InstantID conditioning]
    ↓
[optional] ReActorFaceSwap(source=output, reference=reference, model=inswapper_128)
    ↓
SaveImage
```

For Flux:
```
LoadCheckpoint(flux1-dev or Nunchaku)
PuLID-Flux(reference_face, weight=0.8)
KSampler with Flux defaults
FaceDetailer with Flux-aware refiner
SaveImage
```

**Gotchas**:
- `IPAdapter FaceID + InstantID + FaceDetailer` is the gold-standard SDXL stack.
- `ReActor` is post-process face swap; very high fidelity but can look uncanny without color matching. Use as a final pass, not primary.
- For Flux: PuLID-Flux + Flux Redux + Flux-aware FaceDetailer is the equivalent.
- Always run the **detailer at the end** to clean up small face inconsistencies.

---

## Workflow JSON Files in this skill

- `workflows/flux_dev_teacache.json` — minimal API-format JSON for Recipe 1.
- `workflows/wan22_i2v_skeleton.md` — Wan 2.2 I2V parameter reference (loaded via Browse Templates → Video).

For productionizing any of these as an HTTP/queue API, see the `media-gen-deployment` skill.
