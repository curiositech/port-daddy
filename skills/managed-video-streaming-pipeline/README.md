# Managed Video Streaming Pipeline

Architecture guidance for ingesting user-generated or on-demand video,
transcoding it, and delivering it efficiently and safely — via a managed
platform (Cloudflare Stream, Mux, BunnyCDN Stream) or a self-hosted
FFmpeg + object storage + CDN stack.

## Structure

```
managed-video-streaming-pipeline/
├── SKILL.md                                    # Core process, decisions, anti-patterns (<500 lines)
├── CHANGELOG.md                                # Version history
├── README.md                                   # This file
├── references/
│   ├── provider-economics.md                   # Pricing model shapes + cost projection method
│   ├── safe-thumbnail-and-moderation-gate.md   # Quarantine -> classify -> promote pattern
│   ├── drm-and-watermarking.md                 # DRM vs. forensic watermarking decision matrix
│   ├── signed-url-and-token-delivery.md        # Expiring/bound delivery URL patterns
│   └── adaptive-bitrate-and-packaging.md       # ABR ladder, codec, HLS/DASH packaging
└── scripts/
    └── cost_projector.py                       # Stdlib-only cost comparison across platforms
```

## Quick Start

1. Read `SKILL.md` for the core ingest -> classify -> transcode -> store ->
   deliver pipeline shape and the three key decisions (platform choice, DRM
   vs. watermarking, signed-URL delivery).
2. Run `scripts/cost_projector.py` with your own stored/delivered minutes
   before committing to a managed platform.
3. Pull the relevant file from `references/` (listed above) for
   implementation depth on whichever decision you're making.
