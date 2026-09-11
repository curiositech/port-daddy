import SwiftUI

// MARK: - Agent detail — live tail + per-agent controls (design pass: mobile-intent-first)
//
// The thing the operator asked to be able to do: follow a durable agent and
// read its transcript. This screen is the tail, plus the controls scoped to
// this one agent — which is why there is no global Controls tab in this IA.
//
// The controls are DISABLED WITH THEIR REASON, exactly like ControlVerbsView:
// issuing steer/interrupt/kill requires the pairing ritual (a device membership
// record, a per-command jti, the harbor authority epoch), and none of that is
// built. A Steer button that looked live and did nothing is the dishonesty this
// surface refuses. The transcript is fixture data and says so.

public struct AgentDetailView: View {
    let agent: DurableAgent
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(agent: DurableAgent) {
        self.agent = agent
    }

    private var isLive: Bool {
        // A live tail is one whose most recent event is the agent still working.
        agent.state == .claimActive
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PD.Space.l) {
                ProvenanceBar(.fixture(name: "agents.fixture.json"))

                header
                transcriptCard
                controlsSection
            }
            .padding(PD.Space.l)
        }
        .scrollContentBackground(.hidden)
        .background(PD.Chrome.base)
        .navigationTitle(agent.name)
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private var header: some View {
        VStack(alignment: .leading, spacing: PD.Space.s) {
            HStack(spacing: PD.Space.s) {
                SignalChip(state: agent.state)
                Spacer(minLength: 0)
                FollowMarker(following: agent.following)
            }

            if isLive {
                LiveTailBadge(reduceMotion: reduceMotion)
            }

            if let lineage = agent.lineage {
                Label("durable · \(lineage)", systemImage: "shield.lefthalf.filled")
                    .font(PDFont.subheadline)
                    .foregroundStyle(PD.Chrome.secondaryText)
            } else {
                Label("ephemeral · not resumed", systemImage: "hare")
                    .font(PDFont.subheadline)
                    .foregroundStyle(PD.Chrome.tertiaryText)
            }

            factsRow
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var factsRow: some View {
        HStack(spacing: PD.Space.l) {
            if let body = agent.body {
                fact("body", body)
            }
            if let ctx = agent.contextPercent {
                fact("ctx", "\(ctx)%")
            }
            if let cost = agent.costLabel {
                fact("cost", cost, tint: PD.Palette.gold)
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private func fact(_ key: String, _ value: String, tint: Color? = nil) -> some View {
        HStack(spacing: PD.Space.xs) {
            Text(key)
                .font(PDFont.subheadline)
                .foregroundStyle(PD.Chrome.tertiaryText)
            Text(value)
                .font(PDFont.subheadline.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(tint ?? PD.Chrome.secondaryText)
        }
    }

    @ViewBuilder
    private var transcriptCard: some View {
        VStack(alignment: .leading, spacing: PD.Space.s) {
            HStack(spacing: PD.Space.xs) {
                Text("Transcript")
                    .font(PDFont.headline)
                Spacer(minLength: 0)
                Text("\(agent.transcript.count) events")
                    .font(PDFont.subheadline)
                    .foregroundStyle(PD.Chrome.tertiaryText)
            }

            if agent.transcript.isEmpty {
                Text("No events yet.")
                    .font(PDFont.subheadline)
                    .foregroundStyle(PD.Chrome.tertiaryText)
            } else {
                VStack(alignment: .leading, spacing: PD.Space.s) {
                    ForEach(agent.transcript) { event in
                        TranscriptRow(event: event)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PD.Space.l)
        .background(RoundedRectangle(cornerRadius: PD.Radius.medium, style: .continuous).fill(PD.Chrome.card))
        // The transcript is "the one live panel" — instrument brackets, not a
        // card border, mark it as the thing that is actually streaming.
        .overlay(BracketCorners().padding(5))
    }

    @ViewBuilder
    private var controlsSection: some View {
        SectionCard(
            title: "Controls",
            subtitle: "Scoped to this agent — there is no global Controls tab in this layout."
        ) {
            VStack(spacing: PD.Space.s) {
                AgentControlRow(title: "Steer — send guidance", systemImage: "location.north.line", prominent: true)
                AgentControlRow(title: "Interrupt", systemImage: "hand.raised")
                AgentControlRow(title: "Kill", systemImage: "xmark.octagon")

                HStack(spacing: PD.Space.s) {
                    Image(systemName: "hammer")
                        .imageScale(.small)
                    Text("Issuing controls needs device pairing, which is not built yet.")
                        .font(PDFont.subheadline)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .foregroundStyle(PD.color(for: .blocked))
                .padding(.top, PD.Space.xs)
            }
        }
    }
}

/// The "live" indicator on the tail. A gentle pulse when motion is allowed; a
/// steady dot when it is not — the state reads either way.
private struct LiveTailBadge: View {
    let reduceMotion: Bool

    var body: some View {
        HStack(spacing: PD.Space.s) {
            LiveDot(color: PD.color(for: .claimActive))
                .padding(.leading, 3)   // room for the ring's overshoot
            Text("LIVE — events arriving")
                .font(PDFont.caption.weight(.semibold))
                .tracking(1)
                .foregroundStyle(PD.color(for: .claimActive))
        }
        .accessibilityLabel("Live — events arriving")
    }
}

/// One transcript line: timestamp, an uppercase KIND label coloured by the kind,
/// then the text. A denied line carries a left rule so it reads as a refusal
/// even in greyscale.
public struct TranscriptRow: View {
    let event: TranscriptEvent

    public init(event: TranscriptEvent) {
        self.event = event
    }

    private var kindColor: Color { PD.color(for: event.kind.state) }

    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: PD.Space.s) {
                Text(event.timestamp)
                    .font(PDFont.monoCaption)
                    .foregroundStyle(PD.Chrome.tertiaryText)
                Text(event.kind.label)
                    .font(PDFont.caption.weight(.bold))
                    .tracking(0.6)
                    .foregroundStyle(kindColor)
            }
            Text(event.text)
                .font(PDFont.monoSubheadline)
                .foregroundStyle(PD.Chrome.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, event.kind == .denied ? PD.Space.s : 0)
        .overlay(alignment: .leading) {
            if event.kind == .denied {
                Rectangle()
                    .fill(kindColor)
                    .frame(width: 3)
            }
        }
    }
}

/// A control row that is deliberately non-functional: it renders the verb and
/// stays disabled. Mirrors ControlVerbsView — a visible, disabled, reasoned
/// control beats a hidden one.
public struct AgentControlRow: View {
    let title: String
    let systemImage: String
    let prominent: Bool

    public init(title: String, systemImage: String, prominent: Bool = false) {
        self.title = title
        self.systemImage = systemImage
        self.prominent = prominent
    }

    public var body: some View {
        HStack(spacing: PD.Space.s) {
            Image(systemName: systemImage)
                .imageScale(.medium)
            Text(title)
                .font(PDFont.body.weight(.semibold))
            Spacer(minLength: 0)
        }
        .foregroundStyle(prominent ? PD.Chrome.secondaryText : PD.Chrome.tertiaryText)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: PD.minimumTapTarget)
        .padding(.horizontal, PD.Space.m)
        .background(
            RoundedRectangle(cornerRadius: PD.Radius.standard, style: .continuous)
                .fill(prominent ? PD.Chrome.cardRaised : Color.clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: PD.Radius.standard, style: .continuous)
                .stroke(PD.Chrome.border, lineWidth: 1)
        )
        .opacity(0.6)
        .accessibilityLabel("\(title). Disabled — pairing not built.")
    }
}

#if DEBUG
#Preview("Agent detail — live tail") {
    NavigationStack {
        AgentDetailView(agent: (try? PortDaddyFixtures.agents())!.agents[0])
    }
}
#endif
