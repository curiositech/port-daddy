# Porthole System Specification, Architecture & Milestone Roadmap

**Status:** Canonical System Specification & Active Architecture Roadmap  
**Document Identity:** `docs/architecture/PORTHOLE-SYSTEM-SPECIFICATION-AND-MILESTONES.md`  
**Classification:** Core Devtool & Evidence Subsystem (Native macOS + Web Replay)  
**Date:** September 2026  
**Author:** Port Daddy Systems & Antigravity Manager  

---

## 1. Executive Summary & The Finished End-State

### What is Porthole?
Porthole is the **privacy-safe, deterministic evidence, continuity, and flight-recorder layer for autonomous software engineering**. 

In an agentic OS, software is no longer authored by a single person typing linearly into an editor; it is generated, tested, and refactored by autonomous agent swarms running concurrently across multiple worktrees, terminals, and graphical applications. When an agent succeeds, fails, or makes a contested decision, conventional logs ("sludge") and unindexed screen recordings ("surveillance video") fail to answer the fundamental operational question:
> **"What did the worker see, what authority did it possess, what exact sequence of causal events led to this state, and how can we safely inspect and counterfactually repair it?"**

Porthole solves this across two tightly integrated planes:
1. **The TUI / Terminal Plane:** Captures multi-pane terminal sessions (tmux, interactive shells, test runners) into byte-accurate, selectable, scrollable terminal cassettes (`.cast`) bound to causal process events, tool invocations, and context compactions.
2. **The Native GUI Plane (`apps/porthole-stage-capture`):** Captures single operator-approved macOS applications or windows via Apple ScreenCaptureKit with pre-persistence Data Loss Prevention (DLP), zero ambient desktop leakage, system audio/microphone hard-off, and cooperative agent+human multi-cursor overlays.
3. **The Web Replay & Audit Plane (`website-v2/src/components/porthole`):** Synchronizes terminal streams and graphical window recordings into an interactive inspector featuring jump-cuts over idle waiting periods, click ripples, and cryptographic evidence receipts.

---

## 2. Root Cause Analysis: The Video-Wiping Bug

### The Problem
During recent manual testing of `Porthole.app`, stopping an active screen recording wiped/deleted the video file from disk instead of preserving it.

### Code Investigation & Root Cause
In `apps/porthole-stage-capture/Sources/PortholeStageCore/ScreenCaptureSession.swift` (lines 1370–1425), the shutdown and finalization sequence was authored specifically for the automated CI synthetic proof harness (`SafeFixtureAttestor`), with a fail-closed gate that inadvertently destroys interactive recordings:

```swift
// ScreenCaptureSession.swift lines 1372-1383:
let manifest = finalizeProof && !proofInvalidated ? proofManifest(recorder: recorder) : nil
let proofOutput = proofConfiguration?.outputDirectory
var work = CaptureShutdownWork(
    approval: manifest?.sourceApproval,
    closeDelivery: {},
    stop: { deadline in
        if let stoppingStream { try await Self.stop(stoppingStream, deadline: deadline) }
    },
    finalize: { deadline in
        if manifest != nil, let recorder { try await recorder.finish(deadline: deadline) }
        else { recorder?.cancel() }   // <--- BUG: Aborts and wipes writer!
    },
    publish: {
        guard let manifest, let proofOutput else { return nil }
        return try ProofArtifactWriter.write(manifest: manifest, outputDirectory: proofOutput)
    },
    cancel: { recorder?.cancel() }
)
```

1. **Why `manifest` was `nil`:**  
   In `proofManifest(recorder:)` (lines 1438–1454), the method guards on:
   ```swift
   guard let recorder,
         proofConfiguration != nil,
         let safeFixtureAttestation,
         ...
   ```
   When an operator runs the application interactively to record an arbitrary desktop window (e.g. Safari, Xcode, Terminal, or a web app):
   - `proofConfiguration` is `nil` (only set during headless CLI `--record-proof` test runs).
   - `safeFixtureAttestation` is `nil` (because the target window is a real user application, not the synthetic test fixture app).
   - Therefore, `proofManifest(...)` returns `nil`.

2. **The Destructive Cancellation:**  
   Because `manifest == nil`, the `finalize` closure executes the `else` branch:
   ```swift
   else { recorder?.cancel() }
   ```
3. **Why the file vanished:**  
   In `ApprovedProofRecorder.swift` (line 172):
   ```swift
   func cancel() {
       ...
       DispatchQueue.global(qos: .utility).async { [writer] in writer.cancelWriting() }
   }
   ```
   In macOS AVFoundation, calling `AVAssetWriter.cancelWriting()` immediately aborts the write session and **deletes/unlinks the output file on disk**.
4. **UI Labeling:**  
   In `StageView.swift` line 395, the primary stop control was literally hardcoded as:
   ```swift
   Label("Stop & Clear", systemImage: "stop.fill")
   ```
   with the tooltip: *"Proof cannot pause or resume in this slice. Stop & Clear finalizes its one immutable media segment."*

### The Fix Architecture
- Decouple **Video Container Finalization** from **Cryptographic Proof Manifest Publication**:
  - Whenever an `ApprovedProofRecorder` has recorded frames (`frameCount > 0`), stopping the recording must call `recorder.finish(deadline:)` to flush H.264 video tracks and finalize the QuickTime/MP4 container properly.
  - Only if the write failed or the user explicitly clicks "Discard/Cancel" should `writer.cancelWriting()` be called.
- Add an interactive file destination picker / default directory (`~/Movies/Porthole/` or `./artifacts/`).
- Add a dedicated **Screenshot Capture Button & Shortcut** (`Cmd+Shift+S`) to capture the current high-resolution frame directly to a timestamped PNG without starting/stopping a video session.

---

## 3. How Porthole Records Arbitrary GUIs for the Website & Documentation

To generate product videos, feature walkthroughs, and visual proof for `portdaddy.dev` without human jitter, leaking host secrets, or requiring manual screen recording:

```
┌─────────────────────────────────────────────────────────────┐
│                      Agent Laboratory                       │
│        (Deterministic Interaction Script / Headless Play)   │
└──────────────────────────────┬──────────────────────────────┘
                               │ Dispatches synthetic input
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Target Window / GUI Harness                 │
│         (SwiftUI App / Web App / Electron / Terminal)       │
└──────────────────────────────┬──────────────────────────────┘
                               │ Native SCStream (ScreenCaptureKit)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Porthole Stage Capture Core                 │
│   - Single-Window Isolation (No ambient desktop bleed)      │
│   - System Audio / Microphone: Hard-Off                     │
│   - Pre-Persistence DLP (Canary & secret scrubber)          │
│   - Injected Multi-Agent Cursor Overlay                     │
└──────────────────────────────┬──────────────────────────────┘
                               │ Bounded H.264 Segments (600 ticks)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                  Porthole Media Pipeline                    │
│   1. QuickTime/MP4 Raw Master (`.mov`)                      │
│   2. WebM Export (VP9/AV1, web-optimized bitrate)           │
│   3. Animated Preview (WebP / AVIF)                         │
│   4. High-Res Keyframe Screenshots (`.png`)                 │
│   5. Event Telemetry Sidecar (`.json` with cursor/clicks)   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             Website V2 Replay & Documentation               │
│          (`<PortholePlayer />` + Proof Galleries)           │
└─────────────────────────────────────────────────────────────┘
```

### Technical Workflow for Arbitrary GUI Capture:
1. **Target Selection via Window Identity:** ScreenCaptureKit isolates the exact window ID or bundle ID. Even if the window moves behind other windows or sits in an off-screen virtual display space, capture remains sharp and un-obscured.
2. **Headless Scripted Interaction:** Synthetic clicks, drags, and keystrokes are injected via macOS accessibility APIs or browser automation at exact millisecond intervals.
3. **Multi-Agent Visual Telemetry:** Agent actions render custom tinted pointer pills (e.g. `◆ Nora`, `◆ Milo`, `◆ Operator`) directly on the video stream, showing intent before actuation.
4. **Automated Asset Generation:**
   - `./scripts/porthole-record.sh --window "Port Daddy FleetBar" --duration 8s --out website-v2/public/casts/fleetbar-tour.webm`
   - Emits both the video and a synchronized JSON sidecar mapping time offsets to user actions, terminal logs, and system events.

---

## 4. Upcoming Milestones & Delivery Roadmap

```
Milestone 1: Interactive Stop & Save Fix + Direct Screenshot Button [CURRENT]
     │
     ▼
Milestone 2: Headless Scriptable GUI Recorder CLI (`pd porthole record`)
     │
     ▼
Milestone 3: Rust Kernel Vault Sealing & ADR-0120 Storage Integration
     │
     ▼
Milestone 4: Unified Replay Web Player 2.0 (Synchronized GUI + TUI)
     │
     ▼
Milestone 5: Production macOS Signing, Notarization & FleetBar Tray Integration
```

### Milestone 1: Interactive Recording Fix & Instant Screenshots (Target: Immediate)
- **Goal:** Transform `apps/porthole-stage-capture` into a reliable daily-driver tool for recording any screen or window and taking instant screenshots.
- **Deliverables:**
  1. Fix `ScreenCaptureSession.swift` so `stopCapture()` finalizes and flushes `stage-source.mov` even when `proofConfiguration` is `nil`.
  2. Implement `Take Screenshot` button and `Cmd+Shift+S` hotkey: saves full-resolution uncompressed PNG with metadata to `~/Movies/Porthole/Screenshots/`.
  3. UI refresh: Replace `Stop & Clear` with `Stop & Save` and `Discard`.
  4. Automatic export to MP4/WebM via bundled AVFoundation pipeline.

### Milestone 2: Headless Scriptable GUI Recorder CLI (Target: Milestone 2)
- **Goal:** Enable autonomous subagents and CI scripts to record arbitrary GUIs and generate website proof automatically.
- **Deliverables:**
  1. `pd porthole record` CLI command accepting `--window-id`, `--app-name`, `--duration`, and `--script`.
  2. Integration with Agent Laboratory: record test runs and error repros as video artifacts.
  3. Format converter: automated emission of high-density WebM (VP9/AV1), optimized MP4, and animated WebP previews.
  4. Telemetry sidecar generation: recording cursor paths, click coordinates, and active terminal logs into JSON.

### Milestone 3: Cryptographic Sealing & Vault TCB Integration (Target: Milestone 3)
- **Goal:** Implement the full security and privacy guarantees specified in ADR-0050 (Coast Guard) and ADR-0120.
- **Deliverables:**
  1. Wire `SealedCaptureStore.swift` to the Rust `pd-vault` FFI boundary.
  2. Enforce the storage budget: 20 GiB maximum quota, 10 GiB free-disk floor, 64 MiB segment envelope caps.
  3. Pre-persistence DLP: scan for API keys, bearer tokens, and secrets in frame OCR/text buffers *before* disk write.
  4. Generate Ed25519 tamper-evident `CaptureReceipt` objects verifying capture integrity.

### Milestone 4: Unified Replay Web Player 2.0 (Target: Milestone 4)
- **Goal:** Provide a rich web experience on `portdaddy.dev` where visitors and operators can inspect complex agent behaviors.
- **Deliverables:**
  1. Upgrade `website-v2/src/components/porthole`: synchronized side-by-side terminal cast (`.cast`) and GUI video (`.webm`).
  2. Interactive scrubbing timeline with marked jump-cuts across idle periods.
  3. Clickable decision points linking directly to causal Git diffs and Port Daddy session notes.

### Milestone 5: Production macOS Release & FleetBar Companion (Target: Milestone 5)
- **Goal:** Distribute Porthole as a notarized, zero-friction companion to the Port Daddy Agentic OS.
- **Deliverables:**
  1. Apple Developer ID code signing and notarization pipeline.
  2. Persistent TCC Screen Recording permissions that survive app updates.
  3. FleetBar menu bar integration: one-click window capture and agent session recording from the system tray.

---

## 5. Security, Privacy & Non-Goals

### Privacy Invariants
1. **Zero Ambient Bleed:** Never record the whole desktop display by default; recording is strictly scoped to the user-selected application window.
2. **Audio Hard-Off:** Microphone and system audio tracks are completely excluded and disabled at the hardware session configuration level.
3. **Pre-Persistence DLP:** Sensitive credentials discovered in memory are dropped/redacted before writing ciphertext.
4. **Local-First Custody:** All media remains on the operator's machine unless explicitly exported or synchronized via authorized zero-trust channels.

### Explicit Non-Goals
- Porthole is **not** an employee-monitoring surveillance daemon.
- Porthole does **not** record background audio or personal ambient keystrokes.
- Porthole does **not** upload unencrypted media to any cloud service.
