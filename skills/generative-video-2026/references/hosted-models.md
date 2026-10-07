# Hosted Frontier Video Models (May 2026)

Detailed specs and gotchas for the major hosted services. For open-weights alternatives see `open-weights.md`.

---

## OpenAI Sora 2 / Sora 2 Pro

- **API model IDs**: `sora-2` (T2V + I2V), `sora-2-pro` (longer + 1080p tier). Plus `sora-2-i2v`, `sora-2-pro-i2v`.
- **Resolutions**: Standard **720p** (1280×720 / 720×1280). Pro adds **"1024p"** = 1024×1792 / 1792×1024. **No native 4K** — upscale via Topaz.
- **Max duration**: Standard 4/8/12s; **Pro 10/15/25s**.
- **Aspect ratios**: 16:9 and 9:16 only. **No 1:1 in API.**
- **Audio**: Yes — native synchronized dialogue + SFX + music. Quality good but Veo 3.1 still beats it on lip sync.
- **i2v**: Yes (`sora-2-i2v`, `sora-2-pro-i2v`).
- **v2v**: No native v2v.
- **Character consistency**: **Cameos** — but face-photo upload was **banned in Feb 2026**. Sanctioned path is in-app iOS recording only. **Cameos are NOT in the API as of May 2026.**
- **Pricing direct**:
  - Sora 2: $0.10/s @ 720p
  - Sora 2 Pro: $0.30/s @ 720p; $0.50/s @ 1024p
  - 25s × $0.50 = **$12.50/clip top tier**
- **Access**: Direct (OpenAI Tier 2+, $10 min top-up). Aggregators: OpenRouter, fal, Replicate, kie.ai, AI/ML API. **Aggregators 30–60% cheaper.**
- **Strengths**: Physical realism (objects with weight, momentum, contact), camera move coherence. Best-in-class for "one cinematic shot".
- **Weaknesses**: Locked-down character workflow. No 4K. Aspect rigidity. Cameo errors a constant API headache. Throughout 2026, OpenAI has quietly throttled and walked back consumer Sora — **treat the API as supported, the consumer app as in retreat.**

---

## Google Veo 3.1 / Veo 3.1 Fast / Veo 3.1 Lite

- **Versions**: Veo 3.1, Veo 3.1 Fast, Veo 3.1 Lite. Veo 2 still on Vertex for cheap.
- **Resolutions**: Up to **true 4K (3840×2160)**, native **9:16 vertical** since Jan 2026 update.
- **Max duration**: ~8s base, extendable. Vertex supports stitched extensions.
- **Audio**: **Native synchronized**. Best lip sync of any hosted model in 2026.
- **Reference / character consistency**: **Ingredients to Video** — upload up to **3 reference images** (face + outfit + background). Closest hosted product to a real character library.
- **i2v**: Yes, with reference images.
- **v2v**: No first-class v2v.
- **Pricing**:
  - Vertex / Gemini Veo 3.1: ~**$0.40–$0.75/s** with audio standard
  - **Veo 3.1 Fast (no audio)**: as low as **$0.10/s** on Vertex / fal / Replicate
  - Veo 2 on Gemini API: $0.35/s; Vertex: $0.50/s
- **Access**: Gemini API (cheaper, fewer enterprise features), Vertex AI (regional residency, IAM, content controls), fal, Replicate, Higgsfield. Consumer: Google AI Pro $19.99/mo or AI Ultra $249.99/mo.
- **Strengths**: Audio. Lip sync. 4K. Vertical. Reference images. Broadcast color.
- **Weaknesses**: **Audio is opt-out, not opt-in** — mention "voice" in your prompt, you get audio. Style range conservative vs Kling. Vertex billing is its own circle of hell.

---

## Runway Gen-4 / Gen-4 Turbo / Gen-4.5 / Aleph / Act-Two

- **Versions**: Gen-4 (T2V + I2V), Gen-4 Turbo (faster, slightly worse), Gen-4.5 T2V (latest 2026), **Aleph** (v2v editing), **Act-Two** (mocap → any character image).
- **Resolutions**: Up to 1080p, 16:9 / 9:16 / 1:1.
- **Max duration**: Gen-4 up to 10s. **Aleph capped at 5s and 64 MB input** — biggest limit.
- **Audio**: No native audio in Gen-4 generation; pair with separate TTS.
- **i2v / v2v**: **Aleph is the best-in-class hosted v2v** — add/remove objects, change lighting, regenerate camera angle, restyle. **Nothing else hosted does this.**
- **Character consistency**: **Runway References** (named library). Pairs with Act-Two for performance transfer.
- **Pricing**:
  - Subscription: Standard $15/mo ($12 annual), Pro $35/mo, Unlimited $95/mo (relaxed-rate Gen-4/Aleph)
  - API credits: **Aleph 15 credits/s**, **Act-Two ~5 credits/s**. Credits ~$0.005 at $5/1000 → Aleph ~$0.075/s output, Act-Two ~$0.025/s. *Cheaper than hosted T2V — it's editing, not generating.*
- **Access**: runwayml.com direct, Segmind, WaveSpeedAI, kie.ai, CometAPI for Aleph.
- **Strengths**: **Aleph and Act-Two have no real competition.** If your job is "edit this footage" or "drive this character with a phone-cam performance", Runway wins by default.
- **Weaknesses**: Pure T2V quality has fallen behind Veo/Kling/Sora. Aleph 5s/64MB cap forces chunking.

---

## Kling (Kuaishou)

- **Versions**: **Kling 2.5 effectively retired by May 2026**. Active: **Kling 2.6** (cheaper mid-tier) and **Kling 3.0 / 3.0 Pro / Kling Video O3** (frontier).
- **Resolutions**: Kling 3.0 is the only mainstream hosted model with **native 4K**. Standard tiers 720p/1080p.
- **Max duration**: 5s and 10s clips standard; longer via stitching.
- **Audio**: Native audio added in 3.0; quality below Veo and Seedance.
- **i2v / v2v**: Excellent i2v. Camera control DSL ("Kling camera"). No real v2v.
- **Character consistency**: Kling Elements / multi-image reference; less consistent than Veo Ingredients.
- **Pricing on fal**:
  - Kling 2.6: $0.07/s no audio, $0.14/s with audio
  - Kling 3 Pro: $0.224/s no audio, $0.28/s with
  - Kling 2.5 Turbo on kie.ai: 5s = $0.21, 10s = $0.42
- **Strengths**: Visual fidelity king. Texture, lighting, multi-subject. Only practical native-4K hosted T2V.
- **Weaknesses**: Prompt understanding below Veo. Audio good but not best. **Kuaishou is Chinese platform** — some enterprises block via egress / compliance.

---

## ByteDance Seedance 1.5 Pro / Seedance 2.0 — the underrated one

- **Versions**: Seedance 1.5 Pro (Dec 2025), **Seedance 2.0 (Feb 2026, current frontier)**.
- **Architecture**: **Joint audio-video diffusion** — both modalities generated simultaneously. Lip sync genuinely native.
- **Max duration**: 4–12s.
- **Resolution**: Up to 1080p.
- **Audio**: **Seedance 2.0 supports text + image + audio + video as inputs**. Multilingual (Mandarin, English, Japanese, Korean, Spanish, Indonesian, regional Chinese dialects).
- **Pricing on fal**: 1.5 Pro **~$0.26 for 5s @ 720p with audio**; ~$2.40 / 1M video tokens with audio, $1.20 without.
- **Strengths**: **Best $/quality at 720–1080p with synchronized audio.** Multilingual lip sync.
- **Weaknesses**: Less branded. Less ecosystem in West. Not in mainstream Western consumer apps.
- **Honest take**: If you're API-first and don't care about brand, **Seedance 2.0 should be your default for talking-head-with-audio cinematic shots.** Strictly cheaper than Veo 3.1, within striking distance on quality.

---

## MiniMax Hailuo 02 / Hailuo 2.3

- **Versions**: Hailuo 02 Standard (768p), Hailuo 02 Pro (1080p), Hailuo 2.3 (anime/illustration tilt).
- **Max duration**: 6/10s.
- **Audio**: Limited.
- **Pricing on fal**: Standard $0.045/s @ 768p, **Pro $0.08/s @ 1080p**, 512p down to $0.017/s — **the cheapest competent hosted I2V.**
- **Strengths**: Best $/sec for I2V storyboard work. Hailuo 2.3 strong on stylized/anime input.
- **Weaknesses**: Physics and audio are second-tier.

---

## Luma Ray 2 / Dream Machine

- **API**: $0.32 per **million pixels generated** — unique billing. A 5s 720p clip ≈ **$0.45**.
- Camera control via prompt keywords mature.
- **Consumer**: Plus $30, Pro $90, Ultra $300/mo.
- **Strengths**: Camera moves and dolly-style cinematic motion clean.
- **Weaknesses**: Audio bolted on, not native. Fallen out of top tier on raw quality vs Kling/Veo.

---

## Pika 2.0 / 2.2

- Pika 2.2 hosted on **fal.ai**: 720p/1080p, 5–10s, plus differentiated **Pikascenes** (multi-subject composition) and **Pikaframes** (keyframe interpolation between two stills).
- Pricing: 18 credits per 5s 1080p in consumer app; pay-per-use on fal at $0.05–0.15/s class.
- **Strengths**: **Pikaframes is the cleanest hosted "interpolate between these two images" tool.** Underrated for storyboard-driven workflows.
- **Weaknesses**: Lost cinematic-quality crown to Veo/Kling. Specialty tool now, not primary T2V.

---

## Adobe Firefly Video

- **Pricing**: Consumer-only practical access. ~100 credits/5s. Standard $9.99 (~20 clips/mo), Pro $19.99 (~40), Premium $199.99 (~500).
- **API requires enterprise contract with ~$1,000/mo minimum.**
- **Strengths**: Commercially safe (licensed training material), enterprise legal posture, Premiere/After Effects integration.
- **Weaknesses**: Quality is mid. **API gate is hostile to small builders.**

---

## PixVerse V6, Higgsfield, Vidu

- **PixVerse V6** (March 2026): **20+ cinematic lens controls** (focal length, aperture, DoF, chromatic aberration, vignetting), multi-shot video with native audio, 15s @ 1080p stable. From **$0.22/generation** (360p/5s) on Segmind.
- **Higgsfield** is **an aggregator** wrapping Kling 3, Veo 3.1, Sora 2, Vidu behind one API. Unique sauce: motion presets.
- **Vidu Q1 / 2.0 I2V**: Multi-image reference for character animation, especially in 4s mobile-aspect clips. Useful niche, especially for anime.

---

## Tencent Hunyuan (hosted side)

Tencent runs hosted Hunyuan endpoints, but the more important fact is **HunyuanVideo and HunyuanVideo-1.5 are open-weights** — see `open-weights.md`.

---

## Hedra Character-3 / Omnia

- **Hosted**, polished. Creator $24/mo (~11 min of 720p Character-3 / month at 5,400 credits). Free tier 300 credits with watermark. Ships an **actual API**.
- **Best end-to-end product** for "image + audio → talking character video".
- See `lipsync-and-consistency.md` for full lip-sync comparison.

---

## What's Genuinely New in 2026

- **Veo 3.1 Ingredients** (Jan 2026) — character consistency from reference images that actually works.
- **Seedance 2.0** (Feb 2026) — joint audio-video as native architecture.
- **PixVerse V6** (Mar 2026) — cinematic lens DSL and multi-shot.
- **Hedra Omnia** (Feb 2026) — full Hedra API.
- **LTX-2.3** open weights (late 2025/early 2026) — native audio + 1080p.
- **Hunyuan-1.5** (Nov 2025) — 8.3B model in 6GB VRAM.

For aggregator pricing comparison + failover, see `aggregators-and-pricing.md`.
