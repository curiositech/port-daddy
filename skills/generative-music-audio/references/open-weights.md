# Open-Weights Music + Audio Models (May 2026)

For local generation on your own GPUs. **License flags are non-negotiable** — the code license and weights license are often different. Always read the weights card before shipping commercially.

---

## ACE-Step — the standout open music model of 2026

**Apache-2.0 license** — actually permissive, actually commercial-friendly. The right answer when you need open + commercial + local.

- v1.5 released January 28 2026.
- **XL series** (4B-param DiT decoder, variants `xl-base` / `xl-sft` / `xl-turbo`) on April 2 2026.
- **Mac/AMD/Intel/CUDA support** — works on M-series Macs, not just NVIDIA.
- Quality competitive with commercial offerings.

**VRAM**: ~12–16GB for `xl-turbo`; `xl-base` and `xl-sft` happier with 24GB.

**Run via ComfyUI**: Native template at Workflow → Browse Templates → Audio → ACE-Step. See also the `comfyui-mastery` skill.

**Run via Replicate / fal**: Hosted endpoints exist for one-shot use without GPU ops.

**License**: Apache-2.0 on weights (verified at release). Re-verify per release.

---

## MusicGen / MusicGen-Stereo / MusicGen-Melody (Meta)

- **Code**: MIT. **Weights**: CC-BY-NC 4.0 — **non-commercial**.
- The MIT on the repo is for the code only. Using MusicGen output in a commercial product violates the weights license **regardless of self-hosting**.
- VRAM: 8GB+ for small, 16GB+ for the 3.3B Large model.
- 30s native; longer via continuation tricks.
- Decent quality, no vocals.

**Verdict**: Research and demos only. Do not ship in a paid product.

---

## AudioGen (Meta)

- Sibling of MusicGen for sound effects / environmental audio.
- Same non-commercial weights license caveats.

---

## Stable Audio Open 1.0 / 2.0 (Stability)

- **Trained on CC-0 / CC-BY / CC-Sampling+ data only** (~486k recordings from Freesound + FMA).
- Pre-screened with Audible Magic to remove copyrighted leakage.
- **Most defensible training-data story in open-weights audio.**
- **License**: Stability AI Community License — commercial use OK under $1M ARR; enterprise license above.
- ~47s output, 12GB VRAM.
- Best for SFX / loops / beds.

---

## YuE (Multimodal Art Projection)

The open Suno-alike — full songs with vocals.

- VRAM: **24GB minimum** for verse+chorus, **80GB+ (H800/A100/multi-4090) for full songs**.
- Optimized variants:
  - `YuEGP` (GPU Poor) and `YuE-exllamav2` get to 8–16GB but with quality trade-offs.
  - `fp16-quant` variants available.
- Speed: ~150s for 30s audio on H800; ~360s on RTX 4090.
- License: research/code open; **review weights license per release** before commercial use.

**Verdict**: Genuine full-song open weights, but VRAM-hostile. Use when you specifically need open + vocals and can spare server-grade hardware.

---

## DiffRhythm / DiffRhythm+ / DiffRhythm 2

- **DiffRhythm 1**: up to **4:45 in ~10s of inference**. Ridiculously fast.
- **DiffRhythm 2** (semi-autoregressive flow matching): up to 210s, outperforms prior open-source SOTA on subjective + objective evals.
- Source-available; check current weights license per release.
- Strong technical lineage but smaller community than ACE-Step.

---

## Tango 2 / TangoFlux (declare-lab)

- **TangoFlux**: 515M params, 30s of 44.1kHz audio in **3.7s on A40** — fastest text-to-audio open model.
- Flow matching + CLAP-ranked preference optimization.
- **License**: research/non-commercial only. **Commercial use requires Stability AI registration.**
- **Don't ship it without that registration.**

---

## MAGNeT, JASCO

Mostly research artifacts in 2026. JASCO offers fine-grained control over genre/instrumentation/melody but lacks the community velocity of ACE-Step or DiffRhythm. Use only if specific control axes matter for a research project.

---

## Practical Setup — ACE-Step on a 4090 (recommended path)

```bash
# 1. Install via ComfyUI Manager (search "ACE-Step")
#    OR clone the repo:
git clone https://github.com/ace-step/ACE-Step-1.5
cd ACE-Step-1.5

# 2. Use uv (fast) instead of pip
uv venv .venv && source .venv/bin/activate
uv pip install -r requirements.txt

# 3. Download weights to a network volume / shared cache
export HF_HOME=/path/to/shared/hf-cache
huggingface-cli download ACE-Step/ACE-Step-v1.5

# 4. Run inference (CLI varies — check current README)
python infer.py --prompt "indie rock, female vocals, anthemic chorus, 120bpm" \
  --duration 60 --output out.wav
```

For ComfyUI integration (recommended), see the `comfyui-mastery` skill — drag the official ACE-Step template, point at the downloaded weights, hit Queue.

## Practical Setup — Stable Audio Open on a single GPU

```bash
uv pip install diffusers transformers accelerate stable-audio-tools

python -c "
from diffusers import StableAudioPipeline
import torch
pipe = StableAudioPipeline.from_pretrained(
    'stabilityai/stable-audio-open-1.0',
    torch_dtype=torch.float16
).to('cuda')
audio = pipe(
    prompt='gentle rain on tin roof, distant thunder, 47 seconds',
    audio_end_in_s=47.0,
    num_inference_steps=200
).audios[0]
import soundfile as sf
sf.write('rain.wav', audio.T.cpu().numpy(), 44100)
"
```

## Open-Weights Bottom Line (24GB VRAM target)

| Need | Pick | License |
|---|---|---|
| Music with vocals, commercial-OK, runs on a 4090 | **ACE-Step XL-turbo** | Apache-2.0 |
| SFX / loops, defensible training data, commercial-OK <$1M ARR | **Stable Audio Open** | Stability Community |
| Research-only experiments | Tango 2 / TangoFlux / YuE | Non-commercial |
| Full open songs with vocals (need 80GB GPU) | **YuE** + variant | Verify per release |
| Avoid in commercial products | **MusicGen, AudioGen, TangoFlux output** | Non-commercial weights |

For TTS open weights, see `voice-and-tts.md`.
