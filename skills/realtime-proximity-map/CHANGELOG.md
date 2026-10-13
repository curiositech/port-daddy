# Realtime Proximity Map -- Changelog

## v1.0.0 (2026-09-19)

- Initial skill creation
- Core architecture: hot index (Redis GEO / H3) for live queries, durable DB at coarse write
  frequency, server-side fuzzing before serialization, throttled WebSocket fan-out
- Geospatial indexing decision tree: PostGIS vs geohash vs H3 vs Redis GEO
- Privacy-preserving location fuzzing reference: distance bands, grid-snap, jitter, zoom-scaled
  radius, opt-in precise sharing
- Live update delivery reference: client publish throttling, server fan-out coalescing,
  MapLibre GL vs Google Maps tile rendering comparison
- Three anti-patterns: exact-coordinate exposure, geohash prefix-matching without neighbor-cell
  checks, writing every position update to the primary transactional database
