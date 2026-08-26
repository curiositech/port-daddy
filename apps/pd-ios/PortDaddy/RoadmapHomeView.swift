import SwiftUI

// MARK: - Roadmap home — the landing surface
//
// Renders lib/roadmap-projection.ts's read model and nothing else. It does not
// re-derive roadmap state; the parsimony law is that one derivation feeds three
// renderers (web account home, pd-console, this), and a phone that recomputed
// "what is now" would be the fourth answer nobody asked for.
//
// The do-this-next rail sits at the top because the binder puts it "at the
// entry of every sanctioned surface". Same rail, same reasons, small screen.
//
// LAW 13, honestly: an item's LIVE chip requires a dispatch, a timestamp, and
// a timestamp inside the projection's own freshness window. Anything else
// renders STALE or NO EVIDENCE, with the projection's own sentence next to it.

public struct RoadmapHomeView: View {
    @State private var projection: Loadable<RoadmapProjection>

    public init(projection: Loadable<RoadmapProjection>? = nil) {
        if let projection {
            _projection = State(initialValue: projection)
        } else {
            _projection = State(initialValue: RoadmapHomeView.fixtureProjection())
        }
    }

    static func fixtureProjection() -> Loadable<RoadmapProjection> {
        do {
            return .loaded(try PortDaddyFixtures.roadmapProjection(), provenance: .fixture(name: "roadmap-projection.fixture.json"))
        } catch {
            return .unknown(reason: String(describing: error))
        }
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: PD.Space.l) {
                    // The relay's roadmap route is real (#9223); this build
                    // just doesn't call it yet — D1 ships with no live network
                    // wiring for any tab, see RelayClient.swift's header.
                    // Saying so on the screen is the whole point: a home
                    // screen full of convincing fixture rows with no such note
                    // is how a scaffold gets mistaken for a product.
                    ProvenanceBar(.unbuilt(what: "this build has no roadmap live-fetch wiring yet"))
                    if let provenance = projection.provenance {
                        ProvenanceBar(provenance)
                    }

                    switch projection {
                    case .unknown(let reason):
                        UnknownNotice(
                            title: "The roadmap could not be read",
                            reason: reason
                        )
                    case .loaded(let value, _):
                        content(for: value)
                    }
                }
                .padding(PD.Space.l)
            }
            .navigationTitle("Roadmap")
        }
    }

    @ViewBuilder
    private func content(for projection: RoadmapProjection) -> some View {
        if !projection.isKnownVersion {
            UnknownNotice(
                title: "Newer projection format",
                reason: "This projection announces v\(projection.v); this build understands v\(RoadmapProjection.knownVersion). Fields it does not recognise are not shown."
            )
        }

        doThisNextRail(projection.doThisNext)

        SectionCard(
            title: "Roadmap",
            subtitle: "\(projection.items.count) items in \(projection.harbor)"
        ) {
            VStack(spacing: PD.Space.m) {
                ForEach(RoadmapProjection.inProjectionOrder(projection.items)) { item in
                    NavigationLink(value: item) {
                        RoadmapItemRow(item: item)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .navigationDestination(for: RoadmapProjectionItem.self) { item in
            RoadmapItemDetailView(item: item)
        }
    }

    @ViewBuilder
    private func doThisNextRail(_ entries: [RoadmapDoThisNextEntry]) -> some View {
        SectionCard(
            title: "Do this next",
            subtitle: "The same rail every other Port Daddy surface opens with."
        ) {
            if entries.isEmpty {
                EmptyStateView(
                    systemImage: "checkmark.circle",
                    title: "Nothing queued",
                    message: "No item is marked now, and nothing in the backlog is ready to start."
                )
            } else {
                VStack(alignment: .leading, spacing: PD.Space.m) {
                    ForEach(entries) { entry in
                        VStack(alignment: .leading, spacing: PD.Space.xs) {
                            Text(entry.title)
                                .font(.body.weight(.semibold))
                                .fixedSize(horizontal: false, vertical: true)
                            Text(entry.reason.explanation)
                                .font(.subheadline)
                                .foregroundStyle(PD.Chrome.secondaryText)
                        }
                        .frame(maxWidth: .infinity, minHeight: PD.minimumTapTarget, alignment: .leading)
                    }
                }
            }
        }
    }
}

/// One roadmap row.
public struct RoadmapItemRow: View {
    let item: RoadmapProjectionItem

    public init(item: RoadmapProjectionItem) {
        self.item = item
    }

    private var liveState: RoadmapLiveEvidence.DisplayState { item.liveEvidence.displayState }

    public var body: some View {
        VStack(alignment: .leading, spacing: PD.Space.s) {
            HStack(alignment: .top, spacing: PD.Space.s) {
                Text(item.title)
                    .font(.body.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(PD.Chrome.tertiaryText)
            }

            HStack(spacing: PD.Space.s) {
                SignalChip(state: statusState, text: item.status.rawValue)
                SignalChip(state: liveState.coordinationState, text: liveState.label)
            }

            // The projection's own sentence, verbatim. The chip above says
            // whether to trust it; this says what the server actually knows.
            Text(item.liveEvidence.label)
                .font(.subheadline)
                .foregroundStyle(PD.Chrome.secondaryText)
                .fixedSize(horizontal: false, vertical: true)

            if let claim = item.claim {
                Text("Claimed by \(claim.claimedBy)")
                    .font(.subheadline)
                    .foregroundStyle(PD.Chrome.tertiaryText)
            }
        }
        .frame(maxWidth: .infinity, minHeight: PD.minimumTapTarget, alignment: .leading)
        .padding(PD.Space.m)
        .background(RoundedRectangle(cornerRadius: PD.Radius.standard).fill(PD.Chrome.cardRaised))
    }

    /// Status maps onto the shared coordination vocabulary rather than a
    /// private palette, so "now" is the same colour here as a claim is
    /// everywhere else.
    private var statusState: CoordinationState {
        if item.status == .now { return .claimActive }
        if item.status == .merge { return .request }
        if item.status == .backlog { return .idle }
        if item.status == .parked { return .claimStale }
        if item.status == .done { return .affirmative }
        return .inform
    }
}

public struct RoadmapItemDetailView: View {
    let item: RoadmapProjectionItem

    public init(item: RoadmapProjectionItem) {
        self.item = item
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PD.Space.l) {
                SectionCard(title: item.title, subtitle: item.slug) {
                    VStack(alignment: .leading, spacing: PD.Space.s) {
                        SignalChip(
                            state: item.liveEvidence.displayState.coordinationState,
                            text: item.liveEvidence.displayState.label
                        )
                        Text(item.liveEvidence.label)
                            .font(.subheadline)
                            .foregroundStyle(PD.Chrome.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                        if let age = item.liveEvidence.evidenceAge {
                            Text("Last evidence \(RelativeAge.short(age)) ago — the projection's freshness window is \(RelativeAge.short(item.liveEvidence.maxAgeMs / 1000)).")
                                .font(.subheadline)
                                .foregroundStyle(PD.Chrome.tertiaryText)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }

                if !item.dependencies.isEmpty {
                    SectionCard(title: "Depends on") {
                        VStack(alignment: .leading, spacing: PD.Space.xs) {
                            ForEach(item.dependencies, id: \.self) { dependency in
                                Text(dependency)
                                    .font(.body)
                            }
                        }
                    }
                }

                SectionCard(title: "Receipts", subtitle: "What actually happened, in order.") {
                    if item.receipts.isEmpty {
                        EmptyStateView(
                            systemImage: "tray",
                            title: "No receipts",
                            message: "Nothing has been recorded against this item yet."
                        )
                    } else {
                        VStack(alignment: .leading, spacing: PD.Space.m) {
                            ForEach(Array(item.receipts.enumerated()), id: \.offset) { pair in
                                HStack(alignment: .top, spacing: PD.Space.s) {
                                    Image(systemName: pair.element.kind.systemImage)
                                        .foregroundStyle(PD.Chrome.secondaryText)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(pair.element.detail)
                                            .font(.body)
                                            .fixedSize(horizontal: false, vertical: true)
                                        Text(pair.element.by ?? "unattributed")
                                            .font(.subheadline)
                                            .foregroundStyle(PD.Chrome.tertiaryText)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .padding(PD.Space.l)
        }
        .navigationTitle(item.slug)
        .navigationBarTitleDisplayMode(.inline)
    }
}

#if DEBUG
#Preview("Roadmap home — fixture") {
    RoadmapHomeView()
}

#Preview("Roadmap home — unreadable") {
    RoadmapHomeView(projection: .unknown(reason: "could not reach the relay: The Internet connection appears to be offline."))
}
#endif
