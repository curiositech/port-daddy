import SwiftUI
import Foundation

// MARK: - Shared components
//
// Three of these exist to make a specific kind of dishonesty inconvenient:
//
//   SignalChip     — state is a flag letter plus a word plus a colour, so it
//                    survives colour blindness, greyscale and a screenshot.
//   ProvenanceBar  — says where the data on screen came from. A view driven by
//                    a fixture shows a fixture bar. There is no way to render
//                    fixture data through these views without it.
//   UnknownNotice  — the shape of "we could not find out", which is never the
//                    same shape as "there is nothing".

/// A coordination state rendered the Port Daddy way: `[F] awaiting-human`.
///
/// The letter is not decoration. It is the same ICS flag every other surface
/// prints for this state, resolved through MaritimeSignals — a view never
/// picks a letter or a colour itself.
public struct SignalChip: View {
    let state: CoordinationState
    let text: String?

    public init(state: CoordinationState, text: String? = nil) {
        self.state = state
        self.text = text
    }

    private var letter: String { MaritimeSignals.signal(for: state).rawValue }
    private var label: String { text ?? state.rawValue }

    public var body: some View {
        HStack(spacing: PD.Space.xs) {
            Text(letter)
                .font(.caption.weight(.bold))
                .frame(minWidth: 16)
                .padding(.horizontal, 5)
                .padding(.vertical, 2)
                .background(RoundedRectangle(cornerRadius: 4).fill(PD.color(for: state).opacity(0.22)))
                .overlay(RoundedRectangle(cornerRadius: 4).stroke(PD.color(for: state), lineWidth: 1))
            Text(label)
                .font(.caption.weight(.semibold))
        }
        .foregroundStyle(PD.color(for: state))
        .padding(.horizontal, PD.Space.s)
        .padding(.vertical, PD.Space.xs)
        .background(RoundedRectangle(cornerRadius: PD.Radius.small).fill(PD.color(for: state).opacity(0.10)))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label). Signal flag \(MaritimeSignals.phonetic(for: state)).")
    }
}

/// Where what you are looking at came from.
public enum Provenance: Equatable, Sendable {
    /// Read from the relay, this session.
    case live(source: String)
    /// The last thing the relay said, kept while the network is unreachable.
    case cached(age: TimeInterval)
    /// A checked-in fixture. Never silent.
    case fixture(name: String)
    /// The server piece does not exist yet.
    case unbuilt(what: String)

    var coordinationState: CoordinationState {
        switch self {
        case .live:    return .fleetHealthy
        case .cached:  return .claimStale
        case .fixture: return .inform
        case .unbuilt: return .blocked
        }
    }

    var text: String {
        switch self {
        case .live(let source):   return "Live from \(source)"
        case .cached(let age):    return "Cached — last read \(RelativeAge.short(age)) ago"
        case .fixture(let name):  return "Fixture data — \(name)"
        case .unbuilt(let what):  return "Not built yet — \(what)"
        }
    }

    var systemImage: String {
        switch self {
        case .live:    return "antenna.radiowaves.left.and.right"
        case .cached:  return "clock.arrow.circlepath"
        case .fixture: return "shippingbox"
        case .unbuilt: return "hammer"
        }
    }
}

public struct ProvenanceBar: View {
    let provenance: Provenance

    public init(_ provenance: Provenance) {
        self.provenance = provenance
    }

    public var body: some View {
        HStack(spacing: PD.Space.s) {
            Image(systemName: provenance.systemImage)
                .imageScale(.small)
            Text(provenance.text)
                .font(.subheadline)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .foregroundStyle(PD.color(for: provenance.coordinationState))
        .padding(.horizontal, PD.Space.m)
        .padding(.vertical, PD.Space.s)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: PD.Radius.standard)
                .fill(PD.color(for: provenance.coordinationState).opacity(0.10))
        )
        .accessibilityElement(children: .combine)
    }
}

/// "Nothing here" — used only when the surface actually knows there is
/// nothing. When it does not know, use `UnknownNotice`.
public struct EmptyStateView: View {
    let systemImage: String
    let title: String
    let message: String

    public init(systemImage: String, title: String, message: String) {
        self.systemImage = systemImage
        self.title = title
        self.message = message
    }

    public var body: some View {
        VStack(spacing: PD.Space.m) {
            Image(systemName: systemImage)
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(PD.Chrome.tertiaryText)
            Text(title)
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(PD.Chrome.secondaryText)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, PD.Space.xxl)
        .accessibilityElement(children: .combine)
    }
}

/// The other empty state: the one where the answer is "we could not find out".
///
/// Visually distinct from `EmptyStateView` on purpose. An operator who cannot
/// tell "no open asks" from "could not reach the relay" has been told the
/// wrong thing by the surface, not by the network.
public struct UnknownNotice: View {
    let title: String
    let reason: String
    let retry: (() -> Void)?

    public init(title: String, reason: String, retry: (() -> Void)? = nil) {
        self.title = title
        self.reason = reason
        self.retry = retry
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: PD.Space.m) {
            SignalChip(state: .idle, text: "unknown")
            Text(title)
                .font(.headline)
            Text(reason)
                .font(.subheadline)
                .foregroundStyle(PD.Chrome.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
            if let retry {
                Button(action: retry) {
                    Label("Try again", systemImage: "arrow.clockwise")
                        .font(.body)
                        .frame(minHeight: PD.minimumTapTarget)
                }
                .buttonStyle(.bordered)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PD.Space.l)
        .background(RoundedRectangle(cornerRadius: PD.Radius.medium).fill(PD.Chrome.card))
        .overlay(RoundedRectangle(cornerRadius: PD.Radius.medium).stroke(PD.Chrome.border, lineWidth: 1))
    }
}

/// A titled card. Sections on this surface are cards, not plain list groups,
/// because most of them carry a provenance line that needs to sit inside the
/// same visual boundary as the thing it describes.
public struct SectionCard<Content: View>: View {
    let title: String
    let subtitle: String?
    // The result-builder attribute lives on the initializer, not on the stored
    // property — the property just holds the closure the builder produced.
    let content: () -> Content

    public init(title: String, subtitle: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.subtitle = subtitle
        self.content = content
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: PD.Space.m) {
            VStack(alignment: .leading, spacing: PD.Space.xs) {
                Text(title)
                    .font(.headline)
                if let subtitle {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(PD.Chrome.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PD.Space.l)
        .background(RoundedRectangle(cornerRadius: PD.Radius.medium).fill(PD.Chrome.card))
        .overlay(RoundedRectangle(cornerRadius: PD.Radius.medium).stroke(PD.Chrome.border, lineWidth: 1))
    }
}
