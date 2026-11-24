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
    public static let defaultRelayBaseURL = RelayBrowserDestination.origin

    private var isSample: Bool {
        if case .fixture = inbox.provenance { return true }
        return false
    }

    private var isLive: Bool {
        if case .live = inbox.provenance { return true }
        return false
    }

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
            content.navigationTitle("Asks")
        }
    }

    var content: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: PD.Space.l) {
                if isSample {
                    RelaySampleNotice()
                } else if let provenance = inbox.provenance {
                    ProvenanceBar(provenance)
                }

                switch inbox {
                case .unknown(let reason):
                    UnknownNotice(title: "Inbox unavailable", reason: reason)
                case .loaded:
                    loadedContent
                }
            }
            .padding(PD.Space.l)
        }
        .background(PD.Chrome.base)
    }

    @ViewBuilder
    private var loadedContent: some View {
        if !isSample, let critical = InterruptionInbox.blockingCritical(openItems) {
            criticalBlockBanner(critical)
        }

        SectionCard(
            title: "Open",
            subtitle: openItems.isEmpty || !isLive ? nil : "\(openItems.count) waiting on you"
        ) {
            if openItems.isEmpty {
                if isLive {
                    EmptyStateView(
                        systemImage: "checkmark.circle",
                        title: "No open interruptions",
                        message: "Nothing was waiting at the last successful read."
                    )
                } else {
                    Text(isSample ? "No open interruptions in this sample." : "Current interruptions are unknown.")
                        .font(PDFont.body)
                }
            } else {
                VStack(spacing: PD.Space.m) {
                    ForEach(openItems) { item in
                        InterruptionRow(item: item, relayBaseURL: relayBaseURL, allowsHandoff: isLive)
                            .accessibilityIdentifier("relay.sample-ask.\(item.urgency.rawValue)")
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
            SignalChip(state: .mayday, text: isLive ? "Dependent work blocked" : "Last known critical ask")
            Text(ask.title)
                .font(PDFont.body.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
            if isLive {
                Text("While this critical ask is open, dependent work stays blocked.")
                    .font(PDFont.subheadline)
                    .foregroundStyle(PD.Chrome.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PD.Space.l)
        .background(RoundedRectangle(cornerRadius: PD.Radius.medium, style: .continuous).fill(PD.color(for: .mayday).opacity(0.12)))
        .overlay(RoundedRectangle(cornerRadius: PD.Radius.medium, style: .continuous).stroke(PD.color(for: .mayday), lineWidth: 1))
    }
}

public struct InterruptionRow: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let item: OperatorInterruption
    let relayBaseURL: URL
    let allowsHandoff: Bool

    public init(item: OperatorInterruption, relayBaseURL: URL, allowsHandoff: Bool = false) {
        self.item = item
        self.relayBaseURL = relayBaseURL
        self.allowsHandoff = allowsHandoff
    }

    private var handoff: InterruptionHandoff {
        InterruptionHandoff.webAnswerSurface(relayBaseURL: relayBaseURL, interruptionID: item.id)
    }

    public var body: some View {
        let metadata = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: PD.Space.s))
            : AnyLayout(HStackLayout(spacing: PD.Space.s))

        VStack(alignment: .leading, spacing: PD.Space.s) {
            metadata {
                SignalChip(state: item.urgency.coordinationState, text: item.urgency.rawValue)
                if item.state.isClosed {
                    Text(item.state.label)
                        .font(PDFont.subheadline.weight(.semibold))
                        .foregroundStyle(PD.Chrome.tertiaryText)
                }
                if !typeSize.isAccessibilitySize { Spacer(minLength: 0) }
                Text(RelativeAge.short(item.age()))
                    .font(PDFont.subheadline)
                    .foregroundStyle(PD.Chrome.tertiaryText)
            }

            Text(item.title)
                .font(PDFont.body.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)

            if !item.body.isEmpty {
                Text(item.body)
                    .font(PDFont.subheadline)
                    .foregroundStyle(PD.Chrome.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Text("from \(item.sourceAgent)")
                .font(PDFont.subheadline)
                .foregroundStyle(PD.Chrome.tertiaryText)

            if let answer = item.answer, !answer.isEmpty {
                Text("Answered: \(answer)")
                    .font(PDFont.subheadline)
                    .foregroundStyle(PD.color(for: .affirmative))
                    .fixedSize(horizontal: false, vertical: true)
            }

            if item.nagCount > 0 {
                // Rendered, never recomputed. The relay owns the decay.
                Text("Paged \(item.nagCount) \(item.nagCount == 1 ? "time" : "times")")
                    .font(PDFont.subheadline)
                    .foregroundStyle(PD.Chrome.tertiaryText)
            }

            if item.state == .open && allowsHandoff {
                answerAction
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PD.Space.m)
        .background(RoundedRectangle(cornerRadius: PD.Radius.standard, style: .continuous).fill(PD.Chrome.cardRaised))
    }

    @ViewBuilder
    private var answerAction: some View {
        VStack(alignment: .leading, spacing: PD.Space.xs) {
            Link(destination: handoff.url) {
                Label("Answer on the web", systemImage: "safari")
                    .font(PDFont.body)
                    .frame(minHeight: PD.minimumTapTarget)
            }
            Text(handoff.explanation)
                .font(PDFont.subheadline)
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
