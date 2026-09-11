import SwiftUI

// MARK: - FleetControlNightshiftSection
//
// Operator-facing surface for the autonomous dispatch loop.
// Four bands stacked in a single ScrollView:
//   1. Status banner   (popper next pop / harbormaster queue / last completion)
//   2. Propose composer (multi-line TextEditor + Propose button)
//   3. In flight       (proposed / claimed / in_progress / produced rows)
//   4. Awaiting review (the big one — Approve / Reject per card)
//   5. Recent          (collapsed-by-default, last 24h of terminal states)
//
// Quality bar — every body / caption font is ≥14pt. The only ≤13pt text in
// this file lives on uppercase + bold + tracked eyebrows (state badges and
// metric titles), which by design read larger than their numeric size.

struct FleetControlNightshiftSection: View {
    @ObservedObject var store: DispatchStore
    var criticalBlockTitle: String? = nil
    @Environment(\.openURL) private var openURL

    @State private var proposeText: String = ""
    @State private var isProposing = false
    @State private var recentExpanded = false
    @State private var rejectingId: String?
    @State private var rejectionReason: String = ""
    @State private var transcriptSheet: TranscriptSheet?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Fleet.Space.l) {
                statusBanner
                if let newWorkBlockReason {
                    CriticalAttentionBanner(reason: newWorkBlockReason)
                }
                proposeComposer
                inFlightCard
                awaitingReviewCard
                recentCard

                if let err = store.lastError {
                    errorBanner(err)
                }
            }
            .padding(Fleet.Space.xl)
        }
        .background(Fleet.Chrome.popoverBackground)
        .sheet(item: $transcriptSheet) { sheet in
            TranscriptWebSheet(url: sheet.url) {
                transcriptSheet = nil
            }
        }
    }

    private var newWorkBlockReason: String? {
        CriticalAttentionGate.blockReason(
            for: .proposeDispatch,
            criticalTitle: criticalBlockTitle
        )
    }

    // MARK: - Status banner

    private var statusBanner: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            sectionHeader(
                icon: "moon.stars.fill",
                title: "Nightshift",
                subtitle: "Autonomous dispatch loop — propose, build, review, merge."
            )

            HStack(spacing: Fleet.Space.s) {
                bannerCard(
                    icon: "tray.and.arrow.down",
                    title: "Roadmap Popper",
                    primary: popperPrimary,
                    secondary: popperSecondary,
                    tint: popperTint
                )

                bannerCard(
                    icon: "anchor",
                    title: "Harbormaster",
                    primary: harborPrimary,
                    secondary: harborSecondary,
                    tint: harborTint
                )

                bannerCard(
                    icon: "checkmark.seal",
                    title: "Last Completion",
                    primary: lastCompletionPrimary,
                    secondary: lastCompletionSecondary,
                    tint: Fleet.Color.active
                )

                bannerCard(
                    icon: "clock.arrow.circlepath",
                    title: "Refresh",
                    primary: store.lastRefresh.map { relativeTime(from: $0) } ?? "—",
                    secondary: store.isRefreshing ? "polling…" : "30s cadence",
                    tint: Fleet.Color.dormant
                )
            }

            if store.dispatchRouteMissing {
                daemonRouteBanner
            }
        }
    }

    private var popperPrimary: String {
        guard let popper = store.popperStatus else { return "—" }
        return "Next pop \(popper.nextPopDisplay)"
    }

    private var popperSecondary: String {
        guard let popper = store.popperStatus else { return "popper status unavailable" }
        if let intent = popper.lastIntent, !intent.isEmpty {
            return "last: \(truncated(intent, max: 64))"
        }
        return "\(popper.queuedCount) queued"
    }

    private var popperTint: Color {
        guard let popper = store.popperStatus else { return Fleet.Color.dormant }
        if let seconds = popper.nextPopInSeconds, seconds <= 0 { return Fleet.Color.warning }
        return Fleet.Color.active
    }

    private var harborPrimary: String {
        guard let harbor = store.harbormasterStatus else { return "—" }
        let parts = ["\(harbor.queueDepth) queued", "\(harbor.mergingCount) merging"]
        return parts.joined(separator: " · ")
    }

    private var harborSecondary: String {
        guard let harbor = store.harbormasterStatus else { return "harbormaster status unavailable" }
        if let branch = harbor.lastMergeBranch, let at = harbor.lastMergeAt {
            return "merged \(branch) · \(relativeTime(from: at))"
        }
        return "no recent merges"
    }

    private var harborTint: Color {
        guard let harbor = store.harbormasterStatus else { return Fleet.Color.dormant }
        if harbor.mergingCount > 0 { return Fleet.Color.active }
        if harbor.queueDepth > 0 { return Fleet.Color.warning }
        return Fleet.Color.healthy
    }

    private var lastCompletionPrimary: String {
        guard let latest = store.dispatches
            .filter({ $0.completedAt != nil })
            .sorted(by: { ($0.completedAt ?? .distantPast) > ($1.completedAt ?? .distantPast) })
            .first,
              let completedAt = latest.completedAt
        else { return "—" }
        return relativeTime(from: completedAt)
    }

    private var lastCompletionSecondary: String {
        guard let latest = store.dispatches
            .filter({ $0.completedAt != nil })
            .sorted(by: { ($0.completedAt ?? .distantPast) > ($1.completedAt ?? .distantPast) })
            .first
        else { return "no completed dispatches yet" }
        return "\(latest.state.displayLabel.lowercased()) · \(truncated(latest.intent, max: 64))"
    }

    private var daemonRouteBanner: some View {
        HStack(alignment: .top, spacing: Fleet.Space.s) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Fleet.Color.warning)
            VStack(alignment: .leading, spacing: 2) {
                Text("Daemon route /dispatches not implemented yet")
                    .font(.system(size: 14, weight: .semibold))
                Text("This surface is wired against PR #143 + #163. Until those land, in-flight rows and review actions will be empty. Banner status (popper / harbormaster) falls back to placeholders.")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(Fleet.Space.m)
        .background(
            Fleet.Color.warning.opacity(0.10),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                .stroke(Fleet.Color.warning.opacity(0.32), lineWidth: 1)
        )
    }

    // MARK: - Propose composer

    private var proposeComposer: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            sectionHeader(
                icon: "square.and.pencil",
                title: "Propose New Dispatch",
                subtitle: "Drop a vague intent — the fleet decomposes, builds, and reviews."
            )

            VStack(alignment: .leading, spacing: Fleet.Space.s) {
                ZStack(alignment: .topLeading) {
                    TextEditor(text: $proposeText)
                        .font(.system(size: 15))
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 96)
                        .padding(Fleet.Space.s)
                        .background(
                            Fleet.Chrome.card,
                            in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                                .stroke(Fleet.Chrome.border, lineWidth: 1)
                        )
                    if proposeText.isEmpty {
                        Text("What should the fleet build tonight?")
                            .font(.system(size: 15))
                            .foregroundStyle(.tertiary)
                            .padding(.horizontal, Fleet.Space.s + 4)
                            .padding(.vertical, Fleet.Space.s + 8)
                            .allowsHitTesting(false)
                    }
                }

                HStack(spacing: Fleet.Space.s) {
                    Text("\(proposeText.count) chars")
                        .font(.system(size: 14, design: .monospaced))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button {
                        proposeText = ""
                    } label: {
                        Label("Clear", systemImage: "xmark.circle")
                            .font(.system(size: 14, weight: .medium))
                    }
                    .buttonStyle(.borderless)
                    .disabled(proposeText.isEmpty || isProposing)

                    Button {
                        guard newWorkBlockReason == nil else { return }
                        Task { await submitPropose() }
                    } label: {
                        HStack(spacing: 6) {
                            if isProposing {
                                ProgressView().controlSize(.small)
                            } else {
                                Image(systemName: "paperplane.fill")
                                    .font(.system(size: 13, weight: .semibold))
                            }
                            Text(isProposing ? "Proposing…" : "Propose")
                                .font(.system(size: 14, weight: .semibold))
                        }
                        .padding(.horizontal, Fleet.Space.m)
                        .padding(.vertical, 8)
                        .background(
                            (proposeText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                             ? Fleet.Color.active.opacity(0.35)
                             : Fleet.Color.active),
                            in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous)
                        )
                        .foregroundStyle(.white)
                    }
                    .buttonStyle(.plain)
                    .disabled(
                        proposeText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            || isProposing
                            || newWorkBlockReason != nil
                    )
                    .opacity(newWorkBlockReason == nil ? 1 : 0.48)
                    .help(newWorkBlockReason ?? "")
                }
            }
            .padding(Fleet.Space.m)
            .background(
                Fleet.Chrome.panel,
                in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
            )
        }
    }

    private func submitPropose() async {
        isProposing = true
        defer { isProposing = false }
        let id = await store.propose(intent: proposeText)
        if id != nil { proposeText = "" }
    }

    // MARK: - In-flight card

    private var inFlightCard: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            sectionHeader(
                icon: "waveform.path.ecg",
                title: "Queued + In Flight",
                subtitle: "Dispatches proposed, claimed, building, or produced."
            )

            if store.inFlight.isEmpty {
                emptyCard(
                    icon: "tray",
                    text: store.dispatchRouteMissing
                        ? "Daemon dispatch routes pending — no live rows to show."
                        : "Nothing in flight. Propose a dispatch above to wake the fleet."
                )
            } else {
                VStack(spacing: Fleet.Space.xs) {
                    ForEach(store.inFlight) { dispatch in
                        inFlightRow(dispatch)
                    }
                }
            }
        }
    }

    private func inFlightRow(_ dispatch: DispatchSnapshot) -> some View {
        HStack(alignment: .top, spacing: Fleet.Space.m) {
            stateBadge(dispatch.state)

            VStack(alignment: .leading, spacing: 4) {
                Text(truncated(dispatch.intent.isEmpty ? "(no intent recorded)" : dispatch.intent, max: 100))
                    .font(.system(size: 14, weight: .semibold))
                    .lineLimit(2)
                HStack(spacing: Fleet.Space.s) {
                    if let branch = dispatch.branch, !branch.isEmpty {
                        Label(branch, systemImage: "arrow.triangle.branch")
                            .font(.system(size: 14, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Label(dispatch.elapsedDisplay, systemImage: "clock")
                        .font(.system(size: 14, design: .monospaced))
                        .foregroundStyle(.secondary)
                    Label(dispatch.costDisplay, systemImage: "dollarsign.circle")
                        .font(.system(size: 14, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
            }

            Spacer(minLength: Fleet.Space.s)

            if let summary = dispatch.summary, !summary.isEmpty {
                Text(truncated(summary, max: 90))
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .frame(maxWidth: 280, alignment: .trailing)
                    .multilineTextAlignment(.trailing)
            }
        }
        .padding(Fleet.Space.m)
        .background(
            Fleet.Chrome.card,
            in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                .stroke(dispatch.state.color.opacity(0.20), lineWidth: 1)
        )
    }

    // MARK: - Awaiting review card

    private var awaitingReviewCard: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            sectionHeader(
                icon: "exclamationmark.bubble.fill",
                title: "Awaiting Review",
                subtitle: "Operator decision required before merge."
            )

            if store.awaitingReview.isEmpty {
                emptyCard(
                    icon: "checkmark.seal",
                    text: "Inbox zero — no dispatches awaiting your review."
                )
            } else {
                VStack(spacing: Fleet.Space.m) {
                    ForEach(store.awaitingReview) { dispatch in
                        reviewCard(dispatch)
                    }
                }
            }
        }
    }

    private func reviewCard(_ dispatch: DispatchSnapshot) -> some View {
        VStack(alignment: .leading, spacing: Fleet.Space.m) {
            HStack(alignment: .top, spacing: Fleet.Space.m) {
                stateBadge(dispatch.state)
                VStack(alignment: .leading, spacing: 4) {
                    Text(dispatch.intent.isEmpty ? "(no intent recorded)" : dispatch.intent)
                        .font(.system(size: 16, weight: .semibold))
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: Fleet.Space.s) {
                        if let branch = dispatch.branch, !branch.isEmpty {
                            Label(branch, systemImage: "arrow.triangle.branch")
                                .font(.system(size: 14, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Label(dispatch.costDisplay, systemImage: "dollarsign.circle")
                            .font(.system(size: 14, design: .monospaced))
                            .foregroundStyle(.secondary)
                        Label(dispatch.elapsedDisplay, systemImage: "clock")
                            .font(.system(size: 14, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
            }

            if let summary = dispatch.summary, !summary.isEmpty {
                Text(summary)
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: Fleet.Space.s) {
                if let prUrl = dispatch.prUrl, let url = URL(string: prUrl) {
                    Button {
                        openURL(url)
                    } label: {
                        Label("Open PR", systemImage: "arrow.up.right.square")
                            .font(.system(size: 14, weight: .medium))
                    }
                    .buttonStyle(.bordered)
                }

                Button {
                    openTranscript(for: dispatch)
                } label: {
                    Label("View Transcript", systemImage: "text.bubble")
                        .font(.system(size: 14, weight: .medium))
                }
                .buttonStyle(.bordered)
                .disabled(dispatch.transcriptId == nil)

                Spacer()

                Button {
                    guard CriticalAttentionGate.blockReason(
                        for: .approveDispatch,
                        criticalTitle: criticalBlockTitle
                    ) == nil else { return }
                    Task { await store.approve(id: dispatch.id) }
                } label: {
                    Label("Approve", systemImage: "checkmark.circle.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .padding(.horizontal, Fleet.Space.m)
                        .padding(.vertical, 8)
                        .background(
                            Fleet.Color.healthy,
                            in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous)
                                .stroke(Fleet.Color.healthy.opacity(0.85), lineWidth: 1)
                        )
                        .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
                .disabled(CriticalAttentionGate.blockReason(
                    for: .approveDispatch,
                    criticalTitle: criticalBlockTitle
                ) != nil)
                .opacity(CriticalAttentionGate.blockReason(
                    for: .approveDispatch,
                    criticalTitle: criticalBlockTitle
                ) == nil ? 1 : 0.48)
                .help(CriticalAttentionGate.blockReason(
                    for: .approveDispatch,
                    criticalTitle: criticalBlockTitle
                ) ?? "")

                Button {
                    if rejectingId == dispatch.id {
                        rejectingId = nil
                        rejectionReason = ""
                    } else {
                        rejectingId = dispatch.id
                        rejectionReason = ""
                    }
                } label: {
                    Label(rejectingId == dispatch.id ? "Cancel" : "Reject",
                          systemImage: rejectingId == dispatch.id ? "xmark.circle" : "xmark.octagon")
                        .font(.system(size: 14, weight: .medium))
                        .padding(.horizontal, Fleet.Space.m)
                        .padding(.vertical, 8)
                        .background(
                            (rejectingId == dispatch.id ? Fleet.Color.dormant.opacity(0.15) : Fleet.Color.failure.opacity(0.14)),
                            in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous)
                                .stroke(Fleet.Color.failure.opacity(0.32), lineWidth: 1)
                        )
                        .foregroundStyle(Fleet.Color.failure)
                }
                .buttonStyle(.plain)
            }

            if rejectingId == dispatch.id {
                rejectionForm(for: dispatch)
            }
        }
        .padding(Fleet.Space.l)
        .background(
            Fleet.Color.warning.opacity(0.06),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                .stroke(Fleet.Color.warning.opacity(0.28), lineWidth: 1)
        )
    }

    private func rejectionForm(for dispatch: DispatchSnapshot) -> some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            Text("Rejection reason")
                .font(.system(size: 14, weight: .semibold))

            TextEditor(text: $rejectionReason)
                .font(.system(size: 14))
                .scrollContentBackground(.hidden)
                .frame(minHeight: 64)
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
                Text(rejectionReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                     ? "Reason required — agents use this to learn."
                     : "\(rejectionReason.count) chars")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    let reason = rejectionReason
                    let id = dispatch.id
                    Task { @MainActor in
                        await store.reject(id: id, reason: reason)
                        if store.lastError == nil {
                            rejectingId = nil
                            rejectionReason = ""
                        }
                    }
                } label: {
                    Label("Submit Rejection", systemImage: "paperplane")
                        .font(.system(size: 14, weight: .semibold))
                        .padding(.horizontal, Fleet.Space.m)
                        .padding(.vertical, 8)
                        .background(
                            (rejectionReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                             ? Fleet.Color.failure.opacity(0.40)
                             : Fleet.Color.failure),
                            in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous)
                        )
                        .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
                .disabled(rejectionReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(Fleet.Space.m)
        .background(
            Fleet.Color.failure.opacity(0.05),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous)
        )
    }

    private func openTranscript(for dispatch: DispatchSnapshot) {
        // Until a native transcript detail view is wired, show the fleet-ui
        // transcript surface in an in-app sheet — never in an external browser.
        guard let transcriptId = dispatch.transcriptId else { return }
        guard let base = DaemonLocation.availableBaseURL(),
              var components = URLComponents(string: "\(base)/fleet-ui/") else { return }
        components.queryItems = [
            URLQueryItem(name: "surface", value: "transcripts"),
            URLQueryItem(name: "id", value: transcriptId),
            URLQueryItem(name: "embed", value: "fleetbar"),
        ]
        if let url = components.url {
            transcriptSheet = TranscriptSheet(url: url)
        }
    }

    // MARK: - Recent card (collapsed by default)

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
                        title: "Recent (24h)",
                        subtitle: "Accepted, rejected, settled, salvaged, failed.",
                        countBadge: store.recent.count
                    )
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if recentExpanded {
                if store.recent.isEmpty {
                    emptyCard(
                        icon: "moon.zzz",
                        text: "Nothing in the last 24 hours. The fleet is asleep — or you've already swept it."
                    )
                } else {
                    VStack(spacing: Fleet.Space.xs) {
                        ForEach(store.recent) { dispatch in
                            recentRow(dispatch)
                        }
                    }
                }
            }
        }
    }

    private func recentRow(_ dispatch: DispatchSnapshot) -> some View {
        HStack(alignment: .center, spacing: Fleet.Space.m) {
            stateBadge(dispatch.state)
            Text(truncated(dispatch.intent.isEmpty ? "(no intent recorded)" : dispatch.intent, max: 80))
                .font(.system(size: 14))
                .lineLimit(1)
            Spacer()
            Text(dispatch.costDisplay)
                .font(.system(size: 14, design: .monospaced))
                .foregroundStyle(.secondary)
            if let prUrl = dispatch.prUrl, let url = URL(string: prUrl) {
                Button {
                    openURL(url)
                } label: {
                    Image(systemName: "arrow.up.right.square")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Fleet.Color.active)
                }
                .buttonStyle(.plain)
            }
            if let completedAt = dispatch.completedAt {
                Text(relativeTime(from: completedAt))
                    .font(.system(size: 14, design: .monospaced))
                    .foregroundStyle(.tertiary)
                    .frame(width: 64, alignment: .trailing)
            }
        }
        .padding(.horizontal, Fleet.Space.m)
        .padding(.vertical, Fleet.Space.s)
        .background(
            Fleet.Chrome.card.opacity(0.6),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous)
        )
    }

    // MARK: - Shared chrome

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
                            .background(
                                Fleet.Color.active.opacity(0.14),
                                in: Capsule()
                            )
                    }
                }
                Text(subtitle)
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
    }

    private func bannerCard(icon: String, title: String, primary: String, secondary: String, tint: Color) -> some View {
        // Eyebrow exception: this 11pt label is uppercase + .bold + kerning 0.6.
        // Apparent size reads larger than the numeric pt; matches the
        // "≥600 weight + uppercase + tracking ≥0.1em" eyebrow rule.
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(tint)
                Text(title.uppercased())
                    .font(.system(size: 11, weight: .bold))
                    .kerning(0.6)
                    .foregroundStyle(.secondary)
            }
            Text(primary)
                .font(.system(size: 15, weight: .semibold, design: .monospaced))
                .foregroundStyle(tint)
                .lineLimit(1)
            Text(secondary)
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(Fleet.Space.m)
        .frame(maxWidth: .infinity, minHeight: 76, alignment: .topLeading)
        .background(
            Fleet.Chrome.card,
            in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                .stroke(tint.opacity(0.18), lineWidth: 1)
        )
    }

    private func stateBadge(_ state: DispatchState) -> some View {
        // Eyebrow exception: 11pt is permitted on uppercase + .bold + kerning 0.7.
        HStack(spacing: 4) {
            Image(systemName: state.icon)
                .font(.system(size: 11, weight: .bold))
            Text(state.displayLabel.uppercased())
                .font(.system(size: 11, weight: .bold))
                .kerning(0.7)
        }
        .foregroundStyle(state.color)
        .padding(.horizontal, Fleet.Space.s)
        .padding(.vertical, 4)
        .background(
            state.color.opacity(0.12),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous)
                .stroke(state.color.opacity(0.32), lineWidth: 1)
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
        .background(
            Fleet.Color.failure.opacity(0.08),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                .stroke(Fleet.Color.failure.opacity(0.32), lineWidth: 1)
        )
    }

    // MARK: - Formatters

    private func truncated(_ value: String, max maxChars: Int) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.count <= maxChars { return trimmed }
        let endIdx = trimmed.index(trimmed.startIndex, offsetBy: maxChars - 1)
        return String(trimmed[..<endIdx]) + "…"
    }

    private func relativeTime(from date: Date) -> String {
        let elapsed = Date().timeIntervalSince(date)
        if elapsed < 60 { return String(format: "%.0fs ago", elapsed) }
        if elapsed < 3600 {
            let m = Int(elapsed / 60)
            return "\(m)m ago"
        }
        if elapsed < 86_400 {
            let h = Int(elapsed / 3600)
            return "\(h)h ago"
        }
        let d = Int(elapsed / 86_400)
        return "\(d)d ago"
    }
}

// MARK: - Transcript sheet

private struct TranscriptSheet: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

private struct TranscriptWebSheet: View {
    let url: URL
    let dismiss: () -> Void

    @State private var reloadToken = UUID()
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: Fleet.Space.s) {
                Image(systemName: "text.bubble")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.secondary)
                Text("Transcript")
                    .font(.system(size: 15, weight: .semibold))
                Spacer()
                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                }
                Button("Done", action: dismiss)
                    .keyboardShortcut(.cancelAction)
            }
            .padding(Fleet.Space.m)

            Divider()

            if let errorMessage {
                Spacer()
                VStack(spacing: Fleet.Space.s) {
                    Image(systemName: "wifi.exclamationmark")
                        .font(.system(size: 24, weight: .medium))
                        .foregroundStyle(Fleet.Color.warning)
                    Text(errorMessage)
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                    Button("Retry") {
                        self.errorMessage = nil
                        reloadToken = UUID()
                    }
                }
                Spacer()
            } else {
                FleetControlPlaneWebView(
                    url: url,
                    reloadToken: reloadToken,
                    isLoading: $isLoading,
                    errorMessage: $errorMessage
                )
            }
        }
        .frame(minWidth: 820, minHeight: 600)
        .background(Fleet.Chrome.popoverBackground)
    }
}

// MARK: - Previews

#if DEBUG
@MainActor
private func nightshiftPreviewStore() -> DispatchStore {
    let store = DispatchStore(autoStart: false)
    // Seed sample snapshots via private state mutation is not possible
    // (let-bound `dispatches`). The preview is a structural smoke test only.
    return store
}

#Preview("Nightshift — Dark") {
    FleetControlNightshiftSection(store: nightshiftPreviewStore())
        .frame(width: 1120, height: 760)
        .preferredColorScheme(.dark)
}

#Preview("Nightshift — Light") {
    FleetControlNightshiftSection(store: nightshiftPreviewStore())
        .frame(width: 1120, height: 760)
        .preferredColorScheme(.light)
}
#endif
