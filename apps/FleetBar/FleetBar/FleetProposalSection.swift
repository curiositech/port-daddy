import SwiftUI

struct FleetProposalSection: View {
    @ObservedObject var store: FleetProposalStore
    var criticalBlockTitle: String? = nil
    @Environment(\.openURL) private var openURL

    @State private var rejectingId: String?
    @State private var rejectionReason = ""
    @State private var recentExpanded = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Fleet.Space.l) {
                header
                if let blockReason {
                    CriticalAttentionBanner(reason: blockReason)
                }
                pendingCard
                recentCard

                if let err = store.lastError {
                    errorBanner(err)
                }
            }
            .padding(Fleet.Space.xl)
        }
        .background(Fleet.Chrome.popoverBackground)
        .task { await store.refresh() }
    }

    private var blockReason: String? {
        CriticalAttentionGate.blockReason(
            for: .assignProposal,
            criticalTitle: criticalBlockTitle
        )
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            HStack(spacing: Fleet.Space.s) {
                Image(systemName: "person.crop.circle.badge.questionmark")
                    .foregroundStyle(Fleet.Color.active)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Fleet Proposals")
                        .font(.system(size: 18, weight: .semibold))
                    Text("Spark, Spider, and other ships ask here before a specialist bot writes a PR.")
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    Task { await store.refresh() }
                } label: {
                    Label(store.isRefreshing ? "Refreshing" : "Refresh", systemImage: "arrow.clockwise")
                        .font(.system(size: 14, weight: .semibold))
                }
                .buttonStyle(.bordered)
                .disabled(store.isRefreshing)
            }

            HStack(spacing: Fleet.Space.s) {
                metricChip(title: "Pending", value: "\(store.pendingCount)", tint: store.pendingCount > 0 ? Fleet.Color.warning : Fleet.Color.healthy)
                metricChip(title: "Route", value: store.routeMissing ? "missing" : "ready", tint: store.routeMissing ? Fleet.Color.failure : Fleet.Color.healthy)
                metricChip(title: "Last refresh", value: store.lastRefresh.map { relativeTime(from: $0) } ?? "—", tint: Fleet.Color.dormant)
            }
        }
    }

    private var pendingCard: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            sectionHeader(
                icon: "checklist.checked",
                title: "Awaiting Approval",
                subtitle: "Yes assigns the packet to a specialist dispatch; no records the reason."
            )

            if store.pending.isEmpty {
                emptyCard(
                    icon: "checkmark.seal",
                    text: store.routeMissing
                        ? "Daemon proposal routes are not available in this build."
                        : "No ship proposals are waiting for approval."
                )
            } else {
                VStack(spacing: Fleet.Space.m) {
                    ForEach(store.pending) { proposal in
                        proposalCard(proposal, interactive: true)
                    }
                }
            }
        }
    }

    private var recentCard: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            Button {
                withAnimation(Fleet.Motion.snappy) { recentExpanded.toggle() }
            } label: {
                HStack(spacing: Fleet.Space.s) {
                    Image(systemName: recentExpanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.secondary)
                    sectionHeader(
                        icon: "clock.arrow.circlepath",
                        title: "Recent Decisions",
                        subtitle: "Approved, rejected, and assigned proposal packets.",
                        countBadge: store.recentDecisions.count
                    )
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if recentExpanded {
                if store.recentDecisions.isEmpty {
                    emptyCard(icon: "tray", text: "No proposal decisions recorded yet.")
                } else {
                    VStack(spacing: Fleet.Space.s) {
                        ForEach(store.recentDecisions) { proposal in
                            proposalCard(proposal, interactive: false)
                        }
                    }
                }
            }
        }
    }

    private func proposalCard(_ proposal: FleetProposalSnapshot, interactive: Bool) -> some View {
        VStack(alignment: .leading, spacing: Fleet.Space.m) {
            HStack(alignment: .top, spacing: Fleet.Space.m) {
                statusBadge(proposal.status)
                VStack(alignment: .leading, spacing: 5) {
                    Text(proposal.title)
                        .font(.system(size: 16, weight: .semibold))
                        .fixedSize(horizontal: false, vertical: true)
                    Text(proposal.summary)
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: Fleet.Space.s) {
                        Label(proposal.sourceDisplay, systemImage: "sparkles")
                        Label(proposal.assignmentDisplay, systemImage: "person.crop.circle.badge.checkmark")
                        Label(proposal.budgetDisplay, systemImage: "dollarsign.circle")
                    }
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                }
                Spacer(minLength: 0)
            }

            VStack(alignment: .leading, spacing: Fleet.Space.s) {
                if let validation = proposal.validationPlan, !validation.isEmpty {
                    Text("Validation")
                        .font(.system(size: 14, weight: .semibold))
                    Text(validation)
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !proposal.expectedArtifacts.isEmpty {
                    Text("Expected artifacts")
                        .font(.system(size: 14, weight: .semibold))
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(proposal.expectedArtifacts, id: \.self) { item in
                            Label(item, systemImage: "doc.badge.gearshape")
                                .font(.system(size: 14))
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Text(proposal.proposalMarkdown)
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .lineLimit(8)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(Fleet.Space.m)
            .background(
                Fleet.Chrome.card.opacity(0.7),
                in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
            )

            if interactive {
                HStack(spacing: Fleet.Space.s) {
                    ForEach(proposal.links, id: \.url) { link in
                        if let url = URL(string: link.url), url.scheme == "http" || url.scheme == "https" {
                            Button {
                                openURL(url)
                            } label: {
                                Label(link.label, systemImage: "arrow.up.right.square")
                                    .font(.system(size: 14, weight: .medium))
                            }
                            .buttonStyle(.bordered)
                        }
                    }

                    Spacer()

                    Button {
                        guard blockReason == nil else { return }
                        Task { await store.approve(id: proposal.id) }
                    } label: {
                        Label("Yes, Assign", systemImage: "checkmark.circle.fill")
                            .font(.system(size: 14, weight: .semibold))
                            .padding(.horizontal, Fleet.Space.m)
                            .padding(.vertical, 8)
                            .background(
                                Fleet.Color.healthy,
                                in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous)
                            )
                            .foregroundStyle(.white)
                    }
                    .buttonStyle(.plain)
                    .disabled(blockReason != nil)
                    .opacity(blockReason == nil ? 1 : 0.48)
                    .help(blockReason ?? "")

                    Button {
                        if rejectingId == proposal.id {
                            rejectingId = nil
                            rejectionReason = ""
                        } else {
                            rejectingId = proposal.id
                            rejectionReason = ""
                        }
                    } label: {
                        Label(rejectingId == proposal.id ? "Cancel" : "No", systemImage: rejectingId == proposal.id ? "xmark.circle" : "xmark.octagon")
                            .font(.system(size: 14, weight: .medium))
                            .padding(.horizontal, Fleet.Space.m)
                            .padding(.vertical, 8)
                            .background(
                                Fleet.Color.failure.opacity(0.12),
                                in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous)
                            )
                            .foregroundStyle(Fleet.Color.failure)
                    }
                    .buttonStyle(.plain)
                }

                if rejectingId == proposal.id {
                    rejectionForm(for: proposal)
                }
            } else if let dispatchId = proposal.dispatchId {
                Label("Assigned dispatch \(dispatchId)", systemImage: "paperplane.circle")
                    .font(.system(size: 14, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(Fleet.Space.l)
        .background(
            proposal.status.color.opacity(0.07),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                .stroke(proposal.status.color.opacity(0.26), lineWidth: 1)
        )
    }

    private func rejectionForm(for proposal: FleetProposalSnapshot) -> some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            Text("Why not?")
                .font(.system(size: 14, weight: .semibold))
            TextEditor(text: $rejectionReason)
                .font(.system(size: 14))
                .scrollContentBackground(.hidden)
                .frame(minHeight: 66)
                .padding(Fleet.Space.s)
                .background(
                    Fleet.Chrome.card,
                    in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous)
                        .stroke(Fleet.Color.failure.opacity(0.25), lineWidth: 1)
                )
            HStack {
                Text(rejectionReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Reason required." : "\(rejectionReason.count) chars")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    let reason = rejectionReason
                    Task { @MainActor in
                        await store.reject(id: proposal.id, reason: reason)
                        if store.lastError == nil {
                            rejectingId = nil
                            rejectionReason = ""
                        }
                    }
                } label: {
                    Label("Record No", systemImage: "paperplane")
                        .font(.system(size: 14, weight: .semibold))
                        .padding(.horizontal, Fleet.Space.m)
                        .padding(.vertical, 8)
                        .background(
                            Fleet.Color.failure,
                            in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous)
                        )
                        .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
                .disabled(rejectionReason.trimmingCharacters(in: .whitespacesAndNewlines).count < 3)
            }
        }
        .padding(Fleet.Space.m)
        .background(
            Fleet.Color.failure.opacity(0.05),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous)
        )
    }

    private func metricChip(title: String, value: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased())
                .font(.system(size: 11, weight: .bold))
                .kerning(0.6)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 15, weight: .semibold, design: .monospaced))
                .foregroundStyle(tint)
        }
        .padding(Fleet.Space.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Fleet.Chrome.card,
            in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                .stroke(tint.opacity(0.18), lineWidth: 1)
        )
    }

    private func sectionHeader(icon: String, title: String, subtitle: String, countBadge: Int? = nil) -> some View {
        HStack(spacing: Fleet.Space.s) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Fleet.Color.active)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Fleet.Space.xs) {
                    Text(title)
                        .font(.system(size: 16, weight: .semibold))
                    if let countBadge, countBadge > 0 {
                        Text("\(countBadge)")
                            .font(.system(size: 14, weight: .semibold, design: .monospaced))
                            .foregroundStyle(Fleet.Color.active)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(Fleet.Color.active.opacity(0.14), in: Capsule())
                    }
                }
                Text(subtitle)
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
    }

    private func statusBadge(_ status: FleetProposalStatus) -> some View {
        HStack(spacing: 4) {
            Image(systemName: status.icon)
                .font(.system(size: 11, weight: .bold))
            Text(status.displayLabel.uppercased())
                .font(.system(size: 11, weight: .bold))
                .kerning(0.7)
        }
        .foregroundStyle(status.color)
        .padding(.horizontal, Fleet.Space.s)
        .padding(.vertical, 4)
        .background(status.color.opacity(0.12), in: RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous)
                .stroke(status.color.opacity(0.32), lineWidth: 1)
        )
    }

    private func emptyCard(icon: String, text: String) -> some View {
        HStack(spacing: Fleet.Space.s) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(.secondary)
            Text(text)
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
        .padding(Fleet.Space.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Fleet.Chrome.card.opacity(0.5),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                .strokeBorder(Fleet.Chrome.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
        )
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: Fleet.Space.s) {
            Image(systemName: "exclamationmark.octagon")
                .foregroundStyle(Fleet.Color.failure)
            Text(message)
                .font(.system(size: 14))
                .foregroundStyle(.primary)
            Spacer()
            Button {
                Task { await store.refresh() }
            } label: {
                Text("Retry")
                    .font(.system(size: 14, weight: .semibold))
            }
            .buttonStyle(.borderless)
        }
        .padding(Fleet.Space.m)
        .background(Fleet.Color.failure.opacity(0.08), in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                .stroke(Fleet.Color.failure.opacity(0.32), lineWidth: 1)
        )
    }

    private func relativeTime(from date: Date) -> String {
        let elapsed = Date().timeIntervalSince(date)
        if elapsed < 60 { return String(format: "%.0fs ago", elapsed) }
        if elapsed < 3600 { return "\(Int(elapsed / 60))m ago" }
        if elapsed < 86_400 { return "\(Int(elapsed / 3600))h ago" }
        return "\(Int(elapsed / 86_400))d ago"
    }
}

#if DEBUG
#Preview("Fleet Proposals — Dark") {
    FleetProposalSection(store: FleetProposalStore(autoStart: false))
        .frame(width: 1120, height: 760)
        .preferredColorScheme(.dark)
}
#endif
