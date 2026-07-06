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
            ForEach(berthStore.berths) { berth in
                BerthRow(
                    berth: berth,
                    isActive: berth.port == store.activePort,
                    onUse: { switchTo(berth) },
                    onStop: { Task { await berthStore.stop(berth) } }
                )
            }
            if let message = berthStore.actionMessage {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(Fleet.Chrome.secondaryText)
            }
            Text("Spin up a dev berth with `pd dev up`; switch a shell with `pd use`.")
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
            Text("Daemons")
                .font(.headline)
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
    let onStop: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: Fleet.Space.s) {
            Circle()
                .fill(berth.color)
                .frame(width: 10, height: 10)
                .opacity(berth.reachable ? 1 : 0.35)
                .padding(.top, 3)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Fleet.Space.xs) {
                    Text(berth.label)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                    tierTag
                    Text(":\(berth.port)")
                        .font(.caption.monospaced())
                        .foregroundStyle(Fleet.Chrome.secondaryText)
                }
                Text(statusLine)
                    .font(.caption)
                    .foregroundStyle(Fleet.Chrome.tertiaryText)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Spacer(minLength: Fleet.Space.s)

            trailingControls
        }
        .padding(Fleet.Space.s)
        .background(
            RoundedRectangle(cornerRadius: Fleet.Radius.small)
                .fill(isActive ? berth.color.opacity(0.12) : Color.clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.small)
                .stroke(isActive ? berth.color.opacity(0.5) : Fleet.Chrome.border,
                        lineWidth: isActive ? 1.5 : 1)
        )
    }

    private var tierTag: some View {
        Text(berth.tier.uppercased())
            .font(.system(size: 9, weight: .heavy))
            .tracking(0.5)
            .foregroundStyle(berth.color)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(Capsule().fill(berth.color.opacity(0.15)))
    }

    private var statusLine: String {
        var bits: [String] = []
        if !berth.reachable { bits.append("offline") }
        if let version = berth.version { bits.append("v\(version)") }
        bits.append(berth.sourceSummary)
        return bits.joined(separator: " · ")
    }

    @ViewBuilder
    private var trailingControls: some View {
        VStack(alignment: .trailing, spacing: Fleet.Space.xs) {
            if isActive {
                Label("Active", systemImage: "checkmark.circle.fill")
                    .labelStyle(.titleAndIcon)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(berth.color)
            } else if berth.reachable {
                Button("Use", action: onUse)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .tint(berth.color)
            }

            if !berth.canonical {
                Button(role: .destructive, action: onStop) {
                    Text("Stop")
                }
                .buttonStyle(.borderless)
                .controlSize(.small)
                .help("pd dev down \(berth.label)")
            }
        }
    }
}
