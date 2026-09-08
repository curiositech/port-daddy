import SwiftUI
import AppKit

// MARK: - Operator interruptions section (docs/hitl-interruptions.md §4)
//
// Always rendered — the contract forbids a hidden widget. Three honest looks:
//   - unknown / signed out: status is UNKNOWN (never "all clear"),
//   - zero open asks after a successful poll: a quiet honest empty state,
//   - open asks: decision, blocked reason, exact recipient, urgency, and age,
//     loud red for high/critical, and a note when spawns are blocked.
//
// Answer/ack deliberately deep-links to the session-gated web page. There is
// no in-app answer path: FleetBar's read capability must never be able to
// able to silence an escalation.

struct InterruptionsSection: View {
    @ObservedObject var store: InterruptionsStore

    /// Injectable for tests; production opens the default browser.
    var openAnswerPage: (URL) -> Void = { NSWorkspace.shared.open($0) }
    /// Opens the macOS notification settings pane after the system has denied
    /// permission. Permission itself is always requested by an explicit click.
    var openNotificationSettings: () -> Void = {
        guard let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") else { return }
        NSWorkspace.shared.open(url)
    }
    /// Injectable clock so ages are stable in tests and previews.
    var now: () -> Date = Date.init

    var body: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            header
            notificationControls
            content
        }
        .padding(.horizontal, Fleet.Space.m)
        .padding(.vertical, Fleet.Space.s)
        .background(store.hasLoudOpenAsk ? Fleet.Color.failure.opacity(0.10) : Color.clear)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var notificationControls: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.xs) {
            switch store.notificationAuthorization {
            case .notDetermined:
                HStack(spacing: Fleet.Space.s) {
                    Button {
                        Task { await store.requestNotificationPermission() }
                    } label: {
                        Label("Allow macOS alerts", systemImage: "bell.badge")
                    }
                    .buttonStyle(.borderedProminent)
                    Text("Get a sound for high or critical asks while FleetBar runs in the menu bar.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            case .denied:
                HStack(spacing: Fleet.Space.s) {
                    Text("macOS notifications are off for FleetBar.")
                        .font(.callout.weight(.medium))
                        .foregroundStyle(Fleet.Color.warning)
                    Spacer()
                    Button("Open Notification Settings", action: openNotificationSettings)
                        .buttonStyle(.bordered)
                }
            case .authorized, .provisional:
                HStack(spacing: Fleet.Space.m) {
                    Toggle(
                        "System alerts",
                        isOn: Binding(
                            get: { store.systemAlertsEnabled },
                            set: { store.setSystemAlertsEnabled($0) }
                        )
                    )
                    .toggleStyle(.switch)
                    Toggle(
                        "Sound for high + critical",
                        isOn: Binding(
                            get: { store.soundsForLoudAsks },
                            set: { store.setSoundsForLoudAsks($0) }
                        )
                    )
                    .toggleStyle(.switch)
                    .disabled(!store.systemAlertsEnabled)
                }
            }

            Text("These controls get your attention only. They never answer an agent or authorize work.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if let error = store.notificationError {
                Text(error)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(Fleet.Color.failure)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(Fleet.Space.s)
        .background(Fleet.Color.active.opacity(0.07), in: RoundedRectangle(cornerRadius: Fleet.Radius.small))
    }

    // MARK: Header

    @ViewBuilder
    private var header: some View {
        HStack(spacing: Fleet.Space.xs) {
            Image(systemName: headerIcon)
                .foregroundStyle(headerTint)
            Text("Agents waiting for your decision")
                .font(.callout.weight(.semibold))
            countBadge
            Spacer()
            if let url = store.answerPageURL, !store.openItems.isEmpty {
                Button {
                    openAnswerPage(url)
                } label: {
                    Label("Respond securely", systemImage: "arrow.up.right.square")
                        .font(.callout.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .tint(store.hasLoudOpenAsk ? Fleet.Color.failure : Fleet.Color.active)
                .help("Open the authenticated form. Send an answer to the waiting agent or say you handled it elsewhere.")
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
                Text("Sign in to Port Daddy so operator asks can surface here.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        case .open(let items):
            if items.isEmpty {
                // The honest empty state: backed by a successful poll.
                Text("No agent is waiting for a decision.")
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

            VStack(alignment: .leading, spacing: 3) {
                Text("DECISION NEEDED")
                    .font(.system(size: 11, weight: .bold))
                    .tracking(1.0)
                    .foregroundStyle(.secondary)
                Text(item.title)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(item.urgency.isLoud ? Fleet.Color.failure : Color.primary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                if !item.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text("Why blocked: \(item.body)")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(4)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text("Reply goes to \(item.sourceAgent) · filed \(item.age(now: now())) ago")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
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
