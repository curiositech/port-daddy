import SwiftUI

@main
struct FleetLiveApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        MenuBarExtra("Fleet Live", systemImage: "antenna.radiowaves.left.and.right") {
            FleetLiveMenuContent()
        }
        .menuBarExtraStyle(.window)
    }
}

// MARK: - App Delegate

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Hide dock icon programmatically (belt-and-suspenders with Info.plist LSUIElement)
        NSApp.setActivationPolicy(.accessory)
    }
}

// MARK: - Menu Content

struct FleetLiveMenuContent: View {
    @StateObject private var viewModel = FleetLiveViewModel()

    var body: some View {
        VStack(spacing: 0) {
            // Toolbar
            HStack {
                Image(systemName: "antenna.radiowaves.left.and.right")
                    .foregroundStyle(.secondary)
                Text("Fleet Live")
                    .font(.headline)
                Spacer()
                Button(action: { viewModel.reload() }) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 12, weight: .medium))
                }
                .buttonStyle(.borderless)
                .help("Reload")

                Button(action: { NSApplication.shared.terminate(nil) }) {
                    Image(systemName: "xmark.circle")
                        .font(.system(size: 12, weight: .medium))
                }
                .buttonStyle(.borderless)
                .help("Quit Fleet Live")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color(nsColor: NSColor(red: 0.10, green: 0.10, blue: 0.18, alpha: 1.0)))

            Divider()

            // WebView or error state
            ZStack {
                Color(nsColor: NSColor(red: 0.10, green: 0.10, blue: 0.18, alpha: 1.0))

                switch viewModel.state {
                case .loading:
                    ProgressView()
                        .progressViewStyle(.circular)
                        .controlSize(.small)

                case .loaded:
                    FleetWebView(viewModel: viewModel)

                case .error(let message):
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 32))
                            .foregroundStyle(.orange)
                        Text("Daemon Not Running")
                            .font(.headline)
                            .foregroundStyle(.white)
                        Text(message)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                        Button("Retry") {
                            viewModel.reload()
                        }
                        .buttonStyle(.bordered)
                    }
                }
            }
        }
        .frame(width: 400, height: 600)
        .background(Color(nsColor: NSColor(red: 0.10, green: 0.10, blue: 0.18, alpha: 1.0)))
    }
}
