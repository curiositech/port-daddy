# Privacy-Preserving Location Fuzzing

Read this when designing how a user's location is displayed to *other* users on a proximity
map, or when reviewing whether a proximity feature leaks exact positions. This is not optional
polish — any app that shows one user's location to another user must fuzz it by default.

## The core rule

**Never send another user's exact GPS coordinate to the client by default.** Not "encrypted,"
not "only visible on hover," not "rounded to 5 decimal places" (that's still ~1m precision).
The server computes a fuzzed/derived value and that is the only thing that reaches the viewer's
device. The exact coordinate should not exist in the response payload at all — not hidden in a
field the UI happens not to render, since any authenticated client can read the raw API/WS
response.

## Fuzzing techniques, in order of how much precision they remove

1. **Distance band** (coarsest, safest): show "within 500m" / "1-2 km away" instead of a number.
   No bearing, no dot on a map — just a tier. Use this for the most sensitive contexts (e.g. an
   app where "nearby" itself is sensitive information).
2. **Grid-cell snap**: snap the displayed position to the centroid of its H3 cell or geohash
   cell rather than the true point. Precision is bounded by cell size (choose resolution
   deliberately) and every user in the same cell renders at the same point, which itself hides
   individual position within the cell.
3. **Randomized jitter**: add a random offset within a radius (e.g. uniformly sample a point
   inside a disc of radius R around the true location, or use a random bearing + random distance
   up to R) before sending to the client. Regenerate the jitter periodically (not on every
   request) so repeated queries can't be averaged to triangulate the true point — averaging many
   *independent* jittered samples converges back toward the true location, which is the classic
   attack against naive per-request re-jittering.
4. **Precise/exact sharing (opt-in only)**: some features genuinely need the real point — e.g.
   confirming two users have arrived at the same meetup spot. This must be a distinct, explicit,
   time-boxed opt-in ("share exact location with this person for the next 15 minutes"), never
   the default state, and should be revocable.

## Fuzz radius should scale with zoom level

When the viewer is zoomed out (looking at a whole city), a few hundred meters of fuzz is
invisible and irrelevant. When the viewer is zoomed in tight, that same fuzz radius becomes
either uselessly imprecise or — if too small — reveals close to the true point. Scale the fuzz
radius as a function of the current map zoom level (or the distance between viewer and subject):
more fuzz at low zoom / large distance, progressively tighter fuzz as zoom increases, with a
floor that is never below your minimum acceptable radius (do not let zoom scaling degrade to
near-zero fuzz just because the user zoomed in far).

```python
# Roughly halve fuzz radius per 2 zoom levels, clamped to [min_radius, max_radius]
def fuzz_radius_meters(zoom: int, min_radius=75, max_radius=1500) -> float:
    scale = 2 ** (-(zoom - 10) / 2)
    return max(min_radius, min(max_radius, max_radius * scale))
```

## Where the exact coordinate lives

Store the exact coordinate server-side only, and only as long as a real feature needs it (e.g.
computing "who is nearby" in the first place requires the real point on the server — fuzzing
happens at serialization, not at storage). Do not:
- Log exact coordinates to general-purpose application logs
- Include exact coordinates in analytics events sent to third-party SDKs
- Expose exact coordinates through any endpoint another user's client can reach, including
  debug/admin endpoints, unless that endpoint is itself access-controlled and audited for a
  specific compliance/safety reason (e.g. a law-enforcement request pipeline)

## Regulatory context (as of 2026)

GDPR and most US state privacy laws treat precise geolocation as sensitive personal data
requiring an explicit legal basis and, in several frameworks, opt-in consent for precise
location sharing specifically (as opposed to coarse/approximate location). Treat "fuzz by
default, precise by explicit time-boxed opt-in" as the compliance-aligned default, not just a UX
nicety — verify against current requirements in your target jurisdictions before shipping.
