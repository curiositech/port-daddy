import AppKit
import Darwin
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
        do {
            return try ProofConfigurationParser.parse(
                arguments: CommandLine.arguments,
                currentDirectory: URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            )
        } catch {
            fputs("Porthole: \(error.localizedDescription)\n", stderr)
            exit(EX_USAGE)
        }
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
    private var terminationPending = false

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

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !terminationPending else { return .terminateLater }
        terminationPending = true
        cursorReader.stop()
        Task {
            await controller.stopCapture()
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
