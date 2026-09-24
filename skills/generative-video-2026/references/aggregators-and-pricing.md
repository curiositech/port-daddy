# Aggregators and Pricing (May 2026)

Where to actually call these models from. Pricing comparison + failover patterns.

---

## fal.ai — broadest hosted catalog

- **Catalog**: Sora 2, Veo 3.1, Kling 3.0, Seedance 1.5/2.0, Hailuo 02, Wan 2.6, Pika 2.2, PixVerse V6, Hedra, Sync, LTX, Hunyuan, plus image and audio.
- **Pricing**: per-second or per-million-tokens depending on model (~$0.05–$0.40/s range). GPU-rented options for open weights (H100 $1.89/h, A100 $0.99/h).
- **Audio doubles price** on most models — Kling 2.6 $0.07 → $0.14/s; Hailuo Pro $0.045 → $0.08/s.
- **Best for**: rapid integration, latest models day-one, single bill for multi-vendor.

```python
import fal_client

result = fal_client.subscribe(
    "fal-ai/kling-video-pro/text-to-video",
    arguments={
        "prompt": "...",
        "duration": "5",
        "aspect_ratio": "16:9",
    },
    with_logs=True,
)
print(result["video"]["url"])
```

---

## Replicate — open-weights catalog + Cog deployments

- **~200 video models.** Wan 2.6/2.7, Hunyuan, LTX, plus most hosted frontier.
- Most models billed by GPU-second; some by output.
- Slightly more expensive than fal on the same model.
- **Acquired by Cloudflare in 2026** — strategic shift in progress, R8 hardware integration with CF in flight.

```python
import replicate

output = replicate.run(
    "wan-ai/wan-2-2:latest",
    input={"prompt": "...", "duration": 5}
)
```

---

## The discount tier — kie.ai, AI/ML API, CometAPI, AI Free API, WaveSpeedAI, Segmind

Aggressive pricing on Sora 2 / Kling / Veo (claims of 60–95% off direct rates).

| Model | Direct | Cheapest aggregator |
|---|---|---|
| **Sora 2 (720p)** | $0.10/s | $0.04–$0.06/s on kie.ai / AI Free API |
| **Sora 2 Pro (1024p)** | $0.50/s | ~$0.20–$0.30/s on kie.ai |
| **Veo 3.1 standard** | $0.40–$0.75/s | $0.10–$0.30/s on fal/Replicate (Fast variant) |
| **Kling 3 Pro** | $0.224/s no audio (fal) | similar across aggregators |
| **Hailuo 02 Pro** | $0.08/s | similar |

The aggregator discount is **biggest on Sora**, smallest on **Kling/Hailuo** (already aggregator-priced on fal).

**Caveats**:
- Reliability and content policy are the trade.
- Treat as "not for SOC2-bound workloads" but viable for indie / cost-sensitive.
- Aggregator content policies sometimes pass through different filters than the source vendor.

---

## Together AI / Fireworks

- Lean audio/video catalog; mostly LLM-focused.
- **Don't pick as primary video platform.**

---

## RunPod / Modal — bring-your-own model

Cheapest for serious open-weights workloads if you write the code.

For deployment patterns, see the `media-gen-deployment` skill.

---

## Higgsfield — aggregator with motion presets

Wraps Kling 3, Veo 3.1, Sora 2, Vidu behind one API. Unique sauce: preset cinematic camera moves.

---

## Direct vs Aggregator Decision

| You are... | Use |
|---|---|
| Indie / cost-sensitive | kie.ai / aggregator on Sora; fal everywhere else |
| Production SaaS, predictable | fal.ai (single bill, multi-vendor) |
| SOC2 / regulated | Direct (OpenAI, Google Vertex, Runway). Avoid discount aggregators. |
| Cheapest possible at scale | Self-host Wan 2.2 / Hunyuan-1.5 / LTX on RunPod |

---

## Failover Patterns

H100 capacity is **regional and spiky** in 2026.

Real outages observed:
- **RunPod H100** capacity exhaustion in us-east during February 2026 (8+ hour queues).
- **fal Wan 2.5** queue depth >5 minutes during peak Veo 3 launch week.
- **Modal** generally meets demand but B200 capacity is constrained — request capacity ahead of campaigns.

### Multi-vendor failover at queue-consumer level

```python
async def render_clip(prompt: str, keyframe: str) -> str:
    """Render with primary, fall through to secondary, last-resort."""
    try:
        return await asyncio.wait_for(
            fal_render("kling-3.0-pro", prompt=prompt, image=keyframe),
            timeout=60,
        )
    except (TimeoutError, FalQueueDepthError):
        try:
            return await asyncio.wait_for(
                replicate_render("wan-ai/wan-2.6", prompt=prompt, image=keyframe),
                timeout=120,
            )
        except (TimeoutError, ReplicateError):
            # Last resort — pay premium for Veo 3.1 Fast
            return await veo_render("veo-3.1-fast", prompt=prompt, image=keyframe)
```

### Queue-pattern templates

- **Cloudflare Queues + RunPod Serverless** — see `media-gen-deployment` skill.
- **Inngest + Modal** — best DX in this list.
- **Trigger.dev + Replicate** — cleanest observability.

---

## What to Tell Lawyers / Compliance

If asked to write a memo:

> Frontier video gen in 2026 is fragmented. We use:
> - **Aggregators (fal, Replicate)** for primary low-friction integration. Source vendors (OpenAI, Google, Runway) own the content policy.
> - **Direct vendor APIs** for SOC2/regulated workloads.
> - **Self-hosted open weights** (Wan 2.2 / Hunyuan-1.5 / LTX-2.3) on RunPod / Modal for cost-optimized scale and audit-friendly inputs.
>
> All output watermarked (C2PA + service-native if available — SynthID for Lyria, Adobe Content Credentials for Firefly, OpenAI / Google rolling out across video).
>
> EU AI Act watermark mandate (Aug 2026) requires machine-readable watermarks on AI-generated video. We attach C2PA Content Credentials by default.

---

## Cost Budget Worksheet

For a project producing N minutes of finished video / month:

| Stack | Cost / min | Cost @ 100 min/mo |
|---|---|---|
| Hailuo Standard cheap | $2.50/min | $250 |
| Kling 2.6 prosumer | $6/min | $600 |
| Veo 3.1 + ElevenLabs cinematic | $35/min | $3,500 |
| Sora 2 Pro hero shots + Veo 3.1 dialogue | $90/min | $9,000 |
| Self-host Wan 2.2 + Hunyuan-1.5 + Suno Pro | ~$0.50/min electricity + $10/mo Suno | ~$60 |

**Break-even** for self-hosting (4090 ~$0.30/hr cloud rental @ 70% utilization, plus engineering time): around **30–40 finished minutes per month** vs the cinematic cloud tier.

---

## TL;DR

- **Default for prototyping**: **fal.ai**. Single bill, latest models day one.
- **Default for production SaaS**: fal + Replicate with multi-vendor failover.
- **Default for indie cost sensitivity**: kie.ai for Sora, fal for everything else, self-host open weights at scale.
- **Default for regulated**: Direct vendor APIs (OpenAI, Vertex, Runway).
- **Default for max cost optimization**: Self-host Wan 2.2 / Hunyuan-1.5 / LTX on RunPod with Network Volumes — see `media-gen-deployment`.
