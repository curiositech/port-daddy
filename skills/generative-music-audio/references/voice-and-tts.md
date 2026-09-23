# Voice + TTS (May 2026)

The TTS landscape split sharply in 2026: latency-leaders (Cartesia, OpenAI realtime) for voice agents; expressive readers (ElevenLabs v3, Hume) for narration; open weights (Chatterbox, F5-TTS, Higgs Audio) closing the quality gap fast.

---

## ElevenLabs v3 / v3.5 — the expressive default

**Audio tags** are the killer feature: inline `[laughs]`, `[whispers]`, `[sighs]`, `[swallows]`, `[door slam]`, `[starts laughing]`. Best-in-class expressive control.

**Voice cloning**
- **Instant Voice Clone**: 1–5 min reference, fast turnaround.
- **Professional Voice Clone**: 30+ min for studio fidelity.
- Pro Voice Clone requires a recorded verbal consent statement — replicate this in your own product.

**Pricing**
- Flash/Turbo: **$0.06 / 1k chars**.
- Multilingual v2 + v3: **$0.12 / 1k chars**.
- Subscription Starter $5/mo (30k credits), Creator $11/mo (100k credits).
- Music + SFX are billed separately (per generation, not per char).

**When to use**: Default for expressive narration, dialogue, or anywhere audio tags matter.

---

## OpenAI gpt-realtime (formerly gpt-4o-realtime)

**GA in 2026** with a 20% price cut from preview.

**Pricing (May 2026)**
- Audio input: **$32 / M tokens**.
- Audio output: **$64 / M tokens**.
- Cached input: **$0.40 / M tokens**.
- Text: $4 / M in, $16 / M out.
- Image inputs in realtime sessions now supported.

**When to use**: Realtime conversational voice agents where one model handles reasoning + speech in a single turn. The integration tax of separate STT + LLM + TTS often outweighs the per-token savings of a split stack.

---

## Cartesia Sonic 2 / Sonic 3 — the latency leader

- **TTFB ~40ms** (TTS-only) — the latency leader by a margin.
- Sub-100ms end-to-end response possible with the right STT + LLM + Sonic chain.
- **Sonic 3** better at numbers/dates (less hallucination) — important for telephony, customer support.

**When to use**: You bring your own STT + LLM and need streaming TTS that feels instant. Phone bots, voice copilots, real-time game NPCs.

---

## Hume Octave / Octave 2 — emotional fidelity

- Reads for **meaning** before generating audio — shifts delivery from calm to urgent without explicit tags.
- **$7.60 / 1M characters** — cheapest among top-tier providers per Cekura's 2026 benchmark.

**When to use**: Mental health apps, narrative fiction, empathy-heavy customer scenarios. When the emotional read is the load-bearing requirement.

---

## PlayHT Play 3.0

- **800+ voices, 142 languages/accents.**
- **PlayDialog** for two-voice support.

**When to use**: Voice library breadth or specific accents win the brief. Think regional content, audiobook narrator selection.

---

## Resemble AI

- Commercial parent of Chatterbox (the open model below).
- Full voice cloning + emotion control SaaS.

---

## Open-weights TTS — Hugging Face top trending (May 2026)

### Chatterbox (Resemble's open model, 0.5B Llama-based)
- **#1 trending HF TTS in 2026.**
- **Beats ElevenLabs in 63.75% of blind tests** per Resemble's own benchmark.
- Multilingual variant available.
- Excellent for fiction/dialogue.
- License: open, verify current terms.

### Higgs Audio v2 (BosonAI)
- **3B params on Llama 3.2 3B**, pre-trained on **10M hours of audio**.
- Industry-leading expressive output + multilingual cloning.
- Heavier than Chatterbox; richer outputs.

### F5-TTS
- **MIT license.**
- Zero-shot cloning.
- **7× realtime (33× with Fast variant).**
- ComfyUI integration via `niknah/ComfyUI-F5-TTS` or the unified `diodiogod/TTS-Audio-Suite`.

### Kokoro
- **82M params.** Tiny.
- Runs on free Colab GPU at **36× realtime**.
- Indie, small, fast. Quality below Chatterbox but the smallest decent-quality TTS.

### Sesame CSM
- 1B Llama-based, multi-speaker oriented.
- Less natural than Chatterbox/Higgs.

### OpenVoice v2, XTTS-v2, MeloTTS, Llasa, Spark-TTS
- Solid, generally outclassed by Chatterbox/Higgs/F5 on quality in 2026.
- **XTTS-v2 license complications persist** — use cautiously, read the latest terms.

---

## ElevenLabs v3 Audio Tag Reference

Inline tags that actually work (drop into the text payload):

```
[laughs] [chuckles] [giggles] [sighs] [whispers] [yells]
[crying] [sobbing] [angry] [excited] [sad]
[door slam] [glass breaks] [footsteps]
[starts laughing] [stops talking] [pauses]
[swallows] [coughs] [clears throat]
```

Combine with voice clone for nuanced reads:
```
text: "She walked in. [pauses] 'You came back?' [whispers] 'After all this time?'"
```

---

## Voice Cloning Ethics + Consent UX (non-negotiable)

- **Always get explicit, recorded consent** for the specific voice and the specific use case. Implicit consent doesn't survive a deepfake lawsuit.
- ElevenLabs Pro Voice Clone requires a verbal consent statement — replicate this flow.
- Tag cloned output with **C2PA Content Credentials** + audible disclosure for synthetic-voice content in advertising/news contexts.
- **EU AI Act (Aug 2026)** requires machine-readable watermarks on AI-generated audio. Build for compliance now.
- Tennessee ELVIS Act + state right-of-publicity statutes. Federal NO FAKES Act pending.
- Best-practice consent flow:
  1. Written license scope-limited to specific use cases.
  2. Recorded verbal consent statement spoken by the source.
  3. Watermark + C2PA on every output.
  4. Revocation mechanism — speaker can withdraw consent and have the cloned voice taken offline.

---

## Decision Quick-Pick

| Need | Pick |
|---|---|
| 10-min explainer narrator | **ElevenLabs Multilingual v2** with Pro voice clone |
| Emotional narration | **Hume Octave 2** ($7.60 / 1M chars) |
| Realtime voice agent (one model) | **OpenAI gpt-realtime** |
| Realtime voice agent (lowest latency) | **Cartesia Sonic 3** + your LLM + Whisper |
| Voice library breadth | **PlayHT Play 3.0** |
| Local + free fiction/dialogue | **Chatterbox** (Resemble open) |
| Local + free zero-shot cloning | **F5-TTS** (MIT) |
| Local + tiny + fast | **Kokoro** (82M) |
| Maximum local expressive | **Higgs Audio v2** (BosonAI, 3B) |

For voice in finished video (lip-sync, talking heads), see the `generative-video-2026` skill — Hedra Character-3, Sync.so, LatentSync.
