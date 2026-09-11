import AppKit
import SwiftUI

struct AccountSettingsView: View {
    @ObservedObject var store: OperatorAccountStore
    var onConnectionChanged: () -> Void = {}

    @State private var confirmsSignOut = false

    var body: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.l) {
            VStack(alignment: .leading, spacing: 4) {
                Label("Port Daddy Account", systemImage: "person.crop.circle.badge.checkmark")
                    .font(.title2.weight(.semibold))
                Text("Connect once so FleetBar can show requests from any supported agent, even when the local daemon is offline.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Divider()

            phaseContent
            Spacer()

            Text("FleetBar never displays the account credential. New credentials are verified before the protected account file is replaced.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Fleet.Space.xl)
        .confirmationDialog(
            "Sign out on this Mac?",
            isPresented: $confirmsSignOut,
            titleVisibility: .visible
        ) {
            Button("Sign Out", role: .destructive) {
                store.signOut()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes only the local FleetBar connection. You can revoke the device from your account page.")
        }
        .onChange(of: store.phase) { oldPhase, newPhase in
            switch (oldPhase, newPhase) {
            case (_, .connected), (_, .signedOut): onConnectionChanged()
            default: break
            }
        }
    }

    @ViewBuilder
    private var phaseContent: some View {
        switch store.phase {
        case .checking:
            HStack(spacing: Fleet.Space.s) {
                ProgressView().controlSize(.small)
                Text("Checking the saved connection…")
                    .font(.body)
            }

        case .signedOut:
            statusCard(
                icon: "person.crop.circle.badge.questionmark",
                title: "Not connected",
                detail: "Connect in your browser. FleetBar will finish the secure device pairing automatically.",
                tint: Fleet.Color.warning
            )
            Button {
                store.connect()
            } label: {
                Label("Connect Account", systemImage: "link.badge.plus")
            }
            .buttonStyle(.borderedProminent)

        case .connecting(let authorization):
            statusCard(
                icon: "link.circle.fill",
                title: "Finish in your browser",
                detail: "Enter this one-time code. FleetBar is waiting and will update automatically.",
                tint: Fleet.Color.active
            )

            VStack(alignment: .leading, spacing: Fleet.Space.s) {
                Text("ONE-TIME CODE")
                    .font(.system(size: 11, weight: .bold))
                    .tracking(1.2)
                    .foregroundStyle(.secondary)
                Text(authorization.userCode)
                    .font(.system(size: 28, weight: .semibold, design: .monospaced))
                    .textSelection(.enabled)
                    .accessibilityLabel("One-time connection code \(authorization.userCode)")
                Text("Expires \(authorization.expiresAt, style: .relative)")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            .padding(Fleet.Space.l)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Fleet.Chrome.card, in: RoundedRectangle(cornerRadius: Fleet.Radius.medium))

            HStack(spacing: Fleet.Space.s) {
                Button {
                    NSWorkspace.shared.open(authorization.verificationURL)
                } label: {
                    Label("Open Authorization Page", systemImage: "arrow.up.right.square")
                }
                .buttonStyle(.borderedProminent)

                Button("Cancel") {
                    store.cancelConnection()
                }
                .buttonStyle(.bordered)
            }

        case .connected(let identity):
            statusCard(
                icon: "checkmark.seal.fill",
                title: "Connected as @\(identity.login)",
                detail: identity.lastVerified.map { "Verified \($0.formatted(.relative(presentation: .named)))" }
                    ?? "Saved connection; check it whenever you like.",
                tint: Fleet.Color.healthy
            )

            LabeledContent("Relay") {
                Text(URL(string: identity.relayUrl)?.host ?? identity.relayUrl)
                    .font(.system(.body, design: .monospaced))
            }

            HStack(spacing: Fleet.Space.s) {
                Button {
                    Task {
                        await store.refresh()
                    }
                } label: {
                    Label("Check Connection", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)

                Button {
                    store.connect()
                } label: {
                    Label("Reconnect", systemImage: "link")
                }
                .buttonStyle(.bordered)

                Spacer()

                Button("Sign Out", role: .destructive) {
                    confirmsSignOut = true
                }
                .buttonStyle(.bordered)
            }

        case .failed(let message):
            statusCard(
                icon: "exclamationmark.triangle.fill",
                title: "Connection needs attention",
                detail: message,
                tint: Fleet.Color.failure
            )

            HStack(spacing: Fleet.Space.s) {
                Button {
                    store.connect()
                } label: {
                    Label("Reconnect", systemImage: "link")
                }
                .buttonStyle(.borderedProminent)

                Button {
                    Task {
                        await store.refresh()
                    }
                } label: {
                    Label("Check Again", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
            }
        }
    }

    private func statusCard(icon: String, title: String, detail: String, tint: Color) -> some View {
        HStack(alignment: .top, spacing: Fleet.Space.m) {
            Image(systemName: icon)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.body.weight(.semibold))
                Text(detail)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(Fleet.Space.l)
        .background(tint.opacity(0.09), in: RoundedRectangle(cornerRadius: Fleet.Radius.medium))
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.medium)
                .stroke(tint.opacity(0.24), lineWidth: 1)
        )
    }
}
