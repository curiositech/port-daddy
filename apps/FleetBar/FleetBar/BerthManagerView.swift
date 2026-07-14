import SwiftUI

// MARK: - Berth Manager (ADR-0084 Phase 2)

/// The "one FleetBar showing all berths" surface: lists every discovered daemon
/// berth colour-coded, marks the one FleetBar is bound to, and lets the operator
/// switch the live connection or stop a dev berth. The stable berth is always
/// shown and is never stoppable here.
struct BerthManagerView: View {
    @ObservedObject var store: FleetStore
    @ObservedObject var berthStore: BerthStore

    private let appChannel = AppChannel.current
    private struct BerthLane: Identifiable {
        let id: String
        let title: String
        let berths: [Berth]
    }

    private var lanes: [BerthLane] {
        let stable = berthStore.berths.filter(\.canonical)
        let latest = berthStore.berths.filter { !$0.canonical && $0.tier == "dev-latest" }
        let dev = berthStore.berths.filter { !$0.canonical && $0.tier != "dev-latest" }
        return [
            BerthLane(id: "stable", title: "Prod", berths: stable),
            BerthLane(id: "latest", title: "Latest", berths: latest),
            BerthLane(id: "dev", title: "Dev berths", berths: dev),
        ].filter { !$0.berths.isEmpty }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            header
            if !appChannel.isProduction {
                // Name this FleetBar build so a dev menu-bar app is identifiable
                // from the popover, not just the "DEV" chip.
                Label("This FleetBar: \(appChannel.displayLabel)", systemImage: "hammer.fill")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Fleet.Color.warning)
            }
            ForEach(lanes) { lane in
                VStack(alignment: .leading, spacing: Fleet.Space.xs) {
                    Text(lane.title.uppercased())
                        .font(.system(.caption2, design: .monospaced).weight(.bold))
                        .foregroundStyle(Fleet.Chrome.tertiaryText)
                    ForEach(lane.berths) { berth in
                        BerthRow(
                            berth: berth,
                            isActive: berth.port == store.activePort,
                            onUse: { switchTo(berth) }
                        )
                    }
                }
            }
            if let message = berthStore.actionMessage {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(Fleet.Chrome.secondaryText)
            }
            Text("Daemon-reported berths. Pick one to bind this FleetBar session.")
                .font(.caption)
                .foregroundStyle(Fleet.Chrome.tertiaryText)
        }
        .padding(.horizontal, Fleet.Space.l)
        .padding(.vertical, Fleet.Space.m)
        .task {
            await berthStore.refresh()
            // Keep the list live while the popover is open; cancels on close.
            await berthStore.autoRefreshLoop()
        }
    }

    private var header: some View {
        HStack(spacing: Fleet.Space.s) {
            SignalFlagGlyph(signal: .papa)
            VStack(alignment: .leading, spacing: 2) {
                Text("Berth lanes")
                    .font(.caption.weight(.semibold))
                Text("stable, latest, and feature daemons")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if berthStore.isRefreshing {
                ProgressView().controlSize(.small)
            }
            Button {
                Task { await berthStore.refresh() }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.borderless)
            .help("Re-scan running daemons")
            .accessibilityLabel("Refresh daemons")
        }
    }

    private func switchTo(_ berth: Berth) {
        store.rebind(to: berth.url)
        Task { await berthStore.refresh() }
    }
}

// MARK: - Row

private struct BerthRow: View {
    let berth: Berth
    let isActive: Bool
    let onUse: () -> Void

    var body: some View {
        StoryStateRow(
            state: state,
            title: "\(berth.label) · :\(berth.port)",
            detail: statusLine,
            time: isActive ? "ACTIVE" : (berth.reachable ? "USE" : "DOWN"),
            signal: signal
        ) {
            if !isActive && berth.reachable {
                Button("Use", action: onUse)
                    .buttonStyle(.plain)
                    .font(.system(.caption2, design: .monospaced).weight(.bold))
                    .foregroundStyle(state.color)
                    .padding(.horizontal, Fleet.Space.s)
                    .padding(.vertical, 4)
                    .background(state.color.opacity(0.10), in: Rectangle())
            }
        }
        .background(isActive ? state.color.opacity(0.10) : Color.clear)
    }

    private var statusLine: String {
        var bits: [String] = []
        if !berth.reachable { bits.append("offline") }
        if let version = berth.version { bits.append("v\(version)") }
        bits.append(berth.sourceSummary)
        return bits.joined(separator: " · ")
    }

    private var state: FleetVisualState {
        if isActive { return .running }
        if berth.reachable { return .ok }
        return .warn
    }

    private var signal: FleetSignalFlag {
        if berth.canonical { return .papa }
        switch berth.tier {
        case "dev-latest": return .quebec
        case "codebase": return .delta
        default: return .mike
        }
    }
}
