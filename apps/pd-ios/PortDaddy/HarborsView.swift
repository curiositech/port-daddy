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

    private var isSample: Bool {
        if case .fixture = harbors.provenance { return true }
        return false
    }

    public var body: some View {
        NavigationStack {
            content.navigationTitle("Harbors")
        }
    }

    var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PD.Space.l) {
                switch harbors {
                case .unknown(let reason):
                    UnknownNotice(title: "Harbors unavailable", reason: reason)
                case .loaded(let fixture, let provenance):
                    if !isSample {
                        ProvenanceBar(provenance)
                    }

                    if fixture.entries.isEmpty {
                        Text("No harbors in this view.")
                            .font(PDFont.body)
                    } else {
                        VStack(spacing: PD.Space.m) {
                            ForEach(fixture.entries, id: \.harbor.id) { entry in
                                NavigationLink {
                                    HarborDetailView(entry: entry, provenance: provenance)
                                } label: {
                                    HarborRow(entry: entry)
                                }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier(entry.reachability.isCached ? "relay.harbor.stale" : "relay.harbor.\(entry.harbor.id)")
                            }
                        }
                    }
                }
            }
            .padding(PD.Space.l)
        }
        .relaySampleBanner(isSample)
        .background(PD.Chrome.base)
    }
}

public struct ReachabilityChip: View {
    let reading: ReachabilityReading
    let now: Date

    public init(reading: ReachabilityReading, now: Date = Date()) {
        self.reading = reading
        self.now = now
    }

    private var caption: String {
        let observation = reading.caption(now: now)
        return reading.isCached ? "Stale · \(observation)" : observation
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: PD.Space.xs) {
            SignalChip(state: reading.verdict.coordinationState, text: reading.verdict.rawValue)
            Text(caption)
                .font(PDFont.subheadline)
                .foregroundStyle(PD.Chrome.tertiaryText)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(reading.verdict.rawValue). \(caption). Signal flag \(MaritimeSignals.phonetic(for: reading.verdict.coordinationState)).")
    }
}

public struct HarborRow: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let entry: HarborFixtureEntry

    public init(entry: HarborFixtureEntry) {
        self.entry = entry
    }

    public var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: PD.Space.m))
            : AnyLayout(HStackLayout(alignment: .top, spacing: PD.Space.m))
        layout {
            VStack(alignment: .leading, spacing: PD.Space.xs) {
                Text(entry.harbor.slug)
                    .font(PDFont.body.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
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
        .accessibilityElement(children: .combine)
    }
}

public struct HarborDetailView: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let entry: HarborFixtureEntry
    let provenance: Provenance

    public init(entry: HarborFixtureEntry, provenance: Provenance = .fixture(name: "harbors.fixture.json")) {
        self.entry = entry
        self.provenance = provenance
    }

    private var reading: ReachabilityReading { entry.reachability }
    private var isSample: Bool {
        if case .fixture = provenance { return true }
        return false
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PD.Space.l) {
                if !isSample {
                    ProvenanceBar(provenance)
                }
                SectionCard(title: "Reachability", subtitle: reading.verdict.explanation) {
                    ReachabilityChip(reading: reading)
                        .accessibilityIdentifier("relay.reachability-reading")
                }

                SectionCard(title: "Members", subtitle: "\(entry.daemonMemberCount) daemon members") {
                    VStack(alignment: .leading, spacing: PD.Space.s) {
                        ForEach(entry.members, id: \.member) { member in
                            memberRow(member)
                        }
                    }
                }
            }
            .padding(PD.Space.l)
        }
        .relaySampleBanner(isSample)
        .background(PD.Chrome.base)
        .navigationTitle(entry.harbor.name)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func memberRow(_ member: HarborMember) -> some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: PD.Space.xs))
            : AnyLayout(HStackLayout(spacing: PD.Space.s))
        return layout {
            Label(member.member, systemImage: member.isDaemon ? "desktopcomputer" : "person")
                .font(PDFont.body)
            if !typeSize.isAccessibilitySize { Spacer(minLength: 0) }
            Text(member.role)
                .font(PDFont.subheadline)
                .foregroundStyle(PD.Chrome.secondaryText)
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
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
