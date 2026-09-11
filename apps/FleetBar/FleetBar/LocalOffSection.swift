import SwiftUI

@MainActor
final class LocalOffStore: ObservableObject {
    @Published private(set) var blockedReason = LocalRuntimeControl.shared.blockedReason
    @Published private(set) var isStopping = false
    @Published private(set) var persistenceFailures: [String] = []
    @Published private(set) var receipts: [LocalRuntimeShutdown.Receipt] = []
    @Published private(set) var hasRequestedOff = false

    func refresh() { blockedReason = LocalRuntimeControl.shared.blockedReason }

    func turnOff() {
        guard !isStopping else { return }
        isStopping = true
        hasRequestedOff = true
        // No suspension or daemon request before the persistent stop attempt.
        persistenceFailures = LocalRuntimeControl.shared.persistOff()
        refresh()
        Task {
            receipts = await Task.detached(priority: .userInitiated) {
                LocalRuntimeShutdown.stop()
            }.value
            isStopping = false
        }
    }
}

/// Accessible from the menu-bar popover and Settings without a daemon endpoint.
/// A destructive stop does not need confirmation; reactivation is never a toggle
/// inferred from reconnect/readiness. Existing operator ALL-CLEAR stays separate.
struct LocalOffSection: View {
    var compact = false
    @StateObject private var store = LocalOffStore()
    @State private var showReceipts = false

    var body: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            Label("Port Daddy on this Mac", systemImage: "power")
                .font(.headline)
            Text(store.blockedReason == nil ? "Local runtime is permitted" : "Local starts blocked")
                .font(.body.weight(.semibold))
            if !compact, let reason = store.blockedReason {
                Text(reason).foregroundStyle(.secondary)
            }
            Button(role: .destructive) { store.turnOff() } label: {
                Label(store.isStopping ? "Stopping local services…" : "Turn Port Daddy off", systemImage: "power")
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(store.isStopping)
            .accessibilityHint("Saves local Off first, then disables automatic restart and requests local service shutdown. Does not change hosted Fleet settings.")

            if store.hasRequestedOff {
                Text(store.persistenceFailures.isEmpty
                     ? "Off saved. Hooks and local starts stay blocked across restarts."
                     : "Off is latched in this app, but saving it failed. Do not assume it will survive restart.")
                ForEach(store.persistenceFailures, id: \.self) { Text($0).foregroundStyle(Fleet.Color.failure) }
                if !store.receipts.isEmpty {
                    DisclosureGroup("Shutdown receipts", isExpanded: $showReceipts) {
                        ForEach(Array(store.receipts.enumerated()), id: \.offset) { _, receipt in
                            Text(receipt.summary).frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
            }
            if compact {
                Text("Local control only. Existing processes and hosted work are not verified stopped.")
                    .foregroundStyle(.secondary)
            } else {
                Text("Existing untracked processes and work already accepted remotely are not verified stopped. Account and global Fleet controls are separate.")
                    .foregroundStyle(.secondary)
                Text("Restarting this app does not clear Off. Re-enabling requires the operator’s explicit all-clear; this control never removes a stop marker.")
                    .foregroundStyle(.secondary)
            }
            Link("Open account Fleet controls", destination: URL(string: "https://relay.portdaddy.dev/account")!)
        }
        .font(.system(size: 14))
        .fixedSize(horizontal: false, vertical: true)
        .padding(Fleet.Space.l)
        .task {
            while !Task.isCancelled {
                store.refresh()
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
            }
        }
    }
}
