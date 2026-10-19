# Adaptive Bitrate Ladder and Packaging (HLS/DASH)

Read this when designing the actual transcode output — the rendition ladder,
container/codec choice, and streaming-protocol packaging — rather than the
platform/provider decision (see `references/provider-economics.md` for that).

## What "adaptive bitrate" means

Instead of delivering one fixed-quality file, the source video is transcoded
into multiple renditions at different resolutions/bitrates (a "ladder"), and
the player switches between them mid-playback based on the viewer's
measured network throughput and device capability. This is what prevents
buffering on a slow connection and wastes bandwidth on a fast one.

## A typical ladder (adjust to your content and audience)

| Rendition | Resolution | Video bitrate (approx.) | Use case |
|---|---|---|---|
| Low | 240p-360p | 300-700 kbps | Poor mobile connections |
| SD | 480p | 700 kbps-1.5 Mbps | Standard mobile |
| HD | 720p | 1.5-3 Mbps | Broadband mobile / low-end desktop |
| Full HD | 1080p | 3-6 Mbps | Desktop, good connections |
| (Optional) 4K | 2160p | 10-20 Mbps | Only if source quality and audience justify the storage/delivery cost multiplier |

Not every rung is necessary for every platform — a ladder with too many
rungs increases storage and transcode cost for marginal quality-of-experience
gain. Match the ladder to your actual audience's connection quality
distribution and device mix rather than defaulting to "as many rungs as
possible."

## Codec choice

- **H.264 (AVC)**: Universal device/browser support. Highest compatibility,
  least bandwidth-efficient of the three. Safe default when compatibility
  matters more than bandwidth cost.
- **HEVC (H.265)**: ~40-50% better compression than H.264 at equivalent
  quality, but patent licensing costs and inconsistent browser support
  (notably weaker on some Android/web contexts) make it a secondary rendition
  rather than a universal default.
- **AV1**: Royalty-free, best compression efficiency of the three, but
  highest encode cost (CPU/time) and still-maturing hardware decode support
  on lower-end devices as of 2026. Worth adding as a top rendition for
  capable clients when delivery-cost savings at volume justify the extra
  encode compute — re-run the provider-economics cost model with AV1's
  smaller file sizes before committing engineering time to it.

Many production pipelines ship H.264 as the compatibility baseline and add
HEVC or AV1 renditions selectively for higher tiers, rather than picking one
codec exclusively.

## HLS vs. DASH

| | HLS | DASH |
|---|---|---|
| Manifest format | `.m3u8` (playlist-based) | `.mpd` (XML-based) |
| Native support | Native on Apple platforms (Safari, iOS, tvOS, macOS) | Native on most Android/web via Media Source Extensions; no native Apple support |
| DRM | FairPlay (Apple's DRM) is HLS-only | Widevine/PlayReady commonly paired with DASH |
| Segment format | `.ts` (MPEG-TS) traditionally, fMP4 (CMAF) increasingly common | fMP4/CMAF |

**Practical default for 2026**: package both, using a **CMAF** (Common Media
Application Format) container so the same fMP4 segments serve both HLS and
DASH manifests — this avoids doubling storage for two separate segment sets.
Most managed platforms (Cloudflare Stream, Mux) handle this automatically;
if self-hosting, use `ffmpeg`/`shaka-packager`/`bento4` with CMAF output
explicitly rather than generating legacy MPEG-TS HLS and separate DASH
segments.

## Segment duration

- **Shorter segments (2-4s)**: Faster ABR quality switching (player reacts
  to network changes sooner), lower live-latency if applicable, but more
  HTTP requests (higher CDN request-count cost, more manifest overhead).
- **Longer segments (6-10s)**: Fewer requests, slightly better compression
  efficiency per segment, but slower ABR reaction time and coarser seek
  granularity.
- For on-demand (non-live) UGC video, 4-6 second segments are a common
  balance. Live/low-latency use cases push shorter; this skill is not for
  live delivery — see the `webrtc-adhoc-video-chat` skill's NOT clause and
  the main SKILL.md exclusions.

## Transcode compute

Transcoding is CPU/GPU-intensive and is typically the most expensive
*compute* line item in a self-hosted pipeline (as opposed to storage/egress,
which are the dominant *ongoing* costs). Batch/spot compute for encode jobs,
GPU-accelerated encoders (NVENC, VideoToolbox) where available, and
queue-based orchestration (so a burst of uploads doesn't require
provisioning for peak) are the standard mitigations. Managed platforms
absorb this cost inside their per-minute/per-GB pricing — factor "we no
longer have to run transcode infrastructure" into the provider-economics
comparison, not just storage/delivery rates.
