import AppKit
import ImageIO
import SwiftUI
import UniformTypeIdentifiers
import XCTest
@testable import FleetBar

private actor SquidHarnessVisualFixture {
    private var armed = false
    private var debugOverdue = false
    private var debugProbeState: String?

    func setDebugOverdue(_ value: Bool) { debugOverdue = value }
    func setDebugProbeState(_ value: String?) { debugProbeState = value }

    func run(_ arguments: [String]) -> SquidCommandResult {
        if arguments.starts(with: ["squid", "on"]) {
            armed = true
            return SquidCommandResult(status: 0, stdout: "armed", stderr: "")
        }
        if arguments.starts(with: ["squid", "debug"]) {
            return SquidCommandResult(
                status: 0,
                stdout: Self.debugJSON(overdue: debugOverdue, probeState: debugProbeState),
                stderr: ""
            )
        }
        return SquidCommandResult(
            status: 0,
            stdout: armed ? Self.liveJSON : Self.degradedJSON,
            stderr: ""
        )
    }

    private static let providers = """
      {"name":"Claude Code","slug":"claude","detected":true,"expectedScope":"project","wired":true},
      {"name":"Codex CLI","slug":"codex","detected":true,"expectedScope":"user","wired":true},
      {"name":"Gemini CLI","slug":"gemini","detected":true,"expectedScope":"project","wired":true},
      {"name":"Antigravity (agy)","slug":"agy","detected":true,"expectedScope":"user","wired":true}
    """

    private static let value = """
      "value": {
        "beforeTurn":"fresh context",
        "beforeEdit":"collision gate",
        "afterTool":"no per-tool process; cumulative session evidence"
      }
    """

    private static let degradedJSON = """
    {
      "schemaVersion":1,
      "state":"DEGRADED",
      "workspace":"/Users/operator/coding/port-daddy",
      "daemonAlive":true,
      "tentaclesStaged":true,
      "providers":[
        {"name":"Claude Code","slug":"claude","detected":true,"expectedScope":"project","wired":false},
        {"name":"Codex CLI","slug":"codex","detected":true,"expectedScope":"user","wired":true},
        {"name":"Gemini CLI","slug":"gemini","detected":true,"expectedScope":"project","wired":false},
        {"name":"Antigravity (agy)","slug":"agy","detected":true,"expectedScope":"user","wired":false}
      ],
      "identity": {
        "statuslineStaged":true,
        "statuslineProject":false,
        "statuslineUser":false,
        "slashCommand":false,
        "pilotSessionStart":false,
        "daemonAlive":true
      },
      \(value)
    }
    """

    private static let liveJSON = """
    {
      "schemaVersion":1,
      "state":"LIVE",
      "workspace":"/Users/operator/coding/port-daddy",
      "daemonAlive":true,
      "tentaclesStaged":true,
      "providers":[\(providers)],
      "identity": {
        "statuslineStaged":true,
        "statuslineProject":true,
        "statuslineUser":false,
        "slashCommand":true,
        "pilotSessionStart":true,
        "daemonAlive":true
      },
      \(value)
    }
    """

    private static func debugJSON(overdue: Bool, probeState: String?) -> String {
        let editState = overdue ? "overdue" : "running"
        let capturedAt = overdue ? "2026-08-21T20:00:02.400Z" : "2026-08-21T20:00:00.600Z"
        let editDescription = overdue
            ? "PD EDIT is checking project ownership and destructive-command safety before mutation. No completion arrived by the deadline, so the hook is stalled or the host terminated it."
            : "PD EDIT is checking project ownership and destructive-command safety before mutation. It is still inside its configured deadline."
        let health = probeHealthJSON(probeState)
        return """
        {
          "schemaVersion":1,
          "enabled":true,
          "enabledAt":"2026-08-21T20:00:00.000Z",
          "capturedAt":"\(capturedAt)",
          "workspace":"/Users/operator/coding/port-daddy",
          "privacy":"Sanitized timing only: no argv, environment snapshot, prompts, tool inputs, tool results, stdout, or stderr are captured.",
          "retention":{"maxBytes":2097152,"eventPath":"/Users/operator/.port-daddy/squid/hook-events.log"}\(health),
          "sessions":[
            {
              "id":"codex-codex:7312-port-daddy",
              "runtimeSessionId":"codex:7312",
              "provider":"codex",
              "providerLabel":"Codex",
              "workspace":"/Users/operator/coding/port-daddy",
              "workspaceLabel":"port-daddy",
              "state":"\(editState)",
              "startedAt":"2026-08-21T20:00:00.000Z",
              "lastActivityAt":"2026-08-21T20:00:00.200Z",
              "steps":[
                {
                  "id":"codex-turn-1","phase":"turn","label":"PD TURN","hook":"pd-hook-prompt","state":"completed",
                  "startedAt":"2026-08-21T20:00:00.000Z","expectedBy":"2026-08-21T20:00:01.000Z","finishedAt":"2026-08-21T20:00:00.118Z",
                  "durationMs":118,"deadlineMs":1000,"outcome":"executed","exitCode":0,
                  "description":"PD TURN is gathering fresh coordination context before the agent begins this turn. The hook completed normally."
                },
                {
                  "id":"codex-edit-1","phase":"edit","label":"PD EDIT","hook":"pd-hook-pre-tool","state":"\(editState)",
                  "startedAt":"2026-08-21T20:00:00.200Z","expectedBy":"2026-08-21T20:00:01.200Z","finishedAt":null,
                  "durationMs":null,"deadlineMs":1000,"outcome":null,"exitCode":null,
                  "description":"\(editDescription)"
                }
              ]
            },
            {
              "id":"claude-claude:8841-port-daddy",
              "runtimeSessionId":"claude:8841",
              "provider":"claude",
              "providerLabel":"Claude Code",
              "workspace":"/Users/operator/coding/port-daddy",
              "workspaceLabel":"port-daddy",
              "state":"skipped",
              "startedAt":"2026-08-21T19:59:58.000Z",
              "lastActivityAt":"2026-08-21T19:59:58.012Z",
              "steps":[{
                "id":"claude-trace-1","phase":"trace","label":"PD TRACE","hook":"pd-hook-post-tool","state":"skipped",
                "startedAt":"2026-08-21T19:59:58.000Z","expectedBy":"2026-08-21T19:59:59.000Z","finishedAt":"2026-08-21T19:59:58.012Z",
                "durationMs":12,"deadlineMs":1000,"outcome":"project_disarmed","exitCode":0,
                "description":"PD TRACE is a legacy post-tool record retained for migration diagnostics; current installs use cumulative session evidence instead. The gate skipped the hook because this project was not armed."
              }]
            }
          ]
        }
        """
    }

    private static func probeHealthJSON(_ probeState: String?) -> String {
        guard let probeState else { return "" }
        let active = probeState == "active"
        let state = active ? "half_open" : "open"
        let capturedAt = active ? "2026-09-01T03:13:50.000Z" : "2026-09-01T03:14:02.000Z"
        let recoveryReady = active ? "false" : "true"
        let remediation = active
            ? "A single bounded recovery probe is running. It should finish by 2026-09-01T03:13:53.035Z; no other hook call may probe concurrently."
            : "The previous recovery marker expired, so no probe is running. The next armed hook call may reclaim the marker and run one bounded probe, or choose Repair in FleetBar."
        return """
        ,"health":{
          "degraded":true,
          "capturedAt":"\(capturedAt)",
          "thresholds":{"consecutiveFailures":3,"slowMs":250,"cooldownMs":300000},
          "circuits":[{
            "hook":"pd-hook-prompt","label":"PD TURN","state":"\(state)","consecutiveFailures":9,
            "openedAt":"2026-09-01T01:17:37.000Z","retryAt":"2026-09-01T01:22:37.000Z",
            "lastReason":"slow","lastDurationMs":770,"lastExitCode":0,"updatedAt":"2026-09-01T01:17:37.000Z",
            "probeState":"\(probeState)","probeStartedAt":"2026-09-01T03:13:48.035Z",
            "probeExpectedBy":"2026-09-01T03:13:53.035Z","recoveryReady":\(recoveryReady)
          }],
          "remediation":"\(remediation)"
        }
        """
    }
}

private final class ContinuitySnapshotURLProtocol: URLProtocol {
    static let body = Data("""
    {
      "schemaVersion":1,
      "capturedAt":"2026-08-23T12:00:00.000Z",
      "counts":{"observed":2,"packetReady":1,"successorRequired":1,"continuing":0,"completed":0,"verificationFailed":0},
      "items":[
        {
          "agentNodeId":"agent-codex-context-1","sessionId":"session-codex-context-1","runId":"run-codex-context-1",
          "transcriptId":"transcript-codex-context-1","model":"gpt-5","sourceAdapter":"cli:codex",
          "envelopeId":"ctx_codex_1","measuredAt":"2026-08-23T11:59:59.000Z",
          "pressure":{"band":"critical","ratio":0.95,"action":"require_compaction_or_successor","windowTokens":76800,"usedTokensEstimate":72960,"estimateMode":"exact","strategy":"max-daemon-and-adapter","selfReportDrift":[]},
          "packet":{"packetId":"cpk_codex_1","createdAt":"2026-08-23T12:00:00.000Z","validatorPassed":true,"sourceHeadEventId":"evt_transcript_head_1","sourceHeadHash":"7ac9f0e3d831e68bc59c46b2ec3a0dc8","transcriptEventId":"evt_packet_1"},
          "handoffEpisodeId":42,"continuation":null,"readiness":"successor-required"
        },
        {
          "agentNodeId":"agent-claude-context-2","sessionId":"session-claude-context-2","runId":"run-claude-context-2",
          "transcriptId":"transcript-claude-context-2","model":"claude-sonnet-4-6","sourceAdapter":"cli:claude-code",
          "envelopeId":"ctx_claude_2","measuredAt":"2026-08-23T11:58:00.000Z",
          "pressure":{"band":"medium","ratio":0.63,"action":"prepare_compaction","windowTokens":120000,"usedTokensEstimate":75600,"estimateMode":"estimated","strategy":"max-daemon-and-adapter","selfReportDrift":[]},
          "packet":null,"handoffEpisodeId":null,"continuation":null,"readiness":"observed"
        }
      ],
      "failures":[]
    }
    """.utf8)

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor
final class SquidHarnessSnapshotTests: XCTestCase {
    func testRenderContextContinuityProofWhenRequested() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let outputDirectory = env["FLEETBAR_SQUID_SNAPSHOT_DIR"], !outputDirectory.isEmpty else {
            throw XCTSkip("Set FLEETBAR_SQUID_SNAPSHOT_DIR to render context continuity evidence.")
        }

        let fixture = SquidHarnessVisualFixture()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ContinuitySnapshotURLProtocol.self]
        let store = SquidHarnessStore(
            baseURL: "https://continuity.snapshot",
            session: URLSession(configuration: configuration)
        ) { arguments in await fixture.run(arguments) }
        let projectDir = "/Users/operator/coding/port-daddy"

        await store.refresh(projectDir: projectDir)
        XCTAssertEqual(store.continuitySnapshot?.counts.successorRequired, 1)
        try render(store: store, projectDir: projectDir, path: "\(outputDirectory)/context-continuity.png")

        await fixture.setDebugOverdue(false)
        await store.refreshDebug(projectDir: projectDir)
        let overview = try renderDebug(store: store, projectDir: projectDir, path: "\(outputDirectory)/context-continuity-detail.png")
        await fixture.setDebugOverdue(true)
        await store.refreshDebug(projectDir: projectDir)
        let overdue = try renderDebug(store: store, projectDir: projectDir, path: "\(outputDirectory)/context-continuity-overdue.png")
        try writeGIF(frames: [overview, overdue], path: "\(outputDirectory)/context-continuity.gif")
    }

    func testRenderRepairToLiveProofWhenRequested() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let outputDirectory = env["FLEETBAR_SQUID_SNAPSHOT_DIR"], !outputDirectory.isEmpty else {
            throw XCTSkip("Set FLEETBAR_SQUID_SNAPSHOT_DIR to render the Giant Squid action-to-outcome proof.")
        }

        let fixture = SquidHarnessVisualFixture()
        let store = SquidHarnessStore { arguments in await fixture.run(arguments) }
        let projectDir = "/Users/operator/coding/port-daddy"

        await store.refresh(projectDir: projectDir)
        XCTAssertEqual(store.snapshot?.state, .degraded)
        try render(store: store, projectDir: projectDir, path: "\(outputDirectory)/01-needs-repair.png")

        await store.arm(projectDir: projectDir)
        XCTAssertEqual(store.snapshot?.state, .live)
        XCTAssertEqual(store.snapshot?.wiredProviderCount, 4)
        try render(store: store, projectDir: projectDir, path: "\(outputDirectory)/02-live.png")
    }

    func testRenderHookDebugTimelineAndAnimatedDeadlineProofWhenRequested() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let outputDirectory = env["FLEETBAR_SQUID_SNAPSHOT_DIR"], !outputDirectory.isEmpty else {
            throw XCTSkip("Set FLEETBAR_SQUID_SNAPSHOT_DIR to render the Squid hook debug timeline proof.")
        }

        let fixture = SquidHarnessVisualFixture()
        let store = SquidHarnessStore { arguments in await fixture.run(arguments) }
        let projectDir = "/Users/operator/coding/port-daddy"

        await fixture.setDebugOverdue(false)
        await store.refreshDebug(projectDir: projectDir)
        XCTAssertEqual(store.debugSnapshot?.sessions.first?.state, .running)
        let running = try renderDebug(store: store, projectDir: projectDir, path: "\(outputDirectory)/03-hook-debug-running.png")

        await fixture.setDebugOverdue(true)
        await store.refreshDebug(projectDir: projectDir)
        XCTAssertEqual(store.debugSnapshot?.overdueCount, 1)
        let overdue = try renderDebug(store: store, projectDir: projectDir, path: "\(outputDirectory)/04-hook-debug-overdue.png")

        try writeGIF(frames: [running, overdue], path: "\(outputDirectory)/hook-debug-deadline.gif")
    }

    func testRenderBoundedProbeExpiryAndRecoveryProofWhenRequested() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let outputDirectory = env["FLEETBAR_SQUID_SNAPSHOT_DIR"], !outputDirectory.isEmpty else {
            throw XCTSkip("Set FLEETBAR_SQUID_SNAPSHOT_DIR to render bounded-probe recovery evidence.")
        }

        let fixture = SquidHarnessVisualFixture()
        let store = SquidHarnessStore { arguments in await fixture.run(arguments) }
        let projectDir = "/Users/operator/coding/port-daddy"

        await fixture.setDebugProbeState("active")
        await store.refreshDebug(projectDir: projectDir)
        XCTAssertEqual(store.debugSnapshot?.health?.circuits.first?.state, .halfOpen)
        let active = try renderDebug(store: store, projectDir: projectDir, path: "\(outputDirectory)/05-hook-recovery-active.png")

        await fixture.setDebugProbeState("stale")
        await store.refreshDebug(projectDir: projectDir)
        let circuit = store.debugSnapshot?.health?.circuits.first
        XCTAssertEqual(circuit?.state, .open)
        XCTAssertEqual(circuit?.probeState, .stale)
        XCTAssertEqual(circuit?.recoveryReady, true)
        let ready = try renderDebug(store: store, projectDir: projectDir, path: "\(outputDirectory)/06-hook-recovery-ready.png")

        try writeGIF(frames: [active, ready], path: "\(outputDirectory)/hook-recovery.gif")
    }

    private func render(store: SquidHarnessStore, projectDir: String, path: String) throws {
        let view = SquidHarnessStrip(store: store, projectDir: projectDir)
            .padding(24)
            .frame(width: 980, height: 126)
            .background(Color(nsColor: .windowBackgroundColor))
            .preferredColorScheme(.dark)

        _ = try renderBitmap(view: view, width: 980, height: 126, path: path)
    }

    private func renderDebug(store: SquidHarnessStore, projectDir: String, path: String) throws -> CGImage {
        let view = SquidHookDebugSheet(store: store, projectDir: projectDir)
            .frame(width: 860, height: 680)
            .preferredColorScheme(.dark)
        let bitmap = try renderBitmap(view: view, width: 860, height: 680, path: path)
        guard let image = bitmap.cgImage else {
            throw NSError(domain: "SquidHarnessSnapshotTests", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not create a CGImage for the hook timeline"])
        }
        return image
    }

    private func renderBitmap<V: View>(view: V, width: CGFloat, height: CGFloat, path: String) throws -> NSBitmapImageRep {
        let hosting = NSHostingView(rootView: view)
        hosting.frame = NSRect(x: 0, y: 0, width: width, height: height)
        hosting.appearance = NSAppearance(named: .darkAqua)
        hosting.layoutSubtreeIfNeeded()
        guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else {
            throw NSError(domain: "SquidHarnessSnapshotTests", code: 5, userInfo: [NSLocalizedDescriptionKey: "Could not encode Giant Squid snapshot as PNG"])
        }
        hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        guard let data = bitmap.representation(using: .png, properties: [:]) else {
            throw NSError(domain: "SquidHarnessSnapshotTests", code: 6, userInfo: [NSLocalizedDescriptionKey: "Could not encode Giant Squid snapshot data as PNG"])
        }
        XCTAssertGreaterThan(data.count, 10_000, "Giant Squid proof should render real UI, not a blank placeholder")

        let url = URL(fileURLWithPath: path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url)
        return bitmap
    }

    private func writeGIF(frames: [CGImage], path: String) throws {
        let url = URL(fileURLWithPath: path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard let destination = CGImageDestinationCreateWithURL(
            url as CFURL,
            UTType.gif.identifier as CFString,
            frames.count,
            nil
        ) else {
            throw NSError(domain: "SquidHarnessSnapshotTests", code: 3, userInfo: [NSLocalizedDescriptionKey: "Could not create GIF destination"])
        }
        CGImageDestinationSetProperties(destination, [
            kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]
        ] as CFDictionary)
        let frameProperties = [
            kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: 0.9]
        ] as CFDictionary
        for frame in frames {
            CGImageDestinationAddImage(destination, frame, frameProperties)
        }
        guard CGImageDestinationFinalize(destination) else {
            throw NSError(domain: "SquidHarnessSnapshotTests", code: 4, userInfo: [NSLocalizedDescriptionKey: "Could not finalize hook timeline GIF"])
        }
    }
}
