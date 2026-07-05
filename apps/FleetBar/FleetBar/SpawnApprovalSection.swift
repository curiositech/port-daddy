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
                    Image(systemName: "shield.lefthalf.filled.badge.checkmark")
                        .foregroundStyle(Fleet.Color.warning)
                    Text("Spawn approvals (\(store.approvals.count))")
                        .font(.callout.weight(.semibold))
                    Spacer()
                }

                if let error = store.lastError {
                    Text(error)
                        .font(.callout)
                        .foregroundStyle(Fleet.Color.failure)
                }

                ForEach(store.approvals) { approval in
                    approvalRow(approval)
                }
            }
            .padding(.horizontal, Fleet.Space.m)
            .padding(.vertical, Fleet.Space.s)
            .background(Fleet.Color.warning.opacity(0.08))
            Divider().opacity(0.5)
        }
    }

    @ViewBuilder
    private func approvalRow(_ approval: SpawnApproval) -> some View {
        HStack(alignment: .center, spacing: Fleet.Space.s) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(approval.agent) ← \(approval.trigger)")
                    .font(.callout.weight(.medium))
                    .lineLimit(1)
                Text("\(approval.tierLabel) · \(approval.project) · \(approval.age) ago · tools: \(approval.safeTools.joined(separator: ", "))")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: Fleet.Space.s)
            let deciding = store.decidingIds.contains(approval.id)
            Button {
                Task { await store.decide(approval.id, decision: "approve") }
            } label: {
                Label("Approve", systemImage: "checkmark")
                    .font(.callout.weight(.semibold))
            }
            .buttonStyle(.borderedProminent)
            .tint(Fleet.Color.healthy)
            .disabled(deciding)
            Button {
                Task { await store.decide(approval.id, decision: "reject") }
            } label: {
                Label("Reject", systemImage: "xmark")
                    .font(.callout.weight(.semibold))
            }
            .buttonStyle(.bordered)
            .tint(Fleet.Color.failure)
            .disabled(deciding)
        }
    }
}
