# Custom Nodes 2026 — The Worth-It Catalog

ComfyUI has 1000s of custom-node packs. Most are noise. This is the curated list a 2026 expert actually installs, organized by tier.

**Install discipline**: each pack adds startup time, import-time risk, and supply-chain attack surface. **Start minimal, add on demand.** Pin commits in production. Keep ComfyUI-Manager at `security_level=normal` minimum.

---

## ComfyUI-Manager (the gateway)

`Comfy-Org/ComfyUI-Manager` v3.38+. **Do not run < v3.31** (CVE-2025-45076, RCE). Ships in ComfyUI Desktop by default.

### Security levels (`config.ini`)

- `strong` — curated default channel only. No git URL installs. No pip on networked instances. **Use on shared/networked boxes.**
- `normal` (recommended default) — default channel + Comfy Registry. pip on localhost only.
- `normal-` — adds custom channels but blocks remote-URL installs from network.
- `weak` — anything goes. **Only on a private machine.**

### Channel system

- **Channel (1day cache)** — default; fetches curated list daily from Comfy-Org.
- **Local** — only what's already on disk.
- **Channel (remote)** — live query.

The default channel is moderated; the registry at `registry.comfy.org` is the broader index. The registry now scans + bans malicious nodes and surfaces warnings — but that's not a guarantee. Review code before installing anything not in the curated default.

---

## Tier 1 — Install on Every Machine

These eight non-negotiables make ComfyUI productive.

### rgthree-comfy (`rgthree/rgthree-comfy`)
**The quality-of-life pack.** Power LoRA Loader (compact stacked LoRAs with strength sliders), **Context / Context Switch** (carry MODEL+CLIP+VAE+positive+negative through one wire — eliminates spaghetti), Fast Bypasser, Fast Muter, **Seed** (with -1 random, -2 increment, -3 decrement), link-rendering improvements that make complex graphs readable.

### ComfyUI-KJNodes (`kijai/ComfyUI-KJNodes`)
Mask manipulation, image transforms, **Set/Get** nodes (variable-style routing — subgraph-aware as of late 2025), ColorMatch, resize/crop, VRAM Debug. Kijai writes most of the bleeding-edge model wrappers, so this is a hard dep for many of them.

### ComfyUI-Impact-Pack (`ltdrdata/ComfyUI-Impact-Pack`)
**FaceDetailer**, SAMDetector, UltralyticsDetectorProvider, regional sampling, ImpactWildcardEncode. The detailer pipeline is the standard for face/hand fixing.

### ComfyUI-Inspire-Pack (`ltdrdata/ComfyUI-Inspire-Pack`)
LoRA Block Weight, **A1111-style prompt parsing**, regional prompts, backend cache nodes, Global Seed. Same author as Impact Pack, spun out so Impact didn't grow to infinity.

### ComfyUI_essentials (`cubiq/ComfyUI_essentials`)
Image utilities that should ship in core (resize-and-pad, **FluxResolutions**, ImageBatch ops). **Note**: maintenance-only as of April 2025; still works fine. Many workflows depend on it.

### comfyui_controlnet_aux (`Fannovel16/comfyui_controlnet_aux`)
All ControlNet preprocessors: DWPose, Depth-Anything-V2, Canny, Lineart, Anyline, MiDaS, OpenPose, Tile, plus Flux-compatible preprocessors. Required for any ControlNet workflow.

### ComfyUI-VideoHelperSuite (`Kosinkadink/ComfyUI-VideoHelperSuite`)
**VHS_LoadVideo, VHS_VideoCombine**, batch-to-video, video-to-batch. Required for any video workflow.

### ComfyUI-Crystools (`crystian/ComfyUI-Crystools`)
Live VRAM/RAM/GPU monitor in the menu bar, image metadata viewer, JSON compare. Cheap, harmless, indispensable for debugging OOMs.

---

## Tier 2 — Install When You Need Them

### ComfyUI-GGUF (`city96/ComfyUI-GGUF`)
**The reason Flux runs on 8GB cards.** UnetLoaderGGUF + DualCLIPLoaderGGUF; supports Q2_K through Q8_0. **Q4_K_M / Q5_K_M are the sweet spot.**

### ComfyUI-nunchaku (`nunchaku-ai/ComfyUI-nunchaku`)
**SVDQuant 4-bit Flux.** ICLR 2025 spotlight. ~3× faster than NF4 on a 4090, drops Flux's minimum to ~4GiB VRAM. v1.0+ supports multi-LoRA, ControlNet, FP16 attention, 20-series GPUs. **The single highest-impact perf install for Flux on consumer GPUs.**

### ComfyUI_IPAdapter_plus (`cubiq/ComfyUI_IPAdapter_plus`)
Reference-image conditioning for SD1.5/SDXL. Plus / Plus-Face / FaceID / FaceID-Portrait / Composition variants. Maintenance has slowed; for **Flux specifically use Flux Redux** (native) instead.

### ComfyUI_InstantID (`cubiq/ComfyUI_InstantID`) and PuLID-Flux wrappers
**InstantID** for SDXL portrait identity preservation (highest fidelity, most resource-hungry). **PuLID-Flux** (`balazik/ComfyUI-PuLID-Flux-Enhanced` and Kijai's port) for Flux portraits — lighter, often the practical choice.

Per the 2026 community consensus: for a single portrait, similarity ranking is **InstantID > FaceID > PuLID**, but **PuLID gives the best prompt-fit**. Stack of choice for SDXL high-quality face: `FaceDetailer + InstantID + IPAdapter`. For Flux: `PuLID-Flux + Flux Redux + Flux-aware FaceDetailer`.

### ComfyUI-AnimateDiff-Evolved (`Kosinkadink/ComfyUI-AnimateDiff-Evolved`)
Still relevant for **SD1.5/SDXL only** (motion modules + AnimateLCM). For Flux/Wan/Hunyuan you don't need it.

### ComfyUI-Florence2 (`kijai/ComfyUI-Florence2`)
Microsoft Florence-2 captioning, grounding, OCR. Default for "describe this image" / "give me a Flux prompt from this image" pipelines.

### ComfyUI-AdvancedLivePortrait (`PowerHouseMan/ComfyUI-AdvancedLivePortrait`)
LivePortrait for facial expression transfer / animation — useful for v2v style work.

### ComfyUI-BrushNet (`nullquant/ComfyUI-BrushNet`)
Quality inpainting beyond vanilla SD inpaint (BrushNet/PowerPaint/HiDiffusion). **SD1.5/SDXL only**; for Flux use native Flux Fill.

### ComfyUI-LayerStyle (`chflame163/ComfyUI-LayerStyle`)
Photoshop-style layer effects (drop shadow, glow, bevel) + compositing nodes — useful for product/marketing image pipelines.

### ComfyUI_UltimateSDUpscale (`ssitu/ComfyUI_UltimateSDUpscale`)
Tile-based upscale with seam fixing. The reference high-res-fix path.

### was-node-suite-comfyui (`WASasquatch/was-node-suite-comfyui`)
200+ nodes. Honest take: most value absorbed into Essentials/KJNodes/Inspire. **Install only if a workflow you're loading needs it.** Bloated startup time.

### ComfyUI-Mixlab-Nodes (`shadowcz007/comfyui-mixlab-nodes`)
3D / screen-share / app-builder nodes. Niche; install only for its LCM real-time canvas or 3D viewport.

---

## Tier 3 — Kijai's Wrappers (the bleeding edge)

[Kijai](https://github.com/kijai) ships early-access wrappers for new video / model architectures before native support lands. Use when the native path doesn't exist yet, **migrate when it does** — Kijai himself says these are for "early access and testing of features that are difficult to implement natively."

- **ComfyUI-WanVideoWrapper** — Wan 2.2 (T2V, I2V) before native ships features
- **ComfyUI-HunyuanVideoWrapper** — HunyuanVideo / Hunyuan-1.5
- **ComfyUI-MochiWrapper** — Mochi 1
- **ComfyUI-CogVideoXWrapper** — CogVideoX 5B/1.5
- **ComfyUI-LTXVideo** (Kijai variant; native LTX support exists too)
- **ComfyUI-FluxTrainer** — Flux LoRA training in ComfyUI

Pattern: install wrapper → workflow works → wait for native support → migrate to native nodes for stability + ecosystem compatibility.

---

## TTS / Audio Custom Nodes

- **TTS-Audio-Suite** (`diodiogod/TTS-Audio-Suite`) — unifies F5-TTS, Chatterbox, Higgs Audio 2, Step Audio EditX, IndexTTS-2, Cozy Voice 3, RVC. **Install this if you do any TTS in ComfyUI.**
- **ComfyUI-F5-TTS** (`niknah/ComfyUI-F5-TTS`) — standalone F5-TTS wrapper.

For ACE-Step (music), Stable Audio Open (SFX), and other audio paths, see `models-and-quantization.md` and the `generative-music-audio` skill.

---

## What Got Absorbed / Deprecated

- **Spleeter** for stem separation — outclassed by Demucs v4.
- **AnimateDiff for Flux** — doesn't exist; AnimateDiff stays SD1.5/SDXL only.
- **Various A1111-style "all-in-one" packs** — most useful nodes are now in Essentials / KJNodes / Inspire.

---

## Pinning Strategy

In production:
1. Run ComfyUI-Manager → Snapshot → Save. Generates `manager-snapshot.json` with every custom-node commit hash.
2. Check the snapshot into git as your lockfile.
3. Restoring a machine: place the snapshot in `ComfyUI/snapshots/` → Manager → Restore Snapshot.
4. Don't auto-update.

This is how you survive the next CVE without an emergency rollback.

For security incidents and the broader hygiene playbook, see `security.md`.
