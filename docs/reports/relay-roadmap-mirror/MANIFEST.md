# Visual evidence — relay roadmap command-center mirror (PR 1 of 4)

Provenance for every artifact in this directory. Precedent: `docs/reports/planner-gantt/*`.

## The honest framing, first

**This slice ships no operator-visible page.** PR 1/4 is a D1 replica plus two JSON
endpoints — `PUT /v1/roadmap/snapshot` and `GET /v1/roadmap/mirror`. The board and item
pages an operator will actually click are **PR 3 of 4**. There was nothing to screenshot
in the usual sense, and nothing here pretends otherwise:

- No artifact here is, or is styled as, a product surface. Every sheet carries a banner
  saying so, in the image itself.
- What *is* shown is the thing this slice really delivers: **the mirror holding a real
  roadmap**, proven by driving the real Worker and laying its real responses out for
  reading. The sheets are a rendering of `run-log.json`, which is committed beside them.
- Faking a page would have been the failure mode. Leaving the section empty (which is
  what the first push of this PR did, and what the operator called out) was the other one.

## Harnesses — read this before believing any sheet

Two harnesses produced the evidence. Every sheet states which one, in the image.

| Label | What it is | Why it is real |
| --- | --- | --- |
| **REAL WORKER** | `wrangler dev --local` → workerd + miniflare running **`apps/relay/src/index.ts` unchanged**, with a local D1 that had the **real migration chain** (all 15 `apps/relay/migrations/*.sql`, sorted — the same order the relay test suite and `check-migrations.mjs` use) applied by `wrangler d1 execute --local`. Requests are ordinary HTTP over `127.0.0.1`. | Routing, auth, guards, SQL, transactions and JSON serialisation are the shipped code paths — not a fake D1 and not a hand-called function. |
| **IN-PROCESS PROBE** | `rollback-probe.ts`: the real `src/roadmap-mirror.ts` bundled by the relay's own esbuild and run against a `node:sqlite` D1 adapter with the **same real migration chain** — the fixture idiom of `apps/relay/tests/roadmap-mirror.test.ts`. | Used for exactly one proof (sheet 06) and for a stated reason: see below. |

**Why sheet 06 is not real-Worker.** The mid-batch rollback can only be observed if a
statement *inside* `replaceRoadmapMirror`'s single `env.DB.batch()` fails. Over HTTP that
is unreachable by design — `validateSnapshotPayload` refuses `status:"someday"` with
**400 BAD_STATUS** before any storage work happens. That real HTTP refusal *is* captured
(sheet 05, step `g3`); the probe then bypasses only the request guard, calling
`replaceRoadmapMirror()` directly, to prove the transaction itself rolls back. Nothing
else on any sheet uses the probe.

## Data provenance — what is daemon-real and what is capture-authored

The roadmap pushed into the mirror is **real**: `docs/roadmap/roadmap.snapshot.json`, the
committed export that `scripts/export-roadmap-snapshot.ts` produced from the daemon —
279 items, `slug` / `status` / `summaryMd` passed through verbatim, and the daemon's own
`generatedAt` clock (`1787406790046` = 2026-08-22 13:53:10.046Z). Every item title,
summary and lane you see on sheet 02 is that export.

That export is deliberately minimal (a link-existence oracle), so it carries **no edges,
no activity tail and no tombstones**. To exercise those code paths the second push adds a
small augmentation, listed in full in `run-log.json` under `augmentation` and labelled on
every sheet that shows it:

| Value | Source |
| --- | --- |
| 279 items (slug / status / summaryMd) | **daemon-real** — verbatim from the committed export |
| `generatedAt` of push A (`1787406790046`) | **daemon-real** — the export's own clock |
| `harbor: "port-daddy"` | **daemon-real** — the export's own harbor |
| `receivedAt` on every read | **relay-real** — the Worker's clock at ingest |
| item `kind`, `priority`, `createdAt`, `lastTouchedAt` defaults | **relay-real** — the mirror's own documented defaults, since the export omits them |
| edge `distribution-dogfood-gtm-strategy --parent_of--> accountability-wedge-launch-assets` | **derived from real roadmap text** — that item's real summary ends "Spawned by distribution-dogfood-gtm-strategy." |
| the other 3 edges (`roadmap-schema-wiring`, `roadmap-link-gate`, `adr-0090-phase-6-…`, `mcp-roadmap-receipt-parity`) | **capture-authored** — real slugs, authored relationships, so an item has edges in both directions |
| the 6-row activity tail | **capture-authored** — the export carries none |
| the tombstone on `adr-0049-relay-v0` | **capture-authored** — the export carries none |
| `generatedAt` of push B (export + 1 h) and of the empty push (export − 10 min) | **capture-authored** — a second and an earlier daemon push have to have their own clocks |
| `daemonLabel: "port-daddy-daemon"` | **capture-authored** — a display-only field the export omits |

`repoFullName` is `curiositech/port-daddy` (this repo). Accounts, `pdu_` tokens and the D1
database are throwaway: created in a temp dir at the start of the run and deleted at the
end. No Cloudflare account, no network, no real credentials are involved.

## Artifacts

Captured on branch **`claude/relay-roadmap-mirror`** at commit
**`3841a342c630436c81d14e0558560c5ce43eb1f0`** (the PR head — the code under review),
`2026-08-22T23:41:02Z`, wrangler 4.99.0, node v22.22.2. `run-log.json` records
`relayTreeClean: true` / `relayDirtyPaths: []`: `apps/relay/{src,migrations,schema.sql,tests}`
were exactly as committed while the capture ran — nothing was patched to make a sheet work.
(`provenance.dirtyPaths` shows the only untracked path was this evidence directory itself,
which necessarily post-dates the run it documents.)

Every artifact below was produced by one command:

```bash
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
  node docs/reports/relay-roadmap-mirror/capture.mjs
```

| Artifact | Bytes | Harness | Shows | sha256 |
| --- | ---: | --- | --- | --- |
| `01-null-states.png` | 648,044 | REAL WORKER | Four distinct null states: never-synced repo → 404 `NO_MIRROR`; a mirror that exists but is empty (watermark present, all five lanes `[]`, `itemCount: 0`); a *different* repo on the same account → 404; the *same* repo read by a *different* account → 404 (account scoping); plus an unknown slug → 404 `NO_ITEM`. | `49c20d7b925b0da053971a2035adc32f726b01abc0281eaa61829ec6bca2105f` |
| `02-mirror-board.png` | 1,111,921 | REAL WORKER | The mirror holding the real 279-item roadmap: the honest watermark (`generatedAt` daemon clock vs `receivedAt` relay clock, with the staleness subtraction shown — 8 h 48 m 25 s at capture time), the board grouped by the five status lanes with per-lane counts, the activity tail, and the two `PUT` responses side by side showing the full replace (`edgeCount 0 → 4`, `activityCount 0 → 6`, watermark advanced). | `9881d23b1b0860a1e57d01e09066b58afc1e4015e602a8d1f04ce8f3d5629eea` |
| `03-item-detail-edges.png` | 732,166 | REAL WORKER | `&slug=roadmap-link-gate`: the item in full, plus `edgesOut` (1, as source) **and** `edgesIn` (2, as target) — edges in both directions — and the verbatim response body. | `0d7e55a9bec0d40ad85c04665f161a7d3ea33bb74bfa09a6beb6787ab61c9f86` |
| `04-tombstone.png` | 611,482 | REAL WORKER | `&slug=adr-0049-relay-v0`: `deleted: true` with its `deletedAt`, cross-checked against the board read that does **not** contain it, and the `itemCount 279` (tombstones included) vs 278 live board items arithmetic. Beside it, the unknown-slug 404, so "deleted" and "never existed" are visibly different answers. | `143962aacb9581edc96995adaa13bb96fcc2d13786304b52c064353ae67b7402` |
| `05-payload-guards.png` | 570,265 | REAL WORKER | The refusals with the Worker's own strings: **413 `TOO_MANY_ITEMS`** (5001 items), **413 `PAYLOAD_TOO_LARGE`** (2,443,225-byte body), **400 `BAD_STATUS`**, **401 `UNAUTHENTICATED`** — then a read-back proving the mirror is byte-identical to before the four refusals. | `0449545a243cb03299e9c1aee60275a684f927b8dc0b9c1c3e648cca2e05febe` |
| `06-atomic-rollback.png` | 801,667 | **IN-PROCESS PROBE** | A poisoned snapshot leaves the previous one intact, before → after side by side: the batch throws `CHECK constraint failed: status IN ('now','backlog','parked','merge','done')`, the watermark stays at the surviving snapshot (the attempted one never lands), all five lane counts are unchanged, and 279 item rows remain — so the `DELETE` half of the batch rolled back too. Carries its own "why not over HTTP" note. | `3ca95bad33644180c9d56de2b54fe1947e9f6a0125fddf15326c80021a28e04d` |
| `walkthrough.webm` | 889,429 | REAL WORKER | 11.1 s, 1280×780, VP8. The motion artifact: the same `GET /v1/roadmap/mirror` at four points of a real push sequence — never synced (404) → empty roadmap pushed (watermark, zero items) → real 279-item export pushed → re-pushed (full replace: watermark advances, the tombstoned slug goes from present to **absent** on the board, activity tail 0 → 6). Recorded by Playwright (`recordVideo`) driving the sheet through the four captured states. | `8509abbd94236a1a473470186d72304ea32e3a51b681f4206b93855732a23d24` |
| `run-log.json` | 652,521 | both | The raw evidence: provenance block, the migration list, the augmentation manifest, all **17 real-Worker request/response pairs verbatim**, and the probe result. Every number on every sheet is in here. | `154d65e034d0fe1a57e951dc05cbb4ba12401ea1ed2ada3115de4c75cc62c805` |
| `sheets/*.html` | 112 KB total | — | The exact HTML the screenshots were taken of, kept so a reviewer can open and search them rather than squinting at a PNG. Regenerated by `render.mjs`. | — |

A GIF was **not** produced: the only ffmpeg available here is Playwright's stripped build
(`--disable-everything`; no `palettegen`/`paletteuse`, no gif muxer), so `walkthrough.webm`
is the motion artifact. GitHub renders `.webm` inline in a PR body via `<video>`.

## Tooling committed alongside

| File | Role |
| --- | --- |
| `capture.mjs` | The whole pipeline: apply the migration chain → seed throwaway accounts → boot the real Worker → drive the 17 HTTP steps → run the probe → write `run-log.json` → call `render.mjs`. |
| `render.mjs` | `run-log.json` → six evidence sheets → PNGs + the walkthrough recording. It may only *lay out* values present in `run-log.json`; the sole computed value is the staleness delta, which is printed with its arithmetic (`receivedAt·1000 − generatedAt`) next to both operands. |
| `rollback-probe.ts` | The in-process transaction probe (sheet 06). |
| `wrangler.capture.toml` | Local-only wrangler config for `wrangler dev --local`. No credentials, no real resource ids — the D1/KV ids are placeholders miniflare only uses to name a local SQLite file. The `[ai]` binding is omitted (local dev proxies Workers AI to Cloudflare; no roadmap-mirror route touches it); every other binding matches the real config so the Worker boots unchanged. |

## Reproduction

```bash
# 1. relay deps (provides wrangler + workerd + esbuild); node >= 22 for node:sqlite
cd apps/relay && npm ci && cd ../..

# 2. capture — boots the real Worker on 127.0.0.1:8799 (override with PORT=…),
#    rewrites every PNG, walkthrough.webm and run-log.json in this directory
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
  node docs/reports/relay-roadmap-mirror/capture.mjs

# 3. re-render only (no Worker, no D1 — replays the committed run-log.json)
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
  node docs/reports/relay-roadmap-mirror/render.mjs
```

Step 2 is not byte-reproducible and is not meant to be: `receivedAt`, the request ids and
the staleness delta come from the clock at capture time, so the sha256s above pin *these*
artifacts, not future runs. Step 3 **is** deterministic from the committed `run-log.json`
(modulo font rasterisation), which is what makes the sheets auditable: change a number in
a sheet and it will no longer match the log committed beside it.

Everything runs offline. `wrangler` prints a "Proxy environment variables detected"
warning in this environment; nothing in the capture leaves `127.0.0.1`.

## Not captured here

- **`/account/export` and erasure (ADR-0101) and the retention-sweep activity cap.** Real
  behaviours in this diff, covered by `apps/relay/tests/roadmap-mirror.test.ts` and
  `tests/retention-sweep.test.ts`, but they produce no read-model surface worth a sheet —
  an export JSON blob screenshot would be padding, not evidence.
- **Anything resembling the operator's board/item pages.** They do not exist yet. PR 3/4.
