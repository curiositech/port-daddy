import SwiftUI

// MARK: - Spawn approvals section (menu-bar popover, ADR-0093 HITL)
//
// Pinned at the very top of the FleetBar dropdown: a spawn the trust gate is
// holding is the one thing the operator must not miss. Renders nothing when
// the queue is empty — no dead chrome.

struct SpawnApprovalSection: View {
    @ObservedObject var store: SpawnApprovalStore

    var body: some View {
        if !store.approvals.isEmpty {
            VStack(alignment: .leading, spacing: Fleet.Space.s) {
                HStack(spacing: Fleet.Space.xs) {
                    SignalFlagGlyph(signal: .foxtrot)
                    Text("Needs you · \(store.approvals.count) gate\(store.approvals.count == 1 ? "" : "s")")
                        .font(.system(.caption, design: .monospaced).weight(.bold))
                        .textCase(.uppercase)
                        .foregroundStyle(Color.white.opacity(0.86))
                    Spacer()
                }

                if let error = store.lastError {
                    Text(error)
                        .font(.callout)
                        .foregroundStyle(Color.white)
                }

                ForEach(store.approvals) { approval in
                    approvalRow(approval)
                }
            }
            .padding(.horizontal, Fleet.Space.m)
            .padding(.vertical, Fleet.Space.s)
            .foregroundStyle(Color.white)
            .background(Fleet.Color.violetSlab)
            .overlay(StoryCornerTicks(color: Color.white.opacity(0.58), length: 11, lineWidth: 1.25))
            .padding(.horizontal, Fleet.Space.s)
            .padding(.vertical, Fleet.Space.s)
            .environment(\.colorScheme, .dark)
        }
    }

    @ViewBuilder
    private func approvalRow(_ approval: SpawnApproval) -> some View {
        StoryStateRow(
            state: .blocked,
            title: "\(approval.agent) ← \(approval.trigger)",
            detail: "\(approval.tierLabel) · \(approval.project) · tools: \(approval.safeTools.joined(separator: ", "))",
            time: approval.age,
            signal: .foxtrot
        ) {
            let deciding = store.decidingIds.contains(approval.id)
            HStack(spacing: Fleet.Space.xs) {
                Button {
                    Task { await store.decide(approval.id, decision: "approve") }
                } label: {
                    Image(systemName: "checkmark")
                        .font(.caption.weight(.bold))
                        .frame(width: 22, height: 22)
                }
                .buttonStyle(.plain)
                .background(Color.white, in: Rectangle())
                .foregroundStyle(Fleet.Color.violetSlab)
                .help("Approve")
                .disabled(deciding)

                Button {
                    Task { await store.decide(approval.id, decision: "reject") }
                } label: {
                    Image(systemName: "xmark")
                        .font(.caption.weight(.bold))
                        .frame(width: 22, height: 22)
                }
                .buttonStyle(.plain)
                .background(Color.black.opacity(0.26), in: Rectangle())
                .foregroundStyle(Color.white)
                .help("Reject")
                .disabled(deciding)
            }
        }
        .padding(.vertical, 2)
    }
}
