import SwiftUI
import AppKit

// MARK: - Operator TUI Launcher
//
// Launches pd-console (the Rust operator console) in a Terminal window.
//
// Binary resolution order (first found wins):
//   1. ~/.port-daddy/bin/pd-console          — installed via `pd install` or brew
//   2. /usr/local/bin/pd-console             — brew install curiositech/tap/pd-console
//   3. /opt/homebrew/bin/pd-console          — Apple Silicon homebrew prefix
//   4. which pd-console (PATH resolution)    — any other PATH install
//
// If no binary is found, the launcher surfaces an alert instead of silently
// doing nothing. The binary must be pre-installed; FleetBar does not bundle it.

enum OperatorTUILauncher {

    // MARK: - Binary discovery

    /// Returns the first pd-console binary that exists on disk.
    static func resolvedBinaryPath() -> String? {
        let candidates: [String] = [
            NSString(string: "~/.port-daddy/bin/pd-console").expandingTildeInPath,
            "/usr/local/bin/pd-console",
            "/opt/homebrew/bin/pd-console",
        ]
        for path in candidates {
            if FileManager.default.fileExists(atPath: path) {
                return path
            }
        }
        // Fall back to PATH lookup via `which`. runShellCapture takes the
        // executable path plus separate args — passing "/usr/bin/which pd-console"
        // as one path points at a nonexistent file and always fails.
        if let pathResult = runShellCapture("/usr/bin/which", args: ["pd-console"]),
           !pathResult.isEmpty {
            return pathResult
        }
        return nil
    }

    // MARK: - Launch

    /// Opens pd-console in a new Terminal window (or a new tab in iTerm if
    /// iTerm2 is the default terminal application).
    ///
    /// - Parameter binaryPath: The full path to the pd-console binary.
    @MainActor
    static func launch(binaryPath: String) {
        let escaped = binaryPath.replacingOccurrences(of: "\"", with: "\\\"")
        let script: String
        if isITermRunning() {
            // iTerm2 variant: open a new window with the command.
            script = """
            tell application "iTerm"
                activate
                set newWindow to (create window with default profile)
                tell current session of newWindow
                    write text "\(escaped)"
                end tell
            end tell
            """
        } else {
            // Terminal.app — the macOS system default.
            script = """
            tell application "Terminal"
                activate
                do script "\(escaped)"
            end tell
            """
        }
        runAppleScript(script)
    }

    // MARK: - Private helpers

    private static func isITermRunning() -> Bool {
        NSWorkspace.shared.runningApplications.contains { app in
            app.bundleIdentifier == "com.googlecode.iterm2"
        }
    }

    private static func runAppleScript(_ source: String) {
        guard let script = NSAppleScript(source: source) else { return }
        var errorInfo: NSDictionary?
        script.executeAndReturnError(&errorInfo)
        // Errors are silently swallowed here; callers should validate the
        // binary exists before calling launch().
    }

    /// Runs a shell command and returns stdout, trimming newlines.
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

/// A Button that resolves and launches pd-console.  Drop this anywhere in a
/// View hierarchy; it carries its own alert for the "binary not found" case.
struct LaunchOperatorTUIButton: View {
    @State private var showingNotFoundAlert = false
    @State private var resolvedPath: String? = nil

    var body: some View {
        Button {
            let path = OperatorTUILauncher.resolvedBinaryPath()
            guard let path else {
                showingNotFoundAlert = true
                return
            }
            resolvedPath = path
            OperatorTUILauncher.launch(binaryPath: path)
        } label: {
            Label("Launch Operator TUI", systemImage: "terminal")
                .font(.caption2.weight(.semibold))
        }
        .buttonStyle(.borderless)
        .foregroundStyle(Fleet.Color.active)
        .help("Open pd-console (the operator REPL) in a terminal window")
        .alert("pd-console not found", isPresented: $showingNotFoundAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("""
            pd-console was not found at any of the expected paths:
            • ~/.port-daddy/bin/pd-console
            • /usr/local/bin/pd-console
            • /opt/homebrew/bin/pd-console

            Install it via: brew install curiositech/tap/port-daddy
            or copy the binary to ~/.port-daddy/bin/pd-console
            """)
        }
    }
}
