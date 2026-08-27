import SwiftUI

// MARK: - Ideas — proposals + chat to explore (design pass: mobile-intent-first)
//
// Beauty pass applied: violet zone, weight-matched symbols, continuous corners,
// chat bubbles with a clear speaker asymmetry. Honesty pass: the actions and
// composer are disabled with their reason — Snipe's suggestion job and the
// per-idea threads are unbuilt, and a Send button that did nothing would be the
// exact dishonesty this app refuses.

public struct IdeasView: View {
    let feed: Loadable<IdeasFeed>

    public init(feed: Loadable<IdeasFeed>? = nil) {
        self.feed = feed ?? IdeasView.fixtureFeed()
    }

    /// The Ideas zone accent (the "signal" magenta bucket).
    private let zone = PD.Palette.signal

    static func fixtureFeed() -> Loadable<IdeasFeed> {
        do {
            return .loaded(try PortDaddyFixtures.ideas(), provenance: .fixture(name: "ideas.fixture.json"))
        } catch {
            return .unknown(reason: String(describing: error))
        }
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
                            title: "Ideas are unknown",
                            reason: "\(reason)\n\nThis is not 'no ideas'. Until Snipe's feed is read this surface does not know what has been proposed."
                        )
                    case .loaded(let feed, _):
                        if feed.ideas.isEmpty {
                            EmptyStateView(
                                systemImage: "lightbulb",
                                title: "No new ideas",
                                message: "Snipe surfaces suggestions as it works. None are waiting right now."
                            )
                        } else {
                            ForEach(feed.ideas) { idea in
                                IdeaCard(idea: idea, zone: zone)
                            }
                        }

                        if let topic = feed.exploringTopic, !feed.chat.isEmpty {
                            exploring(topic: topic, chat: feed.chat)
                        }
                    }
                }
                .padding(PD.Space.l)
            }
            .navigationTitle("Ideas")
        }
    }

    @ViewBuilder
    private func exploring(topic: String, chat: [ChatMessage]) -> some View {
        VStack(alignment: .leading, spacing: PD.Space.m) {
            Label("Exploring · \(topic)", systemImage: "bubble.left.and.bubble.right")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(PD.Chrome.secondaryText)

            VStack(spacing: PD.Space.s) {
                ForEach(chat) { message in
                    ChatBubble(message: message, zone: zone)
                }
            }

            // Inert composer — chat is not built. Shown so the shape is honest,
            // disabled so the promise is.
            HStack(spacing: PD.Space.s) {
                Text("Chat isn't built yet")
                    .font(.subheadline)
                    .foregroundStyle(PD.Chrome.tertiaryText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, PD.Space.m)
                    .frame(minHeight: PD.minimumTapTarget)
                    .overlay(RoundedRectangle(cornerRadius: PD.Radius.standard, style: .continuous).stroke(PD.Chrome.border, lineWidth: 1))
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title2)
                    .foregroundStyle(PD.Chrome.tertiaryText)
            }
            .opacity(0.7)
            .accessibilityLabel("Chat composer, disabled — chat with agents is not built yet.")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

public struct IdeaCard: View {
    let idea: Idea
    let zone: Color

    public init(idea: Idea, zone: Color) {
        self.idea = idea
        self.zone = zone
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: PD.Space.s) {
            HStack(spacing: PD.Space.xs) {
                Image(systemName: "lightbulb.fill")
                    .font(.caption.weight(.semibold))
                Text("NEW IDEA")
                    .font(.caption.weight(.bold))
                    .tracking(1)
                Spacer(minLength: 0)
                Text("from \(idea.source)")
                    .font(.subheadline)
                    .foregroundStyle(PD.Chrome.secondaryText)
            }
            .foregroundStyle(zone)

            Text(idea.title)
                .font(.body.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)

            Text(idea.why)
                .font(.subheadline)
                .foregroundStyle(PD.Chrome.secondaryText)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: PD.Space.s) {
                ideaAction("Promote", systemImage: "arrow.up.forward.square", prominent: true)
                ideaAction("Discuss", systemImage: "bubble.left")
                ideaAction("Dismiss", systemImage: "xmark")
            }
            .padding(.top, PD.Space.xs)

            Label("Promote, discuss and dismiss aren't wired yet — Snipe's suggestion job is unbuilt.", systemImage: "hammer")
                .font(.subheadline)
                .foregroundStyle(PD.color(for: .blocked))
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PD.Space.l)
        .background(
            RoundedRectangle(cornerRadius: PD.Radius.medium, style: .continuous).fill(PD.Chrome.card)
        )
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 2, style: .continuous).fill(zone).frame(width: 3).padding(.vertical, PD.Space.s)
        }
        .overlay(RoundedRectangle(cornerRadius: PD.Radius.medium, style: .continuous).stroke(PD.Chrome.border, lineWidth: 1))
    }

    @ViewBuilder
    private func ideaAction(_ title: String, systemImage: String, prominent: Bool = false) -> some View {
        HStack(spacing: PD.Space.xs) {
            Image(systemName: systemImage)
                .font(.caption.weight(.semibold))
            Text(title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
        }
        .foregroundStyle(prominent ? zone : PD.Chrome.secondaryText)
        .frame(maxWidth: .infinity)
        .frame(minHeight: PD.minimumTapTarget - 4)
        .background(
            RoundedRectangle(cornerRadius: PD.Radius.small, style: .continuous)
                .fill(prominent ? zone.opacity(0.12) : Color.clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: PD.Radius.small, style: .continuous)
                .stroke(prominent ? zone : PD.Chrome.border, lineWidth: 1)
        )
        .opacity(0.7)
    }
}

public struct ChatBubble: View {
    let message: ChatMessage
    let zone: Color

    public init(message: ChatMessage, zone: Color) {
        self.message = message
        self.zone = zone
    }

    private var isYou: Bool { message.role == .you }

    public var body: some View {
        HStack {
            if isYou { Spacer(minLength: PD.Space.xxl) }
            VStack(alignment: .leading, spacing: 2) {
                if !isYou {
                    Text(message.author.uppercased())
                        .font(.caption2.weight(.bold))
                        .tracking(0.6)
                        .foregroundStyle(PD.Chrome.tertiaryText)
                }
                Text(message.text)
                    .font(.subheadline)
                    .foregroundStyle(isYou ? Color.white : PD.Chrome.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, PD.Space.m)
            .padding(.vertical, PD.Space.s)
            .background(
                RoundedRectangle(cornerRadius: PD.Radius.medium, style: .continuous)
                    .fill(isYou ? zone : PD.Chrome.card)
            )
            .overlay(
                RoundedRectangle(cornerRadius: PD.Radius.medium, style: .continuous)
                    .stroke(isYou ? Color.clear : PD.Chrome.border, lineWidth: 1)
            )
            if !isYou { Spacer(minLength: PD.Space.xxl) }
        }
    }
}

#if DEBUG
#Preview("Ideas — fixture feed") {
    IdeasView()
}
#endif
