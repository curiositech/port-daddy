import AppKit
import Foundation
import PortholeStageCore
import SwiftUI

@main
struct PortholeStageCaptureApp: App {
    @NSApplicationDelegateAdaptor(StageApplicationDelegate.self) private var appDelegate

    var body: some Scene {
        Settings {
            EmptyView()
        }
    }

    static func proofConfiguration() -> ProofConfiguration? {
        let arguments = CommandLine.arguments
        guard let title = value(after: "--proof-window-title", in: arguments),
              let output = value(after: "--proof-output", in: arguments)
        else { return nil }
        let approved = arguments.contains("--approve-safe-fixture-persistence")
        let duration = value(after: "--proof-duration", in: arguments).flatMap(Double.init) ?? 8
        let outputURL = URL(
            fileURLWithPath: output,
            relativeTo: URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        ).standardizedFileURL
        return ProofConfiguration(
            targetWindowTitle: title,
            outputDirectory: outputURL,
            explicitSafeFixtureApproval: approved,
            durationSeconds: max(2, min(duration, 30))
        )
    }

    private static func value(after flag: String, in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1) else { return nil }
        return arguments[index + 1]
    }
}

/// SwiftUI remains the rendering and state layer; an explicit AppKit window
/// gives both interactive and proof runs deterministic visibility. Interactive
/// proof starts foregrounded for explicit picker/review/Enter Stage consent;
/// the operator then backgrounds the same process for continuity evidence.
@MainActor
private final class StageApplicationDelegate: NSObject, NSApplicationDelegate {
    private let proofConfiguration: ProofConfiguration?
    private let controller: StageCaptureController
    private let cursorReader = LocalCursorReader()
    private var window: NSWindow?

    override init() {
        let proofConfiguration = PortholeStageCaptureApp.proofConfiguration()
        self.proofConfiguration = proofConfiguration
        controller = StageCaptureController(proofConfiguration: proofConfiguration)
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.regular)
        let root = StageView(controller: controller)
            .frame(minWidth: 920, minHeight: 620)
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1_180, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Porthole Stage"
        window.minSize = NSSize(width: 920, height: 620)
        window.contentViewController = NSHostingController(rootView: root)
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
        self.window = window

        cursorReader.start { [weak controller] event in
            Task { @MainActor in controller?.ingestCursor(event) }
        }
        Task { await controller.bootstrap() }
    }

    func applicationWillTerminate(_ notification: Notification) {
        cursorReader.stop()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

/// Newline-delimited JSON from stdin is the deliberately local transport for
/// cursor presence in this slice. It never opens a socket or claims remote
/// collaboration. Malformed and stale events are rejected by CursorStore.
private final class LocalCursorReader {
    private var buffer = Data()
    private var callback: ((CursorEvent) -> Void)?
    private let decoder = JSONDecoder()

    func start(callback: @escaping (CursorEvent) -> Void) {
        self.callback = callback
        FileHandle.standardInput.readabilityHandler = { [weak self] handle in
            guard let self else { return }
            let data = handle.availableData
            if data.isEmpty {
                self.stop()
                return
            }
            self.buffer.append(data)
            self.drainLines()
        }
    }

    func stop() {
        FileHandle.standardInput.readabilityHandler = nil
        callback = nil
    }

    private func drainLines() {
        while let newline = buffer.firstIndex(of: 0x0A) {
            let line = buffer.prefix(upTo: newline)
            buffer.removeSubrange(...newline)
            guard !line.isEmpty, let event = try? decoder.decode(CursorEvent.self, from: line) else { continue }
            callback?(event)
        }
    }
}
