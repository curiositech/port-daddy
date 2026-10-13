# Live Update Delivery and Map Tile Rendering

Read this when designing how position updates reach viewers' maps in real time, or when
choosing a map-tile rendering stack for a proximity-social feature.

## Push, not poll

Deliver position updates over a persistent connection (WebSocket, or a managed realtime
service backed by one) rather than polling an HTTP endpoint on an interval. Polling wastes
requests when nothing changed and adds latency up to the poll interval when something did.
A WebSocket channel per active map viewer, subscribed to the geographic area currently in view
(or the H3/geohash cells currently on screen), is the standard shape.

## Throttle both ends — this is the part people skip

A live "who's nearby" map has two independent rates that both need throttling, and forgetting
either one produces the same symptom: excessive updates for no user-visible benefit.

### Client publish rate

Don't send a position update on every raw GPS tick (which can fire multiple times per second).
Debounce or batch: publish on a fixed interval (e.g. every 3-5 seconds) OR only when the device
has moved past a meaningful threshold (e.g. >10m), whichever the product needs. A stationary
user should not be generating a steady stream of identical-position updates.

```javascript
// Debounce-by-distance-or-time publish
let lastSent = { lat: null, lng: null, t: 0 };
function maybePublish(pos) {
  const now = Date.now();
  const movedEnough = lastSent.lat === null ||
    haversineMeters(pos, lastSent) > 10;
  const timeElapsed = now - lastSent.t > 4000;
  if (movedEnough || timeElapsed) {
    publishPosition(pos);
    lastSent = { lat: pos.lat, lng: pos.lng, t: now };
  }
}
```

### Server fan-out rate

Don't push every nearby user's tiny movement to every viewer the instant it happens. A popular
area with hundreds of visible users generating updates every few seconds turns into a firehose
that redraws every viewer's map far more often than a human eye needs. Coalesce: buffer updates
server-side over a short window (e.g. 1-2 seconds) and flush a single batched diff per viewer
per window, rather than one WebSocket message per moved user. This bounds both server egress
and client re-render cost independent of how many users are in view.

## Map tile rendering: MapLibre GL vs Google Maps

| | MapLibre GL (open-source) | Google Maps JS API |
|---|---|---|
| Cost model | Free engine; pay only for tile hosting/provider (or self-host) | Per-load billing at scale |
| Styling control | Full custom vector styles, full branding control | Limited — Google's visual language, restricted customization |
| Base map data quality | Depends on tile provider (varies) | Best-in-class street-level detail in most markets |
| Vendor lock-in | None — swap tile providers freely | Locked to Google's pricing and terms |
| Setup speed | Slower — you choose/host a tile provider | Fastest — drop in an API key |

**For a proximity-social feature where brand styling matters and usage scales with active
users** (i.e. cost is roughly proportional to map loads, which grows with your best-case
outcome), MapLibre GL with a self-hosted or third-party vector tile provider is usually the
better long-term choice: cost stays predictable as usage grows, and a custom map style is
often part of the product's visual identity (dark mode, custom pins, branded color palette).
Reach for Google Maps when integration speed matters more than long-term cost/branding control,
or when you need Google's specific base-map data quality (e.g. business listings, street view
integration) that a vector tile provider doesn't match.
