# Managed Video Streaming Pipeline -- Changelog

## v1.0.0 (2026-09-19)

- Initial skill creation: ingest -> content-safety gate -> transcode -> package -> store -> deliver pipeline shape
- Documented managed-platform pricing model shapes (Cloudflare Stream, Mux, BunnyCDN Stream) vs. self-hosted FFmpeg + object storage + CDN
- Added safe thumbnail/moderation-gate pattern (quarantine bucket, never synchronous public write) with sequence diagrams
- Added DRM vs. forensic watermarking decision matrix
- Added signed/tokenized delivery URL guidance
- Added adaptive bitrate ladder, codec, and HLS/DASH/CMAF packaging reference
- Added scripts/cost_projector.py, a stdlib-only cost comparison tool across managed and self-hosted options
- Added three anti-patterns: synchronous public thumbnail generation, minutes-billed platform selection without volume projection, and DRM/watermarking conflation
