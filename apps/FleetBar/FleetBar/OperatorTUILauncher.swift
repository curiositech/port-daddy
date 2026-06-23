import SwiftUI
import AppKit

// MARK: - Operator Console Launcher
//
// Launches pd-console — the GPU-native operator console (ADR-0046). It opens its
// OWN native window, so we launch it as a GUI app, not inside a terminal.
//
// Resolution order (first found wins):
//   App bundle (preferred — proper Dock presence + activation):
//     1. ~/Applications/pd-console.app   — installed via core/pd-console/scripts/install-app.sh
//     2. /Applications/pd-console.app
//   Raw binary (fallback — still opens the window, launched detached):
//     3. ~/.port-daddy/bin/pd-console
//     4. /usr/local/bin/pd-console
//     5. /opt/homebrew/bin/pd-console
//     6. which pd-console (PATH)
//
// If nothing is found, the launcher surfaces an alert instead of doing nothing.

enum OperatorConsoleLauncher {

    // MARK: - Discovery

    /// First pd-console.app bundle that exists on disk.
    static func resolvedAppPath() -> String? {
        let candidates = [
            NSString(string: "~/Applications/pd-console.app").expandingTildeInPath,
            "/Applications/pd-console.app",
        ]
        return candidates.first { FileManager.default.fileExists(atPath: $0) }
    }

    /// First raw pd-console binary that exists on disk (fallback path).
    static func resolvedBinaryPath() -> String? {
        let candidates: [String] = [
            NSString(string: "~/.port-daddy/bin/pd-console").expandingTildeInPath,
            "/usr/local/bin/pd-console",
            "/opt/homebrew/bin/pd-console",
        ]
        for path in candidates where FileManager.default.fileExists(atPath: path) {
            return path
        }
        // PATH lookup via `which` (separate exe + arg; one combined string fails).
        if let pathResult = runShellCapture("/usr/bin/which", args: ["pd-console"]),
           !pathResult.isEmpty {
            return pathResult
        }
        return nil
    }

    /// True when pd-console can be launched somehow (app bundle or raw binary).
    static func isInstalled() -> Bool {
        resolvedAppPath() != nil || resolvedBinaryPath() != nil
    }

    // MARK: - Launch

    /// Opens the operator console window. Prefers the .app bundle (Dock + activation);
    /// falls back to launching the raw binary detached (it opens its own window).
    @MainActor
    static func launch() {
        if let appPath = resolvedAppPath() {
            let url = URL(fileURLWithPath: appPath)
            let config = NSWorkspace.OpenConfiguration()
            config.activates = true
            NSWorkspace.shared.openApplication(at: url, configuration: config)
            return
        }
        if let binaryPath = resolvedBinaryPath() {
            let task = Process()
            task.executableURL = URL(fileURLWithPath: binaryPath)
            // Detached: the console outlives this launch and FleetBar doesn't block.
            try? task.run()
        }
    }

    // MARK: - Private helpers

    /// Runs a shell command and returns the first stdout line, trimmed.
    private static func runShellCapture(_ command: String, args: [String] = []) -> String? {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: command)
        task.arguments = args
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = Pipe()
        do {
            try task.run()
            task.waitUntilExit()
        } catch {
            return nil
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        return String(data: data, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: "\n").first
    }
}

// MARK: - SwiftUI integration

/// A Button that launches the pd-console operator console window. Drop it anywhere
/// in a View hierarchy; it carries its own "not installed" alert.
struct LaunchOperatorConsoleButton: View {
    @State private var showingNotFoundAlert = false

    var body: some View {
        Button {
            if OperatorConsoleLauncher.isInstalled() {
                OperatorConsoleLauncher.launch()
            } else {
                showingNotFoundAlert = true
            }
        } label: {
            Label("Open Operator Console", systemImage: "macwindow")
                .font(.caption2.weight(.semibold))
        }
        .buttonStyle(.borderless)
        .foregroundStyle(Fleet.Color.active)
        .help("Open pd-console — the GPU-native operator console window")
        .alert("pd-console not found", isPresented: $showingNotFoundAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("""
            pd-console isn't installed yet. Build and install the app with:

            core/pd-console/scripts/install-app.sh

            (installs ~/Applications/pd-console.app), or place the binary at
            ~/.port-daddy/bin/pd-console.
            """)
        }
    }
}
