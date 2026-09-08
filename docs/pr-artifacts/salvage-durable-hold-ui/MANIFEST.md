# Durable salvage holds: synthetic UI proof

This is a **sampled browser capture of one real sequential synthetic interaction**, not continuous video, native Porthole capture, or installed-daemon proof. No operator window, transcript, credential, microphone, or background media was captured.

## Source and boundaries

- Source checkpoint: `f600f0c9424d2efd3f21f5c126e49d31a66ef6e3`; base: `fde658313c45572b56896cff0a1b81e4e8f3afbd`.
- `AgentsPanel.tsx` SHA-256: `67c7a4ef1edc6a5ad493f0b02e7388f007fdeffdd7bac31e4d7cbdd154b24260`.
- Capture helper SHA-256: `6da7912cbe12bef6d0dab1989282b1732e5a34914e26925d66f687d71f69937a`.
- Built JavaScript SHA-256: `640135006969c74f9bc6974efd486cf796e71bb672f9a212d8a020e8feda8bc5` (`index-BCemIVDN.js`). Generated build stays outside Git under the worktree's `.portdaddy` directory.
- The fixture binds an OS-selected loopback port, serves only its own built UI and synthetic data, refuses mutations, and has no daemon proxy. Its CSP blocks remote fonts/media/connections.
- The backend hold contract is companion work. This UI does not introduce a hold-clearance endpoint, cancel a prior admission, or prove a process is running.

## Evidence

[Play the sampled interaction](sampled-browser-capture.webm). The five phases are dark dormant, earlier admission, ordinary same-role sibling, refresh retaining that exact sibling, and light dormant. All 30 original JPEG frames remain under `frames/`; acquisition timestamps, phases, and actions remain in [sampled-capture.json](sampled-capture.json).

| Still | Exact unedited source |
| --- | --- |
| [Dark dormant](dark-dormant.jpg) | `frames/frame-0005.jpg` |
| [Earlier admission](dark-admitted.jpg) | `frames/frame-0011.jpg` |
| [Ordinary sibling](dark-ordinary.jpg) | `frames/frame-0017.jpg` |
| [Light dormant](light-dormant.jpg) | `frames/frame-0029.jpg` |

The stills above are copies of recorded frames, not separately timed captures. JPEG magic bytes were verified before naming frames `.jpg`. The first-to-last acquisition span is **7,009 ms**, at 1280 × 720. Requested minimum interval was 180 ms; actual acquisition gaps are preserved. No interpolation, transitions, invented cursor motion, or audio was added.

The WebM SHA-256 is `55635a3eeb3614e109c83627aac98fecd0051c9064641c5fcfb946337f396a48`. Every encoded frame's millisecond presentation timestamp was checked against its recorded acquisition offset; all 30 matched. Every original frame's byte count matched the manifest. The four stills were checked byte-for-byte against their named frames.

## Reproduction and validation

From `fleet-config-ui`, run `npm ci --ignore-scripts`, `npm test`, and `npm run build -- --outDir ../.portdaddy/salvage-hold-built`. From the repository root, run `node --test docs/pr-artifacts/salvage-durable-hold-ui/proof-server.test.mjs`, then `node docs/pr-artifacts/salvage-durable-hold-ui/proof-server.mjs`.

Use the existing documented Browser runtime to inspect that synthetic URL. The capture helper accepts that already-selected tab; it does not launch an alternate browser controller. Check the fixture marker before capture. Stop only the fixture process after review; never restart the canonical daemon for this proof.

From this artifact directory, the actual encoding command was:

```sh
ffmpeg -hide_banner -loglevel error -n -safe 0 -i sampled-frames.ffconcat \
  -fps_mode vfr -enc_time_base 1:1000 -c:v libvpx-vp9 -lossless 1 -an \
  sampled-browser-capture.webm
```

Owner validation: **91/91** UI tests, TypeScript build, and **1/1** read-only fixture test passed. Independent manager validation: **16/16** focused hold tests passed, with live dark/light render review. The known pre-existing large-bundle warning remains; it is not a failed build.

Native Porthole integration and native/mobile viewport capture are not demonstrated by these artifacts. The visual proof covers this legacy dashboard parity repair, not a new planning or identity authority.
