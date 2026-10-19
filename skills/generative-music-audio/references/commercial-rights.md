# Commercial Rights, Lawsuits, Watermarking, EU AI Act (May 2026)

The legal landscape changes monthly. **Verify the current state before shipping.** This document is a snapshot, not legal advice.

---

## License Matrix (May 2026)

| Service | Free tier commercial | Paid tier commercial | Critical caveat |
|---|---|---|---|
| **Suno** | No | Yes (Pro/Premier) | Persists past cancellation. Pre-settlement songs in legal limbo. |
| **Udio** | No | Yes on platform — **no downloads since Oct 2025** | Practically unshippable for distribution |
| **ElevenLabs Music** | No | Yes (Self-Serve excludes film/TV/AAA games) | Cleanest legal story |
| **ElevenLabs Voice/SFX** | No | Yes | Standard commercial terms |
| **Riffusion** | Yes | Yes | All output licensed |
| **Lyria 2 (Vertex)** | N/A | Yes | **SynthID watermark mandatory + unavoidable** |
| **Stable Audio 2.5** | Community License | Community (<$1M ARR) / Enterprise above | Defensible training data |
| **Stable Audio Open** | Community License | Same | CC-licensed training set (Freesound + FMA) |
| **MusicGen** | No | **No** (CC-BY-NC 4.0 weights) | Code MIT ≠ weights free |
| **AudioGen** | No | No | Same as MusicGen |
| **ACE-Step** | Yes (Apache-2.0) | Yes | Most permissive open. Verify per release. |
| **TangoFlux / Tango 2** | No | Stability registration required | Research-only by default |
| **YuE** | Verify per release | Verify | Weights license is moving target |
| **Riffusion (open)** | Yes | Yes | Permissive |
| **Chatterbox (Resemble open)** | Yes | Yes (verify current) | Open TTS |
| **F5-TTS** | Yes (MIT) | Yes | MIT licensed |
| **OpenVoice v2 / XTTS-v2** | Verify | Verify | XTTS-v2 has license complications |

**Always**:
- Read the **weights** license, not just the **repo** license.
- Re-verify on every minor release. Stability and Meta have changed terms before.
- For research papers' models (declare-lab, MAP, etc.), default-assume non-commercial unless explicitly Apache/MIT on the weights.

---

## Lawsuit Timeline (as of May 2026)

### Suno
- **Nov 25 2025**: Warner Music **settled with Suno** + signed licensing deal.
- **Pending**: Sony Music — **fair-use ruling expected summer 2026** (pivotal).
- **Pending**: UMG.
- Implication: songs created on pre-settlement Suno models are arguably trained on infringing data, even if you have a paid plan. The post-settlement licensed catalog is the cleaner play going forward.

### Udio
- **Oct 2025**: UMG settled, **downloads disabled**, co-launching new licensed platform 2026.
- The current Udio v2 is in run-out mode for distribution purposes.

### Industry pattern
- **Pirated training data is the consistent loser** in court rulings.
- **Legitimately-acquired data has had some fair-use traction.**
- Stability AI's "trained on licensed data" / "CC-only" positioning for Stable Audio 2.5 / Open is a direct response to this — and the most defensible posture in open weights.

---

## Watermarking — what's in production

### SynthID (Google DeepMind)
- Embedded in **all Lyria / NotebookLM audio**.
- Inaudible.
- **Survives MP3 compression and speed changes.**
- **Unavoidable** if you use Lyria.

### AudioSeal (Meta)
- Research-grade, similar approach.
- Less production-deployed than SynthID.

### C2PA Content Credentials
- **C2PA 2.1 ratified as ISO/IEC 22144** in 2025.
- Signed JSON-LD manifest binds to the audio file with cryptographic chain of edits.
- **Adobe Firefly, Google Veo/Lyria, OpenAI** all default-attaching C2PA in 2026.

### Detection (real-world)
- **Deezer** is tagging ~60k AI tracks/day; **Billboard now uses Deezer's detector** for chart eligibility.
- **13.4M AI tracks tagged** by Deezer since early 2025.
- Ship watermarked or expect detection.

---

## EU AI Act — Aug 2026 deadline

- **Machine-readable watermarks mandatory** on AI-generated audio output.
- Applies to providers placing AI systems on the EU market.
- Build for compliance now — retrofit is harder than design-in.
- **What "compliant" looks like**:
  - SynthID-style steganographic watermark survives common transforms.
  - C2PA Content Credentials manifest attached.
  - Disclosure in user-facing surfaces ("AI-generated").

---

## Voice Cloning Legal

### US
- **State-level patchwork**:
  - Tennessee **ELVIS Act** (2024) — explicit voice/likeness protection.
  - NY/CA right-of-publicity statutes apply.
- **Federal**: NO FAKES Act pending as of May 2026.
- Right-of-publicity claims are real and pursued.

### EU
- **AI Act** + **GDPR**: voice biometric data triggers consent requirements.
- Cloning without consent = both AI Act non-compliance and GDPR violation.

### Best practice (non-negotiable for any voice-cloning product)
1. **Written consent** with scope-limited license (which products, which territories, which duration).
2. **Recorded verbal consent statement** spoken by the source. ElevenLabs Pro Voice Clone requires this — replicate the flow.
3. **Watermark + C2PA** on every output.
4. **Audible disclosure** for synthetic-voice content in advertising / news / public-figure contexts.
5. **Revocation mechanism**: speaker can withdraw consent → cloned voice is taken offline + future generations blocked.
6. **Deepfake disclosure** at the point of use, not buried in ToS.

---

## Practical Build Checklist for Compliance

For any product shipping AI-generated audio in May 2026:

- [ ] Map every audio model used → license category (commercial OK / NC / requires registration).
- [ ] If using Suno/Udio wrappers (third-party API), document the legal grey zone and have a fallback (ElevenLabs Music or ACE-Step).
- [ ] Voice cloning: consent capture flow (written + recorded verbal).
- [ ] Voice cloning: revocation mechanism.
- [ ] Outputs: watermark (SynthID for Lyria, AudioSeal for self-hosted, or audible disclosure).
- [ ] Outputs: C2PA Content Credentials manifest.
- [ ] EU users: AI Act compliance (machine-readable watermark by Aug 2026).
- [ ] User-facing disclosure that audio is AI-generated.
- [ ] Don't claim copyright on output that was generated on a free tier of a service whose ToS retains rights or restricts commercial use.

---

## What to Tell Lawyers

If asked to write a memo:

> The 2026 legal landscape for AI-generated audio is unsettled. Three pivotal items:
> 1. **Suno + Sony fair-use ruling** (expected summer 2026) — could broadly endorse or restrict music model training.
> 2. **EU AI Act watermark mandate** (Aug 2026) — concrete compliance deadline.
> 3. **Federal NO FAKES Act** (pending) — would set US baseline for voice/likeness rights.
>
> The defensive posture is:
> - Use models with documented licensed training data (Stable Audio 2.5 / Open) where possible.
> - Use models with explicit commercial rights on paid tiers (Suno Pro/Premier post-Warner settlement, ElevenLabs Music).
> - Avoid models with NC weights regardless of code license (MusicGen, AudioGen).
> - Avoid models with unresolved training-data lawsuits where a finished product would be the visible artifact (current Udio for distribution).
> - Watermark + C2PA on everything.
> - Real consent flow for any voice cloning.

---

## Source-of-truth links to verify before shipping

- Stability AI License: stability.ai/license
- ElevenLabs commercial use: elevenlabs.io pricing + ToS
- Suno terms: suno.com pricing + ToS (note paid-vs-free distinction)
- Udio terms: udio.com/terms (note Oct 2025 download removal)
- C2PA spec: c2pa.org
- EU AI Act watermarking provisions: ec.europa.eu/digital-strategy

Verify the current state at the service's own ToS before shipping. The matrix in this file ages quickly.
