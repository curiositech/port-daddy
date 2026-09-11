import SwiftUI
import Foundation

// MARK: - Harbors — list plus reachability (ADR-0125 §6)
//
// The split-plane law, implemented rather than quoted:
//
//   - The LIST renders first and always. No splash, no spinner gate, no
//     "checking reachability…" screen in front of it. Verdicts inform
//     degradation; they never gate existence.
//   - `unknown` shows the last known verdict WITH ITS AGE, marked cached. It
//     is never rendered as `impossible`. A harbor whose presence read failed
//     looks different from a harbor whose daemons are all down, because those
//     are different facts.
//   - Only `impossible` gates anything, and only the control that needs a live
//     body. The row stays tappable, the detail stays readable, the harbor
//     stays visible.

public struct HarborsView: View {
    @State private var harbors: Loadable<HarborFixture>

    public init(harbors: Loadable<HarborFixture>? = nil) {
        if let harbors {
            _harbors = State(initialValue: harbors)
        } else {
            _harbors = State(initialValue: HarborsView.fixtureHarbors())
        }
    }

    static func fixtureHarbors() -> Loadable<HarborFixture> {
        do {
            return .loaded(try PortDaddyFixtures.harbors(), provenance: .fixture(name: "harbors.fixture.json"))
        } catch {
            return .unknown(reason: String(describing: error))
        }
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: PD.Space.l) {
                    if let provenance = harbors.provenance {
                        ProvenanceBar(provenance)
                    }
                    ProvenanceBar(.unbuilt(what: "the relay serves no reachability verdict; these are derived on-device from presence"))

                    switch harbors {
                    case .unknown(let reason):
                        // Even here the law holds: this is "we could not read
                        // your harbors", not "you have none".
                        UnknownNotice(title: "Harbors could not be read", reason: reason)
                    case .loaded(let fixture, _):
                        if fixture.entries.isEmpty {
                            EmptyStateView(
                                systemImage: "sailboat",
                                title: "No harbors",
                                message: "This account belongs to no harbors yet."
                            )
                        } else {
                            VStack(spacing: PD.Space.m) {
                                ForEach(fixture.entries, id: \.harbor.id) { entry in
                                    NavigationLink(value: entry.harbor) {
                                        HarborRow(entry: entry)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .navigationDestination(for: Harbor.self) { harbor in
                                if let entry = fixture.entries.first(where: { $0.harbor.id == harbor.id }) {
                                    HarborDetailView(entry: entry)
                                } else {
                                    UnknownNotice(
                                        title: "No such harbor",
                                        reason: "The relay answers the same 404 for a harbor that does not exist and one you are not a member of. This surface does not guess which."
                                    )
                                    .padding(PD.Space.l)
                                }
                            }
                        }
                    }
                }
                .padding(PD.Space.l)
            }
            .scrollContentBackground(.hidden)
            .background(PD.Chrome.base)
            .navigationTitle("Harbors")
        }
    }
}

public struct ReachabilityChip: View {
    let reading: ReachabilityReading
    let now: Date

    public init(reading: ReachabilityReading, now: Date = Date()) {
        self.reading = reading
        self.now = now
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: PD.Space.xs) {
            SignalChip(state: reading.verdict.coordinationState, text: reading.verdict.rawValue)
            Text(reading.caption(now: now))
                .font(PDFont.subheadline)
                .foregroundStyle(PD.Chrome.tertiaryText)
        }
        .accessibilityElement(children: .combine)
    }
}

public struct HarborRow: View {
    let entry: HarborFixtureEntry

    public init(entry: HarborFixtureEntry) {
        self.entry = entry
    }

    public var body: some View {
        HStack(alignment: .top, spacing: PD.Space.m) {
            VStack(alignment: .leading, spacing: PD.Space.xs) {
                Text(entry.harbor.slug)
                    .font(PDFont.body.weight(.semibold))
                Text(entry.harbor.role)
                    .font(PDFont.subheadline)
                    .foregroundStyle(PD.Chrome.secondaryText)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            ReachabilityChip(reading: entry.reachability)
        }
        .frame(minHeight: PD.minimumTapTarget)
        .padding(PD.Space.m)
        .background(RoundedRectangle(cornerRadius: PD.Radius.standard, style: .continuous).fill(PD.Chrome.cardRaised))
    }
}

public struct HarborDetailView: View {
    let entry: HarborFixtureEntry

    public init(entry: HarborFixtureEntry) {
        self.entry = entry
    }

    private var reading: ReachabilityReading { entry.reachability }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PD.Space.l) {
                SectionCard(title: "Reachability", subtitle: reading.verdict.explanation) {
                    VStack(alignment: .leading, spacing: PD.Space.m) {
                        ReachabilityChip(reading: reading)

                        // The per-capability gate. Note what is NOT here: the
                        // page is not blocked, the member list is not hidden,
                        // and nothing about `unknown` disables anything.
                        remoteControlAvailability
                    }
                }

                SectionCard(title: "Members", subtitle: "\(entry.daemonMemberCount) daemon members") {
                    VStack(alignment: .leading, spacing: PD.Space.s) {
                        ForEach(entry.members, id: \.member) { member in
                            HStack(spacing: PD.Space.s) {
                                Image(systemName: member.isDaemon ? "desktopcomputer" : "person")
                                    .foregroundStyle(PD.Chrome.secondaryText)
                                Text(member.member)
                                    .font(PDFont.body)
                                Spacer(minLength: 0)
                                Text(member.role)
                                    .font(PDFont.subheadline)
                                    .foregroundStyle(PD.Chrome.tertiaryText)
                            }
                            .frame(minHeight: PD.minimumTapTarget)
                        }
                    }
                }
            }
            .padding(PD.Space.l)
        }
        .navigationTitle(entry.harbor.name)
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private var remoteControlAvailability: some View {
        if reading.verdict.gatesRemoteCapability {
            VStack(alignment: .leading, spacing: PD.Space.xs) {
                SignalChip(state: .blocked, text: "remote control unavailable")
                Text("No daemon in this harbor is heartbeating, so a control command has nowhere to be delivered. Everything else on this screen still works.")
                    .font(PDFont.subheadline)
                    .foregroundStyle(PD.Chrome.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } else if reading.verdict == .unknown {
            Text("Reachability is unknown, which is not the same as unreachable. Controls stay available; a command issued now may still be queued and acknowledged.")
                .font(PDFont.subheadline)
                .foregroundStyle(PD.Chrome.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        } else if reading.verdict == .degraded {
            Text("Some daemons are down. Commands aimed at a body on a live daemon still work; the rest will fail with a recorded reason rather than silently.")
                .font(PDFont.subheadline)
                .foregroundStyle(PD.Chrome.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

#if DEBUG
#Preview("Harbors — four verdicts") {
    HarborsView()
}

#Preview("Harbors — unreadable") {
    HarborsView(harbors: .unknown(reason: "could not reach the relay: request timed out"))
}
#endif
