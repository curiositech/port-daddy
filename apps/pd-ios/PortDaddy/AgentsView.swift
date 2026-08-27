import SwiftUI

// MARK: - Agents — the durable cast (design pass: mobile-intent-first)
//
// The roster. Named identities that survive restarts, each followable, each a
// tap away from its transcript. This is where the fleet goes once it stops
// being the front door: not a tab of running processes, but a cast.
//
// Honesty rules this screen keeps, same as its siblings:
//   - Fixture data wears a ProvenanceBar. There is no unlabelled path.
//   - "Follow" reflects the fixture's subscription intent but does not claim to
//     be live — the actor-subscription streams are not built. It is rendered as
//     state, not offered as a working control.
//   - State is a maritime chip, never colour alone.

public struct AgentsView: View {
    let roster: Loadable<AgentRoster>

    public init(roster: Loadable<AgentRoster>? = nil) {
        self.roster = roster ?? AgentsView.fixtureRoster()
    }

    static func fixtureRoster() -> Loadable<AgentRoster> {
        do {
            return .loaded(try PortDaddyFixtures.agents(), provenance: .fixture(name: "agents.fixture.json"))
        } catch {
            return .unknown(reason: String(describing: error))
        }
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: PD.Space.l) {
                    if let provenance = roster.provenance {
                        ProvenanceBar(provenance)
                    }

                    switch roster {
                    case .unknown(let reason):
                        UnknownNotice(
                            title: "The cast is unknown",
                            reason: "\(reason)\n\nThis is not 'no agents'. Until a roster read succeeds this surface does not know who is running."
                        )
                    case .loaded(let roster, _):
                        castHeader(roster)
                        VStack(spacing: PD.Space.s) {
                            ForEach(Array(roster.agents.enumerated()), id: \.element.id) { index, agent in
                                NavigationLink(value: agent.id) {
                                    AgentRow(agent: agent)
                                }
                                .buttonStyle(PressableCardStyle())
                                .accessibilityIdentifier("agent-row-\(index)")
                            }
                        }
                        .navigationDestination(for: String.self) { agentID in
                            if let agent = roster.agents.first(where: { $0.id == agentID }) {
                                AgentDetailView(agent: agent)
                            }
                        }
                    }
                }
                .padding(PD.Space.l)
            }
            .navigationTitle("Agents")
        }
    }

    @ViewBuilder
    private func castHeader(_ roster: AgentRoster) -> some View {
        HStack(spacing: PD.Space.s) {
            Text("Durable cast")
                .font(.subheadline.weight(.semibold))
            Spacer(minLength: 0)
            Text("\(roster.durableCount) survive restarts · \(roster.agents.count) total")
                .font(.subheadline)
                .foregroundStyle(PD.Chrome.secondaryText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One agent in the roster. Accent stripe → monogram → name + status → follow +
/// age. The name truncates before it collides with the follow control; the
/// follow control has a fixed intrinsic size so it never gets squeezed to
/// nothing.
public struct AgentRow: View {
    let agent: DurableAgent

    public init(agent: DurableAgent) {
        self.agent = agent
    }

    public var body: some View {
        HStack(spacing: PD.Space.m) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(PD.color(for: agent.state))
                .frame(width: 3)

            Text(agent.initials)
                .font(.subheadline.weight(.bold))
                .frame(width: 34, height: 34)
                .background(RoundedRectangle(cornerRadius: PD.Radius.small, style: .continuous).fill(PD.Chrome.card))
                .overlay(RoundedRectangle(cornerRadius: PD.Radius.small, style: .continuous).stroke(PD.Chrome.border, lineWidth: 1))

            VStack(alignment: .leading, spacing: 2) {
                Text(agent.name)
                    .font(.body.weight(.semibold))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: PD.Space.xs) {
                    SignalFlag(state: agent.state)
                    Text(agent.statusLine)
                        .font(.subheadline)
                        .foregroundStyle(PD.Chrome.secondaryText)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .trailing, spacing: PD.Space.xs) {
                FollowMarker(following: agent.following)
                Text(agent.ageLabel)
                    .font(.subheadline)
                    .foregroundStyle(PD.Chrome.tertiaryText)
                    .monospacedDigit()
            }
            .fixedSize()

            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(PD.Chrome.tertiaryText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: PD.minimumTapTarget)
        .padding(.vertical, PD.Space.s)
        .padding(.horizontal, PD.Space.m)
        .background(RoundedRectangle(cornerRadius: PD.Radius.standard, style: .continuous).fill(PD.Chrome.card))
        .overlay(RoundedRectangle(cornerRadius: PD.Radius.standard, style: .continuous).stroke(PD.Chrome.border, lineWidth: 1))
    }
}

/// A compact maritime flag: the ICS letter in its state colour. The full
/// `SignalChip` (letter + word + colour) is too heavy for a dense roster row,
/// but "state is never colour alone" still holds — the letter is a glyph, and
/// the status line beside it carries the word.
public struct SignalFlag: View {
    let state: CoordinationState

    public init(state: CoordinationState) {
        self.state = state
    }

    public var body: some View {
        Text(MaritimeSignals.signal(for: state).rawValue)
            .font(.caption2.weight(.bold))
            .foregroundStyle(PD.color(for: state))
            .frame(width: 17, height: 15)
            .background(RoundedRectangle(cornerRadius: 3, style: .continuous).fill(PD.color(for: state).opacity(0.18)))
            .overlay(RoundedRectangle(cornerRadius: 3, style: .continuous).stroke(PD.color(for: state), lineWidth: 1))
            .fixedSize()
            .accessibilityLabel("Signal \(MaritimeSignals.phonetic(for: state))")
    }
}

/// The follow state. A marker, not a live toggle — following requires the
/// actor-subscription streams, which are not built. It reflects the fixture and
/// says so by being a static chip rather than a button that pretends to work.
public struct FollowMarker: View {
    let following: Bool

    public init(following: Bool) {
        self.following = following
    }

    public var body: some View {
        HStack(spacing: 3) {
            Image(systemName: following ? "checkmark" : "plus")
                .font(.caption2.weight(.bold))
            Text(following ? "Following" : "Follow")
                .font(.caption.weight(.semibold))
        }
        .foregroundStyle(following ? Color.white : PD.Chrome.secondaryText)
        .padding(.horizontal, PD.Space.s)
        .padding(.vertical, 3)
        .background(
            RoundedRectangle(cornerRadius: PD.Radius.small, style: .continuous)
                .fill(following ? PD.Palette.active : Color.clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: PD.Radius.small, style: .continuous)
                .stroke(following ? PD.Palette.active : PD.Chrome.border, lineWidth: 1)
        )
        .accessibilityLabel(following ? "Following" : "Not following")
    }
}

#if DEBUG
#Preview("Agents — fixture cast") {
    AgentsView()
}

#Preview("Agents — unknown, not empty") {
    AgentsView(roster: .unknown(reason: "could not reach the relay: The Internet connection appears to be offline."))
}
#endif
