import AppKit
import SwiftUI
import XCTest
@testable import FleetBar

private actor SquidHarnessVisualFixture {
    private var armed = false

    func run(_ arguments: [String]) -> SquidCommandResult {
        if arguments.starts(with: ["squid", "on"]) {
            armed = true
            return SquidCommandResult(status: 0, stdout: "armed", stderr: "")
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
        "afterTool":"fleet trace"
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
}

@MainActor
final class SquidHarnessSnapshotTests: XCTestCase {
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

    private func render(store: SquidHarnessStore, projectDir: String, path: String) throws {
        let view = SquidHarnessStrip(store: store, projectDir: projectDir)
            .padding(24)
            .frame(width: 980, height: 126)
            .background(Color(nsColor: .windowBackgroundColor))
            .preferredColorScheme(.dark)

        let hosting = NSHostingView(rootView: view)
        hosting.frame = NSRect(x: 0, y: 0, width: 980, height: 126)
        hosting.appearance = NSAppearance(named: .darkAqua)
        hosting.layoutSubtreeIfNeeded()
        guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else {
            XCTFail("Could not encode Giant Squid snapshot as PNG")
            return
        }
        hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        guard let data = bitmap.representation(using: .png, properties: [:]) else {
            XCTFail("Could not encode Giant Squid snapshot as PNG")
            return
        }
        XCTAssertGreaterThan(data.count, 10_000, "Giant Squid proof should render real UI, not a blank placeholder")

        let url = URL(fileURLWithPath: path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url)
    }
}
