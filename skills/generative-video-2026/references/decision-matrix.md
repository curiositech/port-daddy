# Decision Matrix — Pick the Right Video Tool

Quick lookup. For deeper specs see `hosted-models.md` and `open-weights.md`.

---

## By Use Case

| Use case | First choice | Second choice |
|---|---|---|
| **One perfect 8s cinematic shot** | **Sora 2 Pro 1024p** ($0.50/s) | Kling 3.0 Pro |
| **Consistent character across 10 shots** | **Veo 3.1 Ingredients** (3-image refs) | Runway References + Act-Two |
| **Talking head from script** | **Hedra Character-3** (image + audio + lip-sync built in) | Veo 3.1 + Sync.so |
| **Animate my drawing** | **Pika 2.2 + Pikaframes** | Kling I2V from stylized still |
| **Restyle / edit existing video** | **Runway Aleph** (5s, 64MB cap) | DiffSynth-Studio + Wan I2V re-roll |
| **Realtime / fast preview** | **LTX-2.3** | Wan 2.2 5B with TeaCache |
| **RTX 4090, want full local** | **Wan 2.2 5B daily + 14B FP8 hero + Hunyuan-1.5 + LatentSync** | LTX-2.3 if you also need audio |
| **M3/M4 Max** | **LTX-2.3 via MLX** (`ltx-2-mlx` / phosphene) | Wan 2.2 5B via Wan2GP |
| **Cheapest acceptable I2V at 1080p** | **Hailuo 02 Pro $0.08/s** | Kling 2.6 $0.07/s no audio |
| **Multilingual talking video at scale** | **Seedance 2.0** (joint a/v, 7+ langs) | HeyGen for templated avatars |
| **Enterprise legally-safe** | **Adobe Firefly Video** | Veo on Vertex with content controls |
| **Short-form viral repurposing** | **Submagic** + Captions for B-roll | Argil for personal avatar |
| **Phone-cam mocap to character** | **Runway Act-Two** | (no real competitor) |
| **Cinematic lens control** | **PixVerse V6** (20+ lens controls) | Kling camera DSL |
| **Cheap volume music gen** (audio side) | MiniMax Music 2.5 via fal | (see `generative-music-audio`) |

---

## By Constraint

### Budget

| Tier | Pick |
|---|---|
| ~$0/min (electricity only) | Self-host Wan 2.2 / Hunyuan-1.5 / LTX on 4090 or M-Max |
| < $5/min | Hailuo 02 Standard, Kling 2.6 |
| $5–10/min | Kling 2.6 + ElevenLabs basic |
| $25–45/min | Veo 3.1 + Sync.so + MusicGen |
| $60–120/min | Sora 2 Pro hero + Veo 3.1 dialogue + Aleph cleanup |

### Hardware (local)

| Hardware | Pick |
|---|---|
| RTX 4090 (24GB) | Wan 2.2 14B FP8 (quality) / LTX-2.3 (speed) / Hunyuan-1.5 (balance) |
| RTX 5090 (32GB) | Same as 4090 with headroom for FP8 14B |
| RTX 3060/4060 (8-12GB) | Wan 2.2 TI2V-5B / Hunyuan-1.5 low-VRAM fork (6GB) |
| M3/M4 Max | LTX-2.3 via MLX (best Apple stack); Wan 2.2 5B via Wan2GP |
| H100 (80GB) | HunyuanVideo (full 13B) / Wan 2.2 14B FP16 |

### Latency

| Need | Pick |
|---|---|
| Realtime preview (subseconds) | LTX-2.3 on right GPU |
| Fast iteration (seconds) | LTX-2.3 distilled local, fal hosted |
| Standard hosted (10-90s) | Veo 3.1 Fast, Kling 2.6, Hailuo 02 |
| OK to wait (minutes) | Sora 2 Pro, Veo 3.1 standard, Wan 2.2 14B local |

### Compliance

| Need | Pick |
|---|---|
| Adobe-grade legal posture | Adobe Firefly Video (enterprise API, ~$1k/mo min) |
| Western jurisdiction only | OpenAI / Google / Runway direct APIs (avoid Kling/Hailuo) |
| Watermarking required | Veo 3.1 (SynthID) or Adobe Firefly (Content Credentials) — both default-attach |
| Open-source training data audit | Mochi 1 (genuinely Apache 2.0); verify Wan/Hunyuan licenses per release |

---

## "Just give me a default"

For a generic SaaS shipping AI video in May 2026:

1. **Primary stack**: fal.ai
2. **Per-job model selection**:
   - Hero cinematic shot → Sora 2 Pro or Kling 3.0
   - Storyboarded narrative → Kling 3.0 + Pika Pikaframes for transitions
   - Talking head → Hedra Character-3 (end-to-end)
   - Cheap volume → Hailuo 02 Pro
3. **Failover**: fal → Replicate → kie.ai (last resort)
4. **Self-host trigger**: when monthly cloud bill > $3,000, evaluate moving Wan 2.2 / Hunyuan-1.5 to RunPod Serverless H100 (see `media-gen-deployment`).
5. **Storage**: Cloudflare R2 ($0 egress).
6. **Watermark**: C2PA Content Credentials on every output. EU AI Act compliance ready for Aug 2026.

---

## What Will Change in the Next 6–12 Months

- **Realtime generation** moves from demo to default. LTX-2.3 already does it under specific conditions; Hunyuan-1.5's 75s/clip on a 4090 is one optimization wave away.
- **Longer durations** without quality cliff. Stitched-stable approaches like MimicMotion's progressive latent fusion bleeding into hosted models.
- **Native editing in models** — the Aleph paradigm (in-context video editing) will arrive in Veo and Kling. Sora 2 lacking this is a gap.
- **Real character libraries.** Veo Ingredients is v1; expect named, persistent character entities with usage rights baked in.
- **Cheaper audio.** Joint a/v models (Seedance, LTX-2) collapse the lip-sync stack into one call, removing Hedra/Sync as a required step for many use cases.
- **Provenance default.** C2PA shipped with Adobe + Google by default; OpenAI following. **By 2027, downstream platforms (YouTube, TikTok) will likely require provenance metadata.**
- **Open weights ≈ hosted 2024 frontier.** ~12–15 months behind hosted SOTA, closing. Hunyuan-1.5 + LTX-2.3 in 2026 are roughly where Veo 1 / Sora 1 were. May 2027 open weights ≈ Veo 3.1 today.

---

## Anti-Patterns (Quick List)

- **Sora 2 cameos via API** — not exposed.
- **Veo 3.1 with audio when you want silence** — opt-out, not opt-in. Use Fast variant.
- **One Aleph call for >5s** — chunk into 5s billable jobs.
- **Hardcoded `kling-v2.5-*`** — silently remapped to 2.6/3.0 by aggregators.
- **Single API call for finished video** — pipeline, don't over-ask one model.
- **Maxing model duration** — quality drops past training distribution. Storyboard, don't long-take.
- **Open-weights "Apache 2.0"** without per-release license check.

For deeper anti-pattern detail with Novice/Expert/Detection format, see the SKILL.md.
