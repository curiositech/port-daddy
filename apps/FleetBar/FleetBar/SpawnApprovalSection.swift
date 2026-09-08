import SwiftUI

// MARK: - Spawn approvals section (menu-bar popover, ADR-0093 HITL)
//
// Pinned at the very top of the FleetBar dropdown: a spawn the trust gate is
// holding is the one thing the operator must not miss. Renders nothing when
// the queue is empty — no dead chrome.
//
// While a CRITICAL operator interruption is open (docs/hitl-interruptions.md
// §4 clause 3), Approve is disabled — approving would start NEW dependent
// agent work — and the section says exactly why, with a deep-link to the
// web answer page. Reject stays enabled: declining work is not new work.

struct SpawnApprovalSection: View {
    @ObservedObject var store: SpawnApprovalStore

    /// Title of the open critical interruption that blocks new spawns, or
    /// nil when spawning is allowed. Supplied by InterruptionsStore.
    var criticalBlockTitle: String? = nil
    /// Deep-link to the session-gated answer page; nil hides the link.
    var openAnswerPage: (() -> Void)? = nil

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

                if let blockedTitle = criticalBlockTitle {
                    blockBanner(blockedTitle)
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
    private func blockBanner(_ title: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Fleet.Space.xs) {
            Image(systemName: "nosign")
                .foregroundStyle(Fleet.Color.failure)
            Text("Approvals paused: critical operator ask \u{201C}\(title)\u{201D} is open.")
                .font(.callout.weight(.semibold))
                .foregroundStyle(Fleet.Color.failure)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if let openAnswerPage {
                Button {
                    openAnswerPage()
                } label: {
                    Label("Answer on web", systemImage: "arrow.up.right.square")
                        .font(.callout.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .tint(Fleet.Color.failure)
            }
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
            let spawnsBlocked = criticalBlockTitle != nil
            Button {
                Task { await store.decide(approval.id, decision: "approve") }
            } label: {
                Label("Approve", systemImage: "checkmark")
                    .font(.callout.weight(.semibold))
            }
            .buttonStyle(.borderedProminent)
            .tint(Fleet.Color.healthy)
            .disabled(deciding || spawnsBlocked)
            .help(
                spawnsBlocked
                    ? "Blocked: critical operator ask \u{201C}\(criticalBlockTitle ?? "")\u{201D} is open. Answer it on the web first."
                    : "Approve this spawn"
            )
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
