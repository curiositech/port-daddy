import SwiftUI

// MARK: - Artifacts — browse outputs + receipts (design pass: mobile-intent-first)
//
// Beauty pass applied: weight-matched SF Symbols (hierarchical for depth), a
// segmented filter with selection haptics, continuous corners, and an empty
// state that is one icon, one line, one absence — never a wall of explanation.

public struct ArtifactsView: View {
    let feed: Loadable<ArtifactFeed>
    @State private var filter: ArtifactFilter = .all

    public init(feed: Loadable<ArtifactFeed>? = nil) {
        self.feed = feed ?? ArtifactsView.fixtureFeed()
    }

    enum ArtifactFilter: String, CaseIterable, Hashable {
        case all
        case pr
        case doc
        case render
        case receipt

        var label: String {
            switch self {
            case .all:     return "All"
            case .pr:      return "PRs"
            case .doc:     return "Docs"
            case .render:  return "Renders"
            case .receipt: return "Receipts"
            }
        }

        func matches(_ artifact: Artifact) -> Bool {
            switch self {
            case .all:     return true
            case .pr:      return artifact.kind == .pr
            case .doc:     return artifact.kind == .doc
            case .render:  return artifact.kind == .render
            case .receipt: return artifact.kind == .receipt
            }
        }
    }

    static func fixtureFeed() -> Loadable<ArtifactFeed> {
        do {
            return .loaded(try PortDaddyFixtures.artifacts(), provenance: .fixture(name: "artifacts.fixture.json"))
        } catch {
            return .unknown(reason: String(describing: error))
        }
    }

    private func shown(_ feed: ArtifactFeed) -> [Artifact] {
        feed.artifacts.filter { filter.matches($0) }
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: PD.Space.l) {
                    if let provenance = feed.provenance {
                        ProvenanceBar(provenance)
                    }

                    switch feed {
                    case .unknown(let reason):
                        UnknownNotice(
                            title: "The artifact index is unknown",
                            reason: "\(reason)\n\nThis is not 'no outputs'. Until an index read succeeds this surface does not know what the cast has produced."
                        )
                    case .loaded(let feed, _):
                        Picker("Filter", selection: $filter) {
                            ForEach(ArtifactFilter.allCases, id: \.self) { candidate in
                                Text(candidate.label).tag(candidate)
                            }
                        }
                        .pickerStyle(.segmented)
                        .sensoryFeedback(.selection, trigger: filter)

                        let items = shown(feed)
                        if items.isEmpty {
                            EmptyStateView(
                                systemImage: "tray",
                                title: "No \(filter.label.lowercased()) today",
                                message: "The last index read returned nothing in this filter."
                            )
                        } else {
                            VStack(spacing: PD.Space.s) {
                                ForEach(items) { artifact in
                                    ArtifactRow(artifact: artifact)
                                }
                            }
                        }
                    }
                }
                .padding(PD.Space.l)
            }
            .navigationTitle("Artifacts")
        }
    }
}

public struct ArtifactRow: View {
    let artifact: Artifact

    public init(artifact: Artifact) {
        self.artifact = artifact
    }

    public var body: some View {
        HStack(spacing: PD.Space.m) {
            Image(systemName: artifact.kind.systemImage)
                .font(.body.weight(.semibold))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(artifact.tint)
                .frame(width: 30, height: 30)
                .background(
                    RoundedRectangle(cornerRadius: PD.Radius.small, style: .continuous)
                        .fill(artifact.tint.opacity(0.12))
                )

            VStack(alignment: .leading, spacing: 2) {
                Text(artifact.title)
                    .font(.body.weight(.semibold))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: PD.Space.xs) {
                    Text(artifact.byLine)
                        .foregroundStyle(PD.Chrome.secondaryText)
                    Text("· \(artifact.meta)")
                        .foregroundStyle(PD.Chrome.tertiaryText)
                }
                .font(.subheadline)
                .lineLimit(1)
                .truncationMode(.tail)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if artifact.kind == .receipt {
                VerifyBadge(tint: artifact.tint)
            } else {
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(PD.Chrome.tertiaryText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: PD.minimumTapTarget)
        .padding(.vertical, PD.Space.s)
        .padding(.horizontal, PD.Space.m)
        .background(RoundedRectangle(cornerRadius: PD.Radius.standard, style: .continuous).fill(PD.Chrome.card))
        .overlay(RoundedRectangle(cornerRadius: PD.Radius.standard, style: .continuous).stroke(PD.Chrome.border, lineWidth: 1))
    }
}

/// "verify" on a receipt row — the browser-verifiable claim. A capability, not
/// a decoration: a receipt you cannot verify is theatre.
public struct VerifyBadge: View {
    let tint: Color

    public init(tint: Color) {
        self.tint = tint
    }

    public var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "checkmark.shield")
                .font(.caption2.weight(.bold))
            Text("Verify")
                .font(.caption.weight(.semibold))
        }
        .foregroundStyle(tint)
        .padding(.horizontal, PD.Space.s)
        .padding(.vertical, 3)
        .overlay(RoundedRectangle(cornerRadius: PD.Radius.small, style: .continuous).stroke(tint, lineWidth: 1))
        .fixedSize()
    }
}

#if DEBUG
#Preview("Artifacts — fixture feed") {
    ArtifactsView()
}
#endif
