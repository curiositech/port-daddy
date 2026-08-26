import SwiftUI
import Foundation

// MARK: - Asks — the HITL inbox (ADR-0125 §2 item 1)
//
// What this screen is allowed to do: render open asks, rank them the way the
// relay ranks them, block dependent work while a critical ask is open, and
// hand the operator to the session-gated surface to answer.
//
// What it is not allowed to do:
//   - Say "all clear" when it does not know. An unread inbox renders unknown.
//   - Nag. The decay machine is the relay's; nagCount is rendered, never
//     recomputed.
//   - POST an answer. `closeInterruption` on the relay requires a signed-in
//     session and a same-origin check; a device bearer token cannot close an
//     ask, and should not be able to — a token must not be able to silence the
//     escalation it caused. The button opens the web surface. That is the
//     design, not a limitation being worked around.

public struct InterruptionsView: View {
    let inbox: Loadable<InterruptionListResponse>
    /// Where "Answer on the web" goes. The relay origin, not a guess.
    let relayBaseURL: URL

    public init(
        inbox: Loadable<InterruptionListResponse>,
        relayBaseURL: URL = InterruptionsView.defaultRelayBaseURL
    ) {
        self.inbox = inbox
        self.relayBaseURL = relayBaseURL
    }

    /// The production relay origin. Kept here as a constant rather than
    /// scattered through the file so a staging build overrides one value.
    public static let defaultRelayBaseURL = URL(string: "https://relay.portdaddy.dev")!

    private var items: [OperatorInterruption] {
        InterruptionInbox.inContractOrder(inbox.value?.interruptions ?? [])
    }

    private var openItems: [OperatorInterruption] {
        items.filter { $0.state == .open }
    }

    private var closedItems: [OperatorInterruption] {
        items.filter { $0.state.isClosed }
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: PD.Space.l) {
                    if let provenance = inbox.provenance {
                        ProvenanceBar(provenance)
                    }

                    switch inbox {
                    case .unknown(let reason):
                        UnknownNotice(
                            title: "Open asks are unknown",
                            reason: "\(reason)\n\nThis is not 'no asks'. Until a poll succeeds this surface does not know whether anything is waiting on you."
                        )
                    case .loaded:
                        loadedContent
                    }
                }
                .padding(PD.Space.l)
            }
            .navigationTitle("Asks")
        }
    }

    @ViewBuilder
    private var loadedContent: some View {
        if let critical = InterruptionInbox.blockingCritical(openItems) {
            criticalBlockBanner(critical)
        }

        SectionCard(
            title: "Open",
            subtitle: openItems.isEmpty ? nil : "\(openItems.count) waiting on you"
        ) {
            if openItems.isEmpty {
                // Earned: a successful read that returned nothing open.
                EmptyStateView(
                    systemImage: "checkmark.circle",
                    title: "Nothing waiting on you",
                    message: "The last poll succeeded and returned no open asks."
                )
            } else {
                VStack(spacing: PD.Space.m) {
                    ForEach(openItems) { item in
                        InterruptionRow(item: item, relayBaseURL: relayBaseURL)
                    }
                }
            }
        }

        if !closedItems.isEmpty {
            SectionCard(title: "Closed", subtitle: "Answered, acked or expired.") {
                VStack(spacing: PD.Space.m) {
                    ForEach(closedItems) { item in
                        InterruptionRow(item: item, relayBaseURL: relayBaseURL)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func criticalBlockBanner(_ ask: OperatorInterruption) -> some View {
        VStack(alignment: .leading, spacing: PD.Space.s) {
            SignalChip(state: .mayday, text: "dependent work blocked")
            Text(ask.title)
                .font(.body.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
            // Contract point 3: the ask's title IS the stated reason. A
            // control disabled without naming the ask that disabled it is a
            // dead end for the operator.
            Text("While this critical ask is open, dependent work stays blocked.")
                .font(.subheadline)
                .foregroundStyle(PD.Chrome.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PD.Space.l)
        .background(RoundedRectangle(cornerRadius: PD.Radius.medium).fill(PD.color(for: .mayday).opacity(0.12)))
        .overlay(RoundedRectangle(cornerRadius: PD.Radius.medium).stroke(PD.color(for: .mayday), lineWidth: 1))
    }
}

public struct InterruptionRow: View {
    let item: OperatorInterruption
    let relayBaseURL: URL

    public init(item: OperatorInterruption, relayBaseURL: URL) {
        self.item = item
        self.relayBaseURL = relayBaseURL
    }

    private var handoff: InterruptionHandoff {
        InterruptionHandoff.webAnswerSurface(relayBaseURL: relayBaseURL, interruptionID: item.id)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: PD.Space.s) {
            HStack(spacing: PD.Space.s) {
                SignalChip(state: item.urgency.coordinationState, text: item.urgency.rawValue)
                if item.state.isClosed {
                    Text(item.state.label)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(PD.Chrome.tertiaryText)
                }
                Spacer(minLength: 0)
                Text(RelativeAge.short(item.age()))
                    .font(.subheadline)
                    .foregroundStyle(PD.Chrome.tertiaryText)
            }

            Text(item.title)
                .font(.body.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)

            if !item.body.isEmpty {
                Text(item.body)
                    .font(.subheadline)
                    .foregroundStyle(PD.Chrome.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Text("from \(item.sourceAgent)")
                .font(.subheadline)
                .foregroundStyle(PD.Chrome.tertiaryText)

            if let answer = item.answer, !answer.isEmpty {
                Text("Answered: \(answer)")
                    .font(.subheadline)
                    .foregroundStyle(PD.color(for: .affirmative))
                    .fixedSize(horizontal: false, vertical: true)
            }

            if item.nagCount > 0 {
                // Rendered, never recomputed. The relay owns the decay.
                Text("Paged \(item.nagCount) \(item.nagCount == 1 ? "time" : "times")")
                    .font(.subheadline)
                    .foregroundStyle(PD.Chrome.tertiaryText)
            }

            if item.state == .open {
                answerAction
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PD.Space.m)
        .background(RoundedRectangle(cornerRadius: PD.Radius.standard).fill(PD.Chrome.cardRaised))
    }

    @ViewBuilder
    private var answerAction: some View {
        VStack(alignment: .leading, spacing: PD.Space.xs) {
            Link(destination: handoff.url) {
                Label("Answer on the web", systemImage: "safari")
                    .font(.body)
                    .frame(minHeight: PD.minimumTapTarget)
            }
            Text(handoff.explanation)
                .font(.subheadline)
                .foregroundStyle(PD.Chrome.tertiaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

#if DEBUG
#Preview("Asks — fixture inbox") {
    InterruptionsView(inbox: RootView.fixtureInbox())
}

#Preview("Asks — unknown, not all clear") {
    InterruptionsView(inbox: .unknown(reason: "could not reach the relay: The Internet connection appears to be offline."))
}
#endif
