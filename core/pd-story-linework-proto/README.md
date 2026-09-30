# pd-story-linework-proto

Headless GPU prototype for the Story Linework treatment in pd-console.

This crate is an isolated workspace, following `core/pd-harbor-proto` and
`core/pd-flag-proto`: it is not listed in `core/Cargo.toml`, so ordinary Rust CI
does not compile wgpu/Metal work by accident.

The prototype renders a deterministic operator-specimen still to PNG frames:

- split hero/console blocks from `docs/design/story-linework`
- clearer panel enclosures and corner ticks as hard operator boundaries
- two-block signal flags and provenance chips
- honest pending/unknown/recovering/confirmed/dead-letter lanes with distinct shapes
- localized paper grain and specimen-card texture suitable for a later GPUI render-to-texture pass

## Run

```sh
cd core/pd-story-linework-proto
cargo run --release
bash scripts/render-gif.sh
```

Useful env:

```sh
PD_STORY_WIDTH=1280 PD_STORY_HEIGHT=720 PD_STORY_FRAMES=120 cargo run --release
PD_STORY_THEME=light PD_STORY_MOTION=0 cargo run --release
```

## Promotion Path

1. Keep this crate headless for fast iteration and deterministic visual proof.
2. Port winning shader ideas into a GPUI companion view as a texture-backed
   substrate.
3. Validate on the pd-proof virtual display with stills and video before touching
   production pd-console panes.
