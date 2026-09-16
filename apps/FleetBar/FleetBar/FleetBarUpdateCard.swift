import SwiftUI

/// Operator-owned remediation for an app that trails the selected daemon.
///
/// The card never leaves FleetBar or asks the operator to use a terminal. It
/// names the exact target version, exposes bounded progress, and keeps a
/// verification/install error visible so a failed update cannot look complete.
struct FleetBarUpdateCard: View {
    let appVersion: SemanticVersion
    let daemonVersion: SemanticVersion
    @StateObject private var updater: FleetBarUpdater

    init(
        appVersion: SemanticVersion,
        daemonVersion: SemanticVersion,
        updater: FleetBarUpdater = FleetBarUpdater()
    ) {
        self.appVersion = appVersion
        self.daemonVersion = daemonVersion
        _updater = StateObject(wrappedValue: updater)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            HStack(spacing: Fleet.Space.s) {
                Image(systemName: "arrow.down.circle.fill")
                    .foregroundStyle(Fleet.Color.warning)
                Text("FleetBar is out of date")
                    .font(.caption.weight(.semibold))
                Spacer()
                Text(verbatim: "app \(appVersion.description)  →  daemon \(daemonVersion.description)")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }

            Text(detail)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Button(action: install) {
                HStack(spacing: Fleet.Space.xs) {
                    if updater.state.isBusy {
                        ProgressView()
                            .controlSize(.small)
                    }
                    Text(buttonLabel)
                        .font(.caption.weight(.medium))
                }
            }
            .controlSize(.small)
            .tint(Fleet.Color.warning)
            .disabled(updater.state.isBusy)
            .accessibilityHint("Downloads, verifies, installs, and relaunches the exact signed FleetBar release")

            Text(footnote)
                .font(.caption2)
                .foregroundStyle(isFailure ? Fleet.Color.failure : Color.secondary.opacity(0.7))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Fleet.Space.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Fleet.Color.warning.opacity(0.10))
    }

    private var detail: String {
        switch updater.state {
        case .idle, .failed:
            return "This app is \(appVersion); the daemon is \(daemonVersion). FleetBar can install the exact matching signed release now."
        case .installing:
            return "Downloading FleetBar \(daemonVersion), checking its checksum and Developer ID, then preserving this app as a rollback."
        case .relaunching:
            return "FleetBar \(daemonVersion) is installed. Relaunching the menu-bar app now."
        }
    }

    private var buttonLabel: String {
        switch updater.state {
        case .idle, .failed:
            return "Update to FleetBar \(daemonVersion)"
        case .installing:
            return "Verifying FleetBar \(daemonVersion)…"
        case .relaunching:
            return "Relaunching FleetBar \(daemonVersion)…"
        }
    }

    private var footnote: String {
        switch updater.state {
        case .idle:
            return "Signed and notarized. The previous app is retained as a recoverable backup."
        case .installing:
            return "Nothing is replaced unless every verification passes."
        case .relaunching:
            return "The Fleet icon will return after launchd starts the verified app."
        case let .failed(message):
            return message
        }
    }

    private var isFailure: Bool {
        if case .failed = updater.state { return true }
        return false
    }

    private func install() {
        updater.install(version: daemonVersion.description)
    }
}
