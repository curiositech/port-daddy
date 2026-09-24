# Full-Song Hosted Models (May 2026)

Detailed comparison of hosted services that produce complete songs (vocals + instrumentation + structure). For instrumentals/loops/SFX, see `sfx-and-foley.md`. For open-weights alternatives, see `open-weights.md`.

---

## Suno (v4.5 / v5 / v5.5)

**The quality leader for vocal pop/rock.** v5 is Pro/Premier exclusive; v5.5 introduced the MILO-1080 "style of music" engine for more deterministic style transfer.

**Capabilities**
- ~4 minutes per generation, **extendable section-by-section via Extend with timestamp**.
- Up to **12 stems** on paid plans (vocals, drums, bass, instruments). Stems and **Persona** (lock vocalist/style across songs) actually work as of v5.
- Custom Mode: separate fields for style (200 chars), lyrics (3000 chars), structure tags.

**Pricing**
- Free: 50 credits/day, **non-commercial**.
- Pro ~$10/mo: 2,500 credits, commercial rights.
- Premier ~$30/mo: 10,000 credits + Studio (timeline editor, partial regen).

**API status (May 2026)**
- **No official public API.** Suno has private partner access only.
- Practical access: third-party wrappers — PiAPI, EvoLink, sunoapi.org, AI/ML API at ~**$0.111/song** for v5. Grey legal area — they scrape the consumer site. Plan a fallback.

**Commercial rights**
- Pro and Premier songs are commercially yours. Rights persist after cancellation for songs created during paid time.

**Lawsuit status (May 2026)**
- **Warner Music settled with Suno on Nov 25 2025** + signed licensing deal.
- Sony Music has not settled — fair-use ruling expected summer 2026 (pivotal).
- UMG ongoing.

---

## Udio (v2 / v4)

**Functionally crippled for distribution.** Section regen + inpainting + DAW-style controls are best-in-class — but you can't get the audio off the platform.

**Distribution status — critical**
- **Udio disabled all downloads in October 2025** as part of the UMG settlement.
- You can generate on-platform; you cannot export to use anywhere else.
- Sharing outside the platform is barred by current ToS.
- Distribution via Spotify/Apple Music through third-party distributors is blocked.

**API**: Pro tier ($30/mo) gates API access.

**2026 plan**: UMG is co-launching a licensed AI music platform with Udio in 2026. The new product will be the path to clean commercial output — not the current Udio v2. Until that ships, **don't build on Udio for distributable music.**

---

## ElevenLabs Music

**The cleanest commercial story.** Best legal posture among hosted full-song generators.

**Capabilities**
- 3 seconds to **5 minutes**, 48kHz.
- Prompt-driven with structure control. Less reference-audio-driven than Suno/Udio.
- Music API live; billed **per generation** (not per character/second like TTS).

**Pricing**
- Starter $5/mo, Creator $11/mo. Music API requires a paid sub.

**Commercial use**
- All paid plans grant broad commercial rights (online + offline).
- **Self-Serve plans exclude film, TV, and large studio games.**
- Enterprise covers all.

**Quality**: Improving fast in 2026; not yet at Suno's vocal pop level. Commercial control + structured generation make it the right pick when legal posture matters more than the very last 5% of vocal quality.

---

## Riffusion FUZZ / Producer.ai

- Models: FUZZ-0.8/1.0/1.0 Pro/1.1/1.1 Pro. **FUZZ-1.0 free + unlimited**; Pro tiers behind subscription.
- 3–4 minute songs, sub-60s gen time.
- **Vocal/instrument swap** is a unique differentiator (re-skin existing clips).
- **All output licensed for commercial use.**
- Public REST API with broad coverage.

---

## Google Lyria 2 / Lyria 3 / Lyria RealTime

**Lyria 2** (GA on Vertex AI)
- **30-second clips, 48kHz WAV.** Text-prompt-driven via `predict` endpoint.
- Lyria 3 announced via DeepMind.
- **All output is SynthID-watermarked** (inaudible, survives MP3 compression and speed changes). Unavoidable — good for provenance, irrelevant if you wanted plausible deniability.

**Lyria RealTime**
- Bidirectional WebSocket streaming for live, interactive jamming.
- Generates new music in response to its own output and user steering.
- Available via Gemini API and AI Studio.
- The realtime music story other vendors are racing to copy.

---

## Stable Audio 2.5 (Stability AI)

**Positioned as enterprise** with a **fully licensed dataset** — explicit clean-rights story.

- Available via stableaudio.com, Stability API, fal, Replicate, ComfyUI, or on-prem with enterprise license.
- **Stability AI Community License**: free for research, non-commercial, and commercial use **under $1M annual revenue**; above that, enterprise license required.
- Strongest hosted offering for production sound design, beds, and instrumental loops with clean rights.
- **Not a vocal pop song generator.** If you need vocals, this is the wrong tool.

---

## MiniMax Music 2.5 (via fal.ai)

- **$0.035/track via fal — ~20× cheaper than ElevenLabs Music per track.**
- Worth knowing if you're doing volume.
- Quality is below Suno tier but acceptable for high-volume content (background music, content factories, cheap iteration).

---

## ACE-Step (hosted endpoints exist; primary path is open-weights)

See `open-weights.md`. Hosted endpoints on fal/Replicate at low cost, but the primary play is local.

---

## Mureka

- ~10M users since 2024.
- Distinguishing tech: **MusiCoT** (Music Chain-of-Thought) — plans song structure before generating audio.
- Voice cloning, style matching, **10 languages, stem separation, Ableton/DAW integration**.
- Commercial rights on paid plans.
- Useful if multilingual + DAW integration is a hard requirement.

---

## Background-music tier (Beatoven, Loudly, AIVA, Soundraw, Mubert)

These are **loop/instrumental generators** — not full songs with vocals. They compete on:
- Royalty-free output for YouTube/podcast intros.
- Fast, formulaic background beds.
- Low or zero artistic ambition.

Use when the brief is "30s of inoffensive bed music for a video, royalty-free, fast." AIVA leans classical/orchestral; Beatoven royalty-free on paid; Soundraw/Loudly/Mubert are loop-based.

Don't expect Suno/Udio quality — different category entirely.

---

## Honest May-2026 Quality Ranking (vocal pop/rock)

1. **Suno v5** — vocals, song structure, hooks. Nothing else is close for pop with lyrics.
2. **Udio v4** — comparable musical quality, but you can't take the music off the platform.
3. **ElevenLabs Music** — closing the gap, best commercial terms.
4. **Riffusion FUZZ-1.1 Pro** — solid; vocal swap is a real differentiator.
5. **Mureka** — improving; multilingual + DAW integration is unique.
6. **Lyria 2** — high fidelity instrumental; 30s ceiling kills it for songs.
7. **Stable Audio 2.5** — best for SFX/beds/loops, not songs.
8. **AIVA / Soundraw / Mubert / Loudly / Beatoven** — background music tier.

---

## Quick-Pick Decision

| Need | Pick |
|---|---|
| Pop song with vocals, commercial | **Suno v5 Pro** |
| Pop song, cleanest legal posture | **ElevenLabs Music** Self-Serve (or Enterprise for film/TV) |
| Cheap volume music gen | **MiniMax Music 2.5 via fal** ($0.035/track) |
| Realtime music jam | **Lyria RealTime** (Gemini API, WebSocket) |
| 30s instrumental loop / bed | **Stable Audio 2.5** |
| Re-skin existing clip with new vocals | **Riffusion FUZZ** vocal swap |
| Multilingual + DAW workflow | **Mureka** |
| Royalty-free YouTube background | **Beatoven / Soundraw** |
