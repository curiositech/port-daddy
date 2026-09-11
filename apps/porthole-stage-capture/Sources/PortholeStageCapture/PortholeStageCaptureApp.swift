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
    private let controller: StageCaptureController?
    private let syntheticProofOutput: URL?
    private var cursorReader: LocalCursorReader?
    private var window: NSWindow?
    private var terminationPending = false

    override init() {
        do {
            syntheticProofOutput = try SyntheticStageProof.output(arguments: CommandLine.arguments)
        } catch {
            fputs("Porthole: --render-synthetic-proof requires exactly one new output directory and no capture flags.\n", stderr)
            exit(EX_USAGE)
        }
        if syntheticProofOutput != nil {
            // Deliberately before construction: no system picker, capture
            // controller, Keychain, cursor reader, or operator window access.
            proofConfiguration = nil
            controller = nil
        } else {
            let configuration = PortholeStageCaptureApp.proofConfiguration()
            proofConfiguration = configuration
            controller = StageCaptureController(proofConfiguration: configuration)
        }
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let syntheticProofOutput {
            NSApp.setActivationPolicy(.prohibited)
            Task {
                do {
                    try await SyntheticStageProof.render(to: syntheticProofOutput)
                    print("Synthetic UI proof only: \(syntheticProofOutput.path)")
                    exit(EXIT_SUCCESS)
                } catch {
                    fputs("Synthetic UI rendering failed; no capture proof exists: \(error)\n", stderr)
                    exit(EXIT_FAILURE)
                }
            }
            return
        }
        guard let controller else { return }
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

        let cursorReader = LocalCursorReader()
        self.cursorReader = cursorReader
        cursorReader.start { [weak controller] event in
            Task { @MainActor in controller?.ingestCursor(event) }
        }
        Task { await controller.bootstrap() }
    }

    func applicationWillTerminate(_ notification: Notification) {
        cursorReader?.stop()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !terminationPending else { return .terminateLater }
        terminationPending = true
        cursorReader?.stop()
        Task {
            await controller?.stopCapture()
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
