import SwiftUI
import AppKit

// MARK: - FleetControlBackendSection
//
// Native SwiftUI port of the legacy /dashboard "Backend" panel
// (public/index.html → `panel-backend` + `refreshBackend()`), which was
// stripped from the dashboard in PR #138 because Fleet Control Center is
// where the operator actually looks. Backed by BackendStore (PR #138),
// which polls /fleet/models + /metrics/cost?since=86400 every 30s.
//
// Three sub-sections, stacked vertically inside a scroll view:
//
//   1. Hero card — headline backend, framing copy, today's spend.
//      If every spawn rode subscription/local, right side reads
//      "$0 today — paid by your subscription" in healthy-green.
//
//   2. Picker grid — one card per backend in BackendStore.rankedForPicker.
//      Active backend (forced via PD_USE_CLI_BACKEND) gets an accent border.
//      Each card shows a copyable `eval "$(pd backend use <id>)"` snippet.
//
//   3. Spend-by-backend table — Today / Week / Month selector. Re-fetches
//      /metrics/cost?since=… on window change via BackendStore.fetchCost.
//
// Font policy (project-level rule, vision accessibility):
//   - Body / prose / framing copy / snippets ≥ 14pt
//   - Icons may sit at 13pt (the icon — not its label)
//   - Eyebrow labels may sit at 11pt only when:
//       * weight ≥ .semibold
//       * .textCase(.uppercase) OR caller already uppercased the string
//       * .kerning(0.6) (≥0.1em-equivalent tracking)

struct FleetControlBackendSection: View {
    @ObservedObject var store: BackendStore

    @State private var windowSecs: Int = 86400
    @State private var window: BackendCostWindow = .empty
    @State private var isLoadingWindow: Bool = false
    @State private var lastAction: String?

    private static let windowOptions: [(seconds: Int, label: String, longLabel: String)] = [
        (86400,   "Today",      "today"),
        (604800,  "This week",  "this week"),
        (2592000, "This month", "this month"),
    ]

    private var windowLongLabel: String {
        Self.windowOptions.first(where: { $0.seconds == windowSecs })?.longLabel ?? "this window"
    }

    /// Resolve the headline backend using the same priority as BackendStore,
    /// but specialized to the currently selected window so the FCC hero card
    /// agrees with the spend table beneath it.
    private var headlineEntry: BackendEntry? {
        if let forced = store.forcedCliBackend,
           let entry = store.backends.first(where: { $0.id == forced }) {
            return entry
        }
        if let topSpend = window.rows.max(by: { $0.amountUsd < $1.amountUsd }),
           topSpend.amountUsd > 0,
           let entry = store.backends.first(where: { $0.id == topSpend.backend }) {
            return entry
        }
        if let sub = store.backends.first(where: { $0.isSubscriptionBacked && $0.isReady }) {
            return sub
        }
        return store.backends.first(where: { $0.isReady })
    }

    /// True when every spawn in the current window rode a subscription or
    /// local backend — drives the "paid by your subscription" framing.
    private var windowIsAllFree: Bool {
        guard !window.rows.isEmpty else { return false }
        return window.rows.allSatisfy { row in
            guard let entry = store.backends.first(where: { $0.id == row.backend }) else { return false }
            return entry.isFree
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Fleet.Space.l) {
                heroCard
                pickerCard
                spendCard

                if let lastAction {
                    Text(lastAction)
                        .font(.system(size: 14, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .padding(.top, Fleet.Space.xs)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, Fleet.Space.l)
        }
        .task {
            await refreshWindow()
        }
        .onChange(of: windowSecs) { _, _ in
            Task { await refreshWindow() }
        }
        .onReceive(store.$loadedOnce) { _ in
            // When the menubar's BackendStore refreshes, keep the local
            // window in sync if we're showing Today (same scope).
            if windowSecs == 86400 {
                Task { await refreshWindow() }
            }
        }
    }

    // MARK: - Hero card

    private var heroCard: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            if let env = store.pdUseCliBackendEnv, !env.isEmpty {
                forcedEyebrow(env: env)
            } else if let forced = store.forcedCliBackend, !forced.isEmpty {
                forcedEyebrow(env: forced)
            }

            HStack(alignment: .top, spacing: Fleet.Space.l) {
                heroLeftSide
                Spacer(minLength: Fleet.Space.m)
                heroSpendBlock
            }
        }
        .padding(Fleet.Space.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(
                colors: [Fleet.Chrome.card, Fleet.Chrome.panelRaised],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                .stroke(Fleet.Color.active.opacity(0.22), lineWidth: 1)
        )
    }

    private func forcedEyebrow(env: String) -> some View {
        HStack(spacing: Fleet.Space.xs) {
            Image(systemName: "lock.fill")
                .font(.system(size: 11, weight: .semibold))
            Text("Forced via PD_USE_CLI_BACKEND=\(env)")
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .textCase(.uppercase)
                .kerning(0.6)
        }
        .foregroundStyle(Fleet.Color.active)
    }

    @ViewBuilder
    private var heroLeftSide: some View {
        if let entry = headlineEntry {
            VStack(alignment: .leading, spacing: 6) {
                Text(entry.name)
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(.primary)
                if let framing = entry.framing, !framing.isEmpty {
                    Text(framing)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(entry.costKind.color)
                }
                if let tagline = entry.tagline, !tagline.isEmpty {
                    Text(tagline)
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                        .italic()
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        } else if !store.loadedOnce {
            VStack(alignment: .leading, spacing: Fleet.Space.xs) {
                ProgressView()
                    .progressViewStyle(.linear)
                Text("Loading backend catalog…")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Text("No backend ready")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.primary)
                Text("Install `claude` or `codex` to ride your Claude Max / ChatGPT Pro subscription at $0 marginal cost.")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private var heroSpendBlock: some View {
        VStack(alignment: .trailing, spacing: 4) {
            Text("Spend \(windowLongLabel)".uppercased())
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(.secondary)
                .kerning(0.6)

            if isLoadingWindow && window.rows.isEmpty {
                ProgressView()
                    .controlSize(.small)
                    .padding(.vertical, 4)
            } else if windowIsAllFree && window.totalUsd < 0.005 {
                Text("$0")
                    .font(.system(size: 28, weight: .bold, design: .monospaced))
                    .foregroundStyle(Fleet.Color.healthy)
                Text("paid by your subscription")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Fleet.Color.healthy)
            } else {
                Text(spendDisplay)
                    .font(.system(size: 28, weight: .bold, design: .monospaced))
                    .foregroundStyle(window.totalUsd > 0 ? Fleet.Color.warning : Fleet.Color.dormant)
                Text("\(window.totalSpawns) spawn\(window.totalSpawns == 1 ? "" : "s")")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(minWidth: 180, alignment: .trailing)
    }

    private var spendDisplay: String {
        if window.totalUsd >= 1 {
            return String(format: "$%.2f", window.totalUsd)
        }
        return String(format: "$%.4f", window.totalUsd)
    }

    // MARK: - Picker card (cards grid)

    private var pickerCard: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            cardTitle("Switch backend", icon: "rectangle.stack.badge.person.crop")

            Text("PD_USE_CLI_BACKEND forces every fleet spawn through a single CLI route, regardless of pd-fleet.yml. Subscription backends are recommended — they ride your existing Claude Max / ChatGPT Pro at $0 marginal cost.")
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, Fleet.Space.xs)

            if !store.loadedOnce {
                ProgressView()
                    .progressViewStyle(.linear)
                    .padding(.vertical, Fleet.Space.s)
            } else if store.backends.isEmpty {
                Text("Daemon is not running or /fleet/models is unavailable.")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: Fleet.Space.m)],
                          alignment: .leading,
                          spacing: Fleet.Space.m) {
                    ForEach(store.rankedForPicker) { entry in
                        BackendCardLarge(
                            entry: entry,
                            isActive: store.forcedCliBackend == entry.id,
                            onSelect: { selectEntry(entry) }
                        )
                    }
                }

                if let forced = store.forcedCliBackend, !forced.isEmpty {
                    HStack(spacing: Fleet.Space.xs) {
                        Image(systemName: "arrow.uturn.backward.circle")
                            .font(.system(size: 13))
                        Text("To stop forcing:")
                            .font(.system(size: 14))
                        Text("eval \"$(pd backend use none)\"")
                            .font(.system(size: 14, design: .monospaced))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(
                                Fleet.Color.active.opacity(0.12),
                                in: RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous)
                            )
                            .foregroundStyle(Fleet.Color.active)
                            .textSelection(.enabled)
                        Text("then restart the daemon.")
                            .font(.system(size: 14))
                            .foregroundStyle(.secondary)
                        Spacer(minLength: 0)
                        Button {
                            clearForced()
                        } label: {
                            Label("Disable", systemImage: "arrow.uturn.backward")
                                .font(.system(size: 14, weight: .semibold))
                        }
                        .buttonStyle(.borderless)
                        .foregroundStyle(Fleet.Color.warning)
                    }
                    .padding(.top, Fleet.Space.s)
                }
            }
        }
        .padding(Fleet.Space.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Fleet.Chrome.panel,
            in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                .stroke(Fleet.Chrome.border, lineWidth: 1)
        )
    }

    // MARK: - Spend card (window selector + table)

    private var spendCard: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            HStack(alignment: .center, spacing: Fleet.Space.m) {
                cardTitle("Spend by backend", icon: "chart.bar.xaxis")
                Spacer()
                Picker("Window", selection: $windowSecs) {
                    ForEach(Self.windowOptions, id: \.seconds) { option in
                        Text(option.label).tag(option.seconds)
                    }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 280)
                .labelsHidden()

                Button {
                    Task { await refreshWindow() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 13, weight: .semibold))
                }
                .buttonStyle(.borderless)
                .foregroundStyle(Fleet.Color.active)
                .help("Refresh spend rollup")
            }

            if isLoadingWindow && window.rows.isEmpty {
                ProgressView()
                    .progressViewStyle(.linear)
                    .padding(.vertical, Fleet.Space.s)
            } else if window.rows.isEmpty {
                Text("No spawns recorded \(windowLongLabel).")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .padding(.vertical, Fleet.Space.s)
            } else {
                spendTable
            }
        }
        .padding(Fleet.Space.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Fleet.Chrome.panel,
            in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                .stroke(Fleet.Chrome.border, lineWidth: 1)
        )
    }

    private var spendTable: some View {
        VStack(spacing: 0) {
            // Header row
            HStack(spacing: Fleet.Space.m) {
                tableHeader("Backend", width: 180, alignment: .leading)
                tableHeader("Cost model", width: 160, alignment: .leading)
                tableHeader("Spend", width: 110, alignment: .trailing)
                tableHeader("Spawns", width: 80, alignment: .trailing)
                tableHeader("Framing", width: nil, alignment: .leading)
            }
            .padding(.horizontal, Fleet.Space.s)
            .padding(.vertical, Fleet.Space.xs)
            .background(Color.primary.opacity(0.04))

            Divider()

            // Data rows, ranked by spend desc
            ForEach(sortedRows) { row in
                let entry = store.backends.first(where: { $0.id == row.backend })
                spendRow(row: row, entry: entry)
                Divider()
                    .opacity(0.5)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous)
                .stroke(Fleet.Chrome.border, lineWidth: 1)
        )
    }

    private var sortedRows: [BackendCostRow] {
        window.rows.sorted { $0.amountUsd > $1.amountUsd }
    }

    private func spendRow(row: BackendCostRow, entry: BackendEntry?) -> some View {
        HStack(spacing: Fleet.Space.m) {
            Text(row.backend)
                .font(.system(size: 14, design: .monospaced))
                .frame(width: 180, alignment: .leading)

            CostModelBadge(kind: entry?.costKind ?? .unknown)
                .frame(width: 160, alignment: .leading)

            Text(String(format: "$%.4f", row.amountUsd))
                .font(.system(size: 14, design: .monospaced))
                .foregroundStyle(row.amountUsd > 0 ? Fleet.Color.warning : .secondary)
                .frame(width: 110, alignment: .trailing)

            Text("\(row.count)")
                .font(.system(size: 14, design: .monospaced))
                .frame(width: 80, alignment: .trailing)

            Text(entry?.framing ?? "—")
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, Fleet.Space.s)
        .padding(.vertical, Fleet.Space.s)
    }

    private func tableHeader(_ title: String, width: CGFloat?, alignment: Alignment) -> some View {
        Text(title.uppercased())
            .font(.system(size: 11, weight: .semibold, design: .monospaced))
            .foregroundStyle(.secondary)
            .kerning(0.6)
            .frame(width: width, alignment: alignment)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: alignment)
    }

    // MARK: - Helpers

    private func cardTitle(_ title: String, icon: String) -> some View {
        HStack(spacing: Fleet.Space.xs) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Fleet.Color.active)
            Text(title)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.primary)
        }
    }

    private func selectEntry(_ entry: BackendEntry) {
        guard let envValue = entry.pdUseCliBackendValue else {
            lastAction = "‘\(entry.name)’ isn’t a CLI-routable backend; cannot force via env."
            return
        }
        BackendCLIPersistence.write(envValue)
        lastAction = "Wrote PD_USE_CLI_BACKEND=\(envValue) to ~/.port-daddy-cli-backend. Restart the daemon to apply."
        Task {
            await store.refresh()
            await refreshWindow()
        }
    }

    private func clearForced() {
        BackendCLIPersistence.clear()
        lastAction = "Cleared ~/.port-daddy-cli-backend. Restart the daemon to apply."
        Task {
            await store.refresh()
            await refreshWindow()
        }
    }

    private func refreshWindow() async {
        isLoadingWindow = true
        let next = await store.fetchCost(since: windowSecs)
        window = next
        isLoadingWindow = false
    }
}

// MARK: - BackendCardLarge
//
// The desktop-sized backend card. Mirrors the picker-grid card from the
// legacy dashboard (one card per catalog entry, cost-model badge, framing
// copy, copyable eval snippet). Active backend gets an accent border.

private struct BackendCardLarge: View {
    let entry: BackendEntry
    let isActive: Bool
    let onSelect: () -> Void
    @State private var copiedSnippet: Bool = false

    private var canForce: Bool { entry.pdUseCliBackendValue != nil }

    private var evalSnippet: String? {
        guard let value = entry.pdUseCliBackendValue else { return nil }
        return "eval \"$(pd backend use \(value))\""
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            // Top: name + ready/active badge
            HStack(alignment: .firstTextBaseline, spacing: Fleet.Space.s) {
                Text(entry.name)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Spacer()
                readinessBadge
            }

            // Cost model badge
            CostModelBadge(kind: entry.costKind)

            // Framing copy (14pt minimum)
            if let framing = entry.framing, !framing.isEmpty {
                Text(framing)
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineLimit(3)
            }

            // Tagline (italic, secondary)
            if let tagline = entry.tagline, !tagline.isEmpty {
                Text(tagline)
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary.opacity(0.85))
                    .italic()
                    .fixedSize(horizontal: false, vertical: true)
                    .lineLimit(3)
            }

            Spacer(minLength: Fleet.Space.xs)

            // Eval snippet or next-step
            if let snippet = evalSnippet {
                evalSnippetRow(snippet)
                useButton
            } else if !entry.isReady, let nextStep = entry.readinessNextStep, !nextStep.isEmpty {
                Text(nextStep)
                    .font(.system(size: 14, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(Fleet.Space.m)
        .frame(maxWidth: .infinity, minHeight: 220, alignment: .topLeading)
        .background(cardBackground)
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                .stroke(cardBorder, lineWidth: isActive ? 2 : 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
    }

    private var cardBackground: some View {
        Group {
            if isActive {
                entry.costKind.color.opacity(0.10)
            } else {
                Fleet.Chrome.card
            }
        }
    }

    private var cardBorder: Color {
        if isActive { return entry.costKind.color }
        if entry.isSubscriptionBacked && entry.isReady { return Fleet.Color.healthy.opacity(0.45) }
        return Fleet.Chrome.border
    }

    @ViewBuilder
    private var readinessBadge: some View {
        if isActive {
            badgePill("ACTIVE", color: entry.costKind.color, bold: true)
        } else if entry.isReady {
            badgePill("READY", color: Fleet.Color.healthy)
        } else if entry.readinessStatus == "manual_check" {
            badgePill("CHECK", color: Fleet.Color.warning)
        } else if entry.readinessStatus == "needs_setup" {
            badgePill("SETUP", color: Fleet.Color.dormant)
        } else {
            badgePill("—", color: Fleet.Color.dormant)
        }
    }

    private func badgePill(_ text: String, color: Color, bold: Bool = false) -> some View {
        Text(text)
            .font(.system(size: 11, weight: bold ? .bold : .semibold, design: .monospaced))
            .foregroundStyle(color)
            .kerning(0.6)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(
                color.opacity(0.16),
                in: RoundedRectangle(cornerRadius: 3, style: .continuous)
            )
    }

    private func evalSnippetRow(_ snippet: String) -> some View {
        HStack(spacing: Fleet.Space.xs) {
            Text(snippet)
                .font(.system(size: 14, design: .monospaced))
                .foregroundStyle(Fleet.Color.active)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)

            Button {
                copySnippet(snippet)
            } label: {
                Image(systemName: copiedSnippet ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 14, weight: .semibold))
            }
            .buttonStyle(.borderless)
            .foregroundStyle(copiedSnippet ? Fleet.Color.healthy : Fleet.Color.active)
            .help(copiedSnippet ? "Copied" : "Copy snippet")
        }
        .padding(.horizontal, Fleet.Space.s)
        .padding(.vertical, Fleet.Space.xs)
        .background(
            Color.primary.opacity(0.05),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous)
        )
    }

    private var useButton: some View {
        Button {
            onSelect()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: isActive ? "checkmark.circle.fill" : "bolt.horizontal.circle")
                    .font(.system(size: 13, weight: .semibold))
                Text(isActive ? "Currently active" : "Use this backend")
                    .font(.system(size: 14, weight: .semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, Fleet.Space.xs)
            .background(
                (isActive ? Fleet.Color.healthy : entry.costKind.color).opacity(0.16),
                in: RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous)
            )
            .foregroundStyle(isActive ? Fleet.Color.healthy : entry.costKind.color)
        }
        .buttonStyle(.plain)
        .disabled(!canForce || isActive)
        .opacity(canForce ? 1.0 : 0.55)
    }

    private func copySnippet(_ snippet: String) {
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(snippet, forType: .string)
        copiedSnippet = true
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            await MainActor.run { copiedSnippet = false }
        }
    }
}

// MARK: - CostModelBadge
//
// Shared between the picker cards and the spend table. Eyebrow-style label
// (uppercase + bold + tracked) so it can sit at 11pt without violating the
// 14pt body-text rule.

private struct CostModelBadge: View {
    let kind: BackendCostKind

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .semibold))
            Text(kind.badgeText)
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .textCase(.uppercase)
                .kerning(0.6)
        }
        .foregroundStyle(kind.color)
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(
            kind.color.opacity(0.14),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous)
        )
    }

    private var icon: String {
        switch kind {
        case .subscription: return "checkmark.seal.fill"
        case .local:        return "internaldrive"
        case .metered:      return "creditcard"
        case .cli:          return "terminal"
        case .unknown:      return "questionmark.circle"
        }
    }
}

// MARK: - Preview

#Preview("Backend Section — Dark") {
    FleetControlBackendSection(store: BackendStore(autoStart: false))
        .frame(width: 1100, height: 800)
        .background(Fleet.Chrome.popoverBackground)
        .preferredColorScheme(.dark)
}

#Preview("Backend Section — Light") {
    FleetControlBackendSection(store: BackendStore(autoStart: false))
        .frame(width: 1100, height: 800)
        .background(Fleet.Chrome.popoverBackground)
        .preferredColorScheme(.light)
}
