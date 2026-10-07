# DRM vs. Forensic Watermarking

Read this when deciding whether a video platform needs DRM, watermarking,
both, or neither — and when picking a multi-DRM vendor.

## Two different threats, two different controls

It is a common mistake to treat "content protection" as one checkbox. DRM
and watermarking address different attack surfaces and neither substitutes
for the other.

### DRM (Widevine / FairPlay / PlayReady)

- **What it does**: Encrypts the stream so playback requires a licensed
  player/SDK holding a valid decryption license. This is a *preventive*
  control — it stops the file from being usable outside an approved player.
- **What it does NOT stop**: The "analog hole" — pointing a phone camera at
  a screen, or using OS-level screen recording, captures the decoded output
  after DRM has already done its job of decrypting for display. DRM has no
  visibility into what happens to pixels once they're on screen.
- **Implementation cost**: High. Requires a multi-DRM service (e.g., a
  vendor that packages Widevine + FairPlay + PlayReady licenses together,
  since no single DRM system covers all browsers/devices), licensed player
  SDKs on every client platform, and license-server integration. This is a
  meaningful ongoing engineering and vendor-cost commitment.
- **When it's worth it**: High-value licensed or paid content (movies, live
  pay-per-view, enterprise training with strict licensing terms) where
  blocking casual downloads and unauthorized redistribution of the *file
  itself* is the actual requirement — often because a content licensor
  contractually requires it.

### Forensic / invisible watermarking

- **What it does**: Embeds a unique, typically imperceptible identifier
  (per-session, per-account, or per-viewing-instance) into the decoded video
  frames themselves — via pixel-domain or frequency-domain encoding that
  survives re-encoding and, to varying degrees, screen recording. This is a
  *detective*, not preventive, control.
- **What it does NOT stop**: Nothing about capture is prevented. A user can
  still screen-record or re-upload the content freely.
- **What it enables**: If a watermarked copy leaks and is found circulating,
  the embedded identifier can be extracted and traced back to the exact
  session or account that captured it — enabling account-level enforcement
  (ban, legal action, access revocation) after the fact.
- **Implementation cost**: Lower than full multi-DRM. Typically an encoder
  step in the delivery path (some managed platforms and specialist vendors
  offer this as an add-on) rather than a client-side SDK and license-server
  integration.
- **When it's worth it**: UGC platforms, creator platforms, or any product
  where the actual business risk is "leaked clips circulating and we need to
  find and act on the source," and where requiring every viewer to use a
  DRM-licensed player would be excessive friction relative to the threat.

## Decision matrix

| Your situation | Recommendation |
|---|---|
| Licensed movies/TV, contractual DRM requirement from studio | Full multi-DRM. Non-negotiable — the content owner requires it. |
| Live pay-per-view events, high per-stream revenue | Full multi-DRM, likely combined with watermarking for post-event leak investigation. |
| UGC platform, leak-tracing matters more than blocking casual capture | Per-session/per-account forensic watermarking, no DRM. Lower friction, matches the actual threat model. |
| Internal/enterprise training content, moderate sensitivity | Signed/tokenized URLs (see `references/signed-url-and-token-delivery.md`) may be sufficient without either DRM or watermarking, depending on sensitivity. |
| "We want to stop screen recording" | Neither DRM nor watermarking prevents this. No software-only control fully prevents the analog hole — set expectations accordingly. |

## Common mistake

Treating "DRM: yes" or "watermarking: yes" as a complete answer in a
security review without stating which threat it addresses. A reviewer
should be able to ask "what happens if this leaks via screen recording?" and
get a specific answer (traced via watermark ID → account X) rather than
"we have DRM so we're covered" — DRM does not answer that question.

## Related

See `references/safe-thumbnail-and-moderation-gate.md` for protecting content
*before* it's public, and `references/signed-url-and-token-delivery.md` for a
lighter-weight control (URL expiry/binding) that sits below full DRM in both
cost and strength.
