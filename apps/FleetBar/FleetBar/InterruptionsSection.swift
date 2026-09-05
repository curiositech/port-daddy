import SwiftUI
import AppKit

// MARK: - Operator interruptions section (docs/hitl-interruptions.md §4)
//
// Always rendered — the contract forbids a hidden widget. Three honest looks:
//   - unknown / signed out: status is UNKNOWN (never "all clear"),
//   - zero open asks after a successful poll: a quiet honest empty state,
//   - open asks: badge count + rows (title, urgency, source agent, age),
//     loud red for high/critical, and a note when spawns are blocked.
//
// Answer/ack deliberately deep-links to the session-gated web page. There is
// no in-app answer path: the pdu_ bearer token FleetBar holds must never be
// able to silence an escalation.

struct InterruptionsSection: View {
    @ObservedObject var store: InterruptionsStore
    @Environment(\.openSettings) private var openSettings

    /// Injectable for tests; production opens the default browser.
    var openAnswerPage: (URL) -> Void = { NSWorkspace.shared.open($0) }
    /// Injectable clock so ages are stable in tests and previews.
    var now: () -> Date = Date.init

    var body: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            header
            content
        }
        .padding(.horizontal, Fleet.Space.m)
        .padding(.vertical, Fleet.Space.s)
        .background(store.hasLoudOpenAsk ? Fleet.Color.failure.opacity(0.10) : Color.clear)
        .accessibilityElement(children: .contain)
    }

    // MARK: Header

    @ViewBuilder
    private var header: some View {
        HStack(spacing: Fleet.Space.xs) {
            Image(systemName: headerIcon)
                .foregroundStyle(headerTint)
            Text("Operator interruptions")
                .font(.callout.weight(.semibold))
            countBadge
            Spacer()
            if let url = store.answerPageURL, !store.openItems.isEmpty {
                Button {
                    openAnswerPage(url)
                } label: {
                    Label("Answer on web", systemImage: "arrow.up.right.square")
                        .font(.callout.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .tint(store.hasLoudOpenAsk ? Fleet.Color.failure : Fleet.Color.active)
                .help("Answer or acknowledge on the account page — sign-in required by design.")
            }
        }
    }

    private var headerIcon: String {
        switch store.phase {
        case .open(let items):
            return items.isEmpty ? "bell" : "bell.badge.fill"
        case .signedOut:
            return "person.crop.circle.badge.questionmark"
        case .unknown:
            return "questionmark.circle"
        }
    }

    private var headerTint: Color {
        if store.hasLoudOpenAsk { return Fleet.Color.failure }
        if case .open(let items) = store.phase, !items.isEmpty { return Fleet.Color.warning }
        if case .open = store.phase { return Fleet.Color.dormant }
        return Fleet.Color.warning
    }

    @ViewBuilder
    private var countBadge: some View {
        if let count = store.openCount {
            Text("\(count)")
                .font(.callout.weight(.bold))
                .foregroundStyle(count > 0 && store.hasLoudOpenAsk ? Color.white : Color.primary)
                .padding(.horizontal, Fleet.Space.s)
                .padding(.vertical, 1)
                .background(
                    count > 0
                        ? (store.hasLoudOpenAsk ? Fleet.Color.failure : Fleet.Color.warning.opacity(0.35))
                        : Fleet.Color.dormant.opacity(0.2),
                    in: Capsule()
                )
                .accessibilityLabel("\(count) open operator interruptions")
        } else {
            // Count unknowable — never render a reassuring zero.
            Text("?")
                .font(.callout.weight(.bold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, Fleet.Space.s)
                .padding(.vertical, 1)
                .background(Fleet.Color.warning.opacity(0.25), in: Capsule())
                .accessibilityLabel("open interruption count unknown")
        }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        switch store.phase {
        case .unknown(let reason):
            // A failed poll is UNKNOWN, never all-clear.
            VStack(alignment: .leading, spacing: 2) {
                Text("Status unknown — the last poll did not succeed.")
                    .font(.callout.weight(.medium))
                    .foregroundStyle(Fleet.Color.warning)
                Text(reason)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case .signedOut:
            VStack(alignment: .leading, spacing: 2) {
                Text("Status unknown — not signed in.")
                    .font(.callout.weight(.medium))
                    .foregroundStyle(Fleet.Color.warning)
                Text("Connect your account in FleetBar so operator asks can surface here.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Button {
                    openSettings()
                } label: {
                    Label("Open Account Settings", systemImage: "person.crop.circle.badge.plus")
                        .font(.callout.weight(.semibold))
                }
                .buttonStyle(.bordered)
            }
        case .open(let items):
            if items.isEmpty {
                // The honest empty state: backed by a successful poll.
                Text("No open operator asks.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                if let blockedTitle = store.criticalSpawnBlockTitle {
                    spawnBlockNote(blockedTitle)
                }
                ForEach(items) { item in
                    interruptionRow(item)
                }
            }
        }
    }

    @ViewBuilder
    private func spawnBlockNote(_ title: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Fleet.Space.xs) {
            Image(systemName: "nosign")
                .foregroundStyle(Fleet.Color.failure)
            Text("New spawns are blocked until the critical ask \u{201C}\(title)\u{201D} is answered.")
                .font(.callout.weight(.semibold))
                .foregroundStyle(Fleet.Color.failure)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private func interruptionRow(_ item: OperatorInterruption) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Fleet.Space.s) {
            Text(item.urgency.label)
                .font(.system(size: 12, weight: .bold))
                .tracking(1.2)
                .foregroundStyle(item.urgency.isLoud ? Color.white : item.urgency.color)
                .padding(.horizontal, Fleet.Space.xs + 1)
                .padding(.vertical, 1)
                .background(
                    item.urgency.isLoud ? item.urgency.color : item.urgency.color.opacity(0.15),
                    in: RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous)
                )
                .accessibilityLabel("urgency \(item.urgency.rawValue)")

            VStack(alignment: .leading, spacing: 1) {
                Text(item.title)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(item.urgency.isLoud ? Fleet.Color.failure : Color.primary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                Text("from \(item.sourceAgent) · \(item.age(now: now())) ago")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Previews (the three contract states, renderable without a relay)

#Preview("Empty (honest)") {
    InterruptionsSection(store: .fixture(phase: .open([])))
        .frame(width: 440)
}

#Preview("Open — normal") {
    InterruptionsSection(store: .fixture(phase: .open([
        OperatorInterruption(
            id: "oi_1",
            title: "Which staging database should the migration target?",
            urgency: .normal,
            sourceAgent: "fleet-executor",
            createdAt: Date().timeIntervalSince1970 - 300
        ),
    ])))
    .frame(width: 440)
}

#Preview("Open — critical, spawns blocked") {
    InterruptionsSection(store: .fixture(phase: .open([
        OperatorInterruption(
            id: "oi_2",
            title: "Sandbox missing and blockWithoutSandbox is set — provision one",
            urgency: .critical,
            sourceAgent: "purser",
            createdAt: Date().timeIntervalSince1970 - 90
        ),
        OperatorInterruption(
            id: "oi_3",
            title: "GitHub App lacks contents:write on the target repo",
            urgency: .high,
            sourceAgent: "shipwright",
            createdAt: Date().timeIntervalSince1970 - 1200
        ),
    ])))
    .frame(width: 440)
}

#Preview("Unknown (failed poll)") {
    InterruptionsSection(store: .fixture(phase: .unknown("Interruptions poll failed: timed out.")))
        .frame(width: 440)
}
