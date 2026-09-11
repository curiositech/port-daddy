import AppKit
import OSLog
import PortholeStageCore
import SwiftUI

@main
struct PortholeStageFixtureApp: App {
    @NSApplicationDelegateAdaptor(FixtureAppDelegate.self) private var appDelegate

    var body: some Scene {
        Settings { EmptyView() }
    }
}

@MainActor
private final class FixtureAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let logger = Logger(subsystem: "dev.portdaddy.porthole.safe-fixture", category: "picker-geometry")
    private var window: NSWindow?
    private var geometryTimer: Timer?
    private var lastMouseLocation: NSPoint?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let contract = SafeFixtureWindowContract.standard
        precondition(!contract.usesFullSizeContentView)
        precondition(contract.usesIdentityContentTransform)
        precondition(!contract.isResizable)

        NSApp.setActivationPolicy(.regular)
        let contentSize = NSSize(
            width: contract.contentSizeInPoints.width,
            height: contract.contentSizeInPoints.height
        )
        let fixtureWindow = NSWindow(
            contentRect: NSRect(origin: .zero, size: contentSize),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        fixtureWindow.title = "Porthole Safe Fixture"
        fixtureWindow.isReleasedWhenClosed = false
        fixtureWindow.isRestorable = false
        fixtureWindow.delegate = self
        fixtureWindow.contentViewController = NSHostingController(
            rootView: SafeFixtureView().frame(width: contentSize.width, height: contentSize.height)
        )
        fixtureWindow.setContentSize(contentSize)
        fixtureWindow.center()
        fixtureWindow.makeKeyAndOrderFront(nil)
        window = fixtureWindow
        NSApp.activate(ignoringOtherApps: true)
        logGeometry(reason: "fixture-ready")
        startGeometryMonitor()
    }

    func applicationWillTerminate(_ notification: Notification) {
        geometryTimer?.invalidate()
    }

    func windowWillClose(_ notification: Notification) {
        geometryTimer?.invalidate()
        NSApp.terminate(nil)
    }

    private func startGeometryMonitor() {
        let timer = Timer(timeInterval: 0.2, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, let window = self.window else { return }
                let mouse = window.mouseLocationOutsideOfEventStream
                if let previous = self.lastMouseLocation,
                   abs(previous.x - mouse.x) < 0.5,
                   abs(previous.y - mouse.y) < 0.5
                {
                    return
                }
                self.lastMouseLocation = mouse
                self.logGeometry(reason: "mouse-moved")
            }
        }
        geometryTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func logGeometry(reason: String) {
        guard let window else { return }
        let mouse = window.mouseLocationOutsideOfEventStream
        let screenMouse = window.convertToScreen(NSRect(origin: mouse, size: .zero)).origin
        let frame = window.frame
        let layout = window.contentLayoutRect
        let sample = PickerHitTestGeometry(
            windowOriginInScreenPoints: PortholePoint(x: frame.origin.x, y: frame.origin.y),
            windowSizeInPoints: PortholeSize(width: frame.width, height: frame.height),
            contentLayoutOriginInWindowPoints: PortholePoint(x: layout.origin.x, y: layout.origin.y),
            contentLayoutSizeInPoints: PortholeSize(width: layout.width, height: layout.height),
            mouseLocationInWindowPoints: PortholePoint(x: mouse.x, y: mouse.y),
            backingScaleFactor: window.backingScaleFactor
        )
        let modeledScreen = sample.mouseLocationInScreenPoints
        logger.info(
            "fixture-geometry reason=\(reason, privacy: .public) frame=\(frame.debugDescription, privacy: .public) contentLayout=\(layout.debugDescription, privacy: .public) scale=\(window.backingScaleFactor, privacy: .public) mouseWindow=\(mouse.debugDescription, privacy: .public) mouseScreen=\(screenMouse.debugDescription, privacy: .public) modeledScreen=(\(modeledScreen.x, privacy: .public),\(modeledScreen.y, privacy: .public))"
        )
    }
}

private struct SafeFixtureView: View {
    @State private var note = "Synthetic comment: button timing is visible"

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { timeline in
            let phase = timeline.date.timeIntervalSinceReferenceDate
            ZStack {
                LinearGradient(
                    colors: [
                        Color(red: 0.04, green: 0.08, blue: 0.13),
                        Color(red: 0.10, green: 0.05, blue: 0.16),
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                DotField()
                    .opacity(0.45)
                VStack(alignment: .leading, spacing: 22) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("SYNTHETIC PORTHOLE SOURCE")
                                .font(.system(size: 12, weight: .black, design: .rounded))
                                .tracking(2)
                                .foregroundStyle(.mint)
                            Text("Safe motion fixture")
                                .font(.system(size: 32, weight: .bold, design: .rounded))
                            Text("Generated shapes only · no operator data · no background media")
                                .font(.system(size: 15))
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(timeline.date, style: .timer)
                            .font(.system(size: 16, weight: .semibold, design: .monospaced))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(.white.opacity(0.08), in: Capsule())
                    }

                    GeometryReader { geometry in
                        let travel = max(geometry.size.width - 92, 0)
                        let x = (sin(phase * 1.35) * 0.5 + 0.5) * travel
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 18)
                                .fill(.black.opacity(0.28))
                                .overlay(RoundedRectangle(cornerRadius: 18).stroke(.white.opacity(0.12)))
                            Circle()
                                .fill(
                                    RadialGradient(
                                        colors: [.yellow, .orange.opacity(0.9), .pink.opacity(0.7)],
                                        center: .topLeading,
                                        startRadius: 2,
                                        endRadius: 52
                                    )
                                )
                                .frame(width: 76, height: 76)
                                .shadow(color: .orange.opacity(0.55), radius: 18)
                                .offset(x: x)
                                .padding(.leading, 8)
                                .accessibilityLabel("Animated synthetic proof marker")
                        }
                    }
                    .frame(height: 112)

                    HStack(spacing: 14) {
                        Label("Window-only", systemImage: "macwindow")
                        Label("Audio off", systemImage: "speaker.slash")
                        Label("Mic off", systemImage: "mic.slash")
                        Label("30 fps", systemImage: "waveform.path.ecg")
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.secondary)

                    TextField("Synthetic comment", text: $note)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 15))
                        .accessibilityLabel("Synthetic non-secret fixture comment")
                }
                .padding(30)
            }
            .foregroundStyle(.white)
            .preferredColorScheme(.dark)
        }
    }
}

private struct DotField: View {
    var body: some View {
        Canvas { context, size in
            for x in stride(from: 16.0, through: size.width, by: 28) {
                for y in stride(from: 16.0, through: size.height, by: 28) {
                    context.fill(
                        Path(ellipseIn: CGRect(x: x, y: y, width: 1.5, height: 1.5)),
                        with: .color(.white.opacity(0.2))
                    )
                }
            }
        }
    }
}
