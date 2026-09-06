import SwiftUI

// MARK: - Artifacts — browse the outputs (design pass: mobile-intent-first)
//
// What the durable cast actually produced: PRs, docs, renders, and receipts.
// Receipts are first-class here because a receipt is browsable EVIDENCE — the
// operator can verify a decision without trusting this app's UI, which is the
// whole point of the receipt chain. A hand-authored fixture for now; the
// artifact index endpoint is not built, so every view wears a fixture bar.

public struct Artifact: Codable, Sendable, Identifiable {
    public enum Kind: String, Codable, Sendable, CaseIterable {
        case pr
        case doc
        case render
        case receipt

        public var label: String {
            switch self {
            case .pr:      return "PRs"
            case .doc:     return "Docs"
            case .render:  return "Renders"
            case .receipt: return "Receipts"
            }
        }

        /// Weight-matched SF Symbol per the beauty pass.
        public var systemImage: String {
            switch self {
            case .pr:      return "arrow.triangle.branch"
            case .doc:     return "doc.text"
            case .render:  return "photo"
            case .receipt: return "checkmark.seal"
            }
        }
    }

    /// A receipt is the one artifact with a verdict — approved or denied, both
    /// sealed. Everything else has no verdict.
    public enum Verdict: String, Codable, Sendable {
        case approved
        case denied

        var state: CoordinationState {
            switch self {
            case .approved: return .affirmative // green
            case .denied:   return .refuse      // red
            }
        }
    }

    public let id: String
    public let kind: Kind
    public let title: String
    public let byLine: String
    public let meta: String
    public let verdict: Verdict?
    public let receiptID: String?

    /// PRs/docs/renders take the neutral chrome tint; receipts take their
    /// verdict colour, because a receipt's meaning IS its verdict.
    public var tint: Color {
        if let verdict { return PD.color(for: verdict.state) }
        switch kind {
        case .pr:     return PD.Palette.active
        case .doc:    return PD.Chrome.secondaryText
        case .render: return PD.Palette.signal
        case .receipt: return PD.Palette.healthy
        }
    }
}

public struct ArtifactFeed: Codable, Sendable {
    public let note: String?
    public let artifacts: [Artifact]
}
