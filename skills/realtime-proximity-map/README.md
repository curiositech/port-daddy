# Realtime Proximity Map

Architectural guidance for building a real-time "who's nearby" map feature -- the
Sniffies/Grindr/Zenly pattern -- covering geospatial indexing, privacy-preserving location
fuzzing, live update delivery, and map tile rendering choices.

## Structure

```
realtime-proximity-map/
|-- SKILL.md                              # Core decision trees + anti-patterns (<500 lines)
|-- CHANGELOG.md                          # Version history
|-- README.md                             # This file
`-- references/
    |-- geospatial-indexing.md            # PostGIS vs geohash vs H3 vs Redis GEO, with code
    |-- privacy-fuzzing.md                # Fuzzing techniques, zoom scaling, regulatory notes
    `-- live-updates-and-tiles.md         # WebSocket throttling, fan-out, MapLibre vs Google Maps
```

## Quick Start

1. Read SKILL.md for the core architecture and the four-way indexing decision tree
2. Pull the matching reference file when you need code-level detail on indexing, fuzzing, or
   transport
3. Check the Anti-Patterns section before shipping -- exact-coordinate leaks and geohash
   boundary bugs are the most common mistakes in this domain

## See Also

- `large-scale-map-visualization` -- for general map tile pipelines and static geographic data
  visualization at scale (this skill is specifically about live user-proximity features)
- `realtime-messaging-backend-architecture` -- for the chat layer once two nearby users connect
- `websocket-realtime-expert` -- for general WebSocket transport/reconnection mechanics
