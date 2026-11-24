import SwiftUI

/// The phone does not have a scoped Relay credential. Show the account pages
/// as browser destinations, and keep all bundled sample data behind a choice.
public struct RelayBetaView: View {
    public init() {
        PDFonts.registerIfNeeded(applyNavigationChrome: false)
    }

    public var body: some View {
        NavigationStack {
            page {
                VStack(alignment: .leading, spacing: PD.Space.s) {
                    Label("Not connected", systemImage: "link")
                        .font(PDFont.title2)
                        .foregroundStyle(PD.Chrome.primaryText)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("relay.not-connected")
                    Text("Live data is available in your browser. This beta doesn’t sign in to Relay directly.")
                        .font(PDFont.body)
                        .foregroundStyle(PD.Chrome.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }

                VStack(spacing: 0) {
                    Link(destination: RelayBrowserDestination.interruptions.url) {
                        RelayEntry(title: "Interruptions", detail: "See what needs your attention.",
                                   symbol: "bell", accessory: "arrow.up.right")
                    }
                    .accessibilityHint("Opens Relay in your browser")
                    .accessibilityIdentifier("relay.open-interruptions")

                    Divider().padding(.horizontal, PD.Space.l)

                    Link(destination: RelayBrowserDestination.harbors.url) {
                        RelayEntry(title: "Harbors", detail: "See which harbors are reachable.",
                                   symbol: "sailboat", accessory: "arrow.up.right")
                    }
                    .accessibilityHint("Opens Relay in your browser")
                    .accessibilityIdentifier("relay.open-harbors")
                }
                .buttonStyle(.plain)
                .background(PD.Chrome.cardRaised, in: RoundedRectangle(cornerRadius: PD.Radius.medium, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: PD.Radius.medium, style: .continuous)
                        .strokeBorder(PD.Chrome.hair)
                        .allowsHitTesting(false)
                }

                NavigationLink {
                    sampleMenu
                } label: {
                    Label("Explore sample data", systemImage: "rectangle.on.rectangle")
                        .font(PDFont.headline)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, minHeight: PD.minimumTapTarget, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .accessibilityIdentifier("relay.explore-sample")
            }
            .navigationTitle("Relay")
        }
        .tint(PD.Palette.cobalt)
    }

    private var sampleMenu: some View {
        page {
            RelaySampleNotice()

            VStack(spacing: 0) {
                NavigationLink {
                    InterruptionsView(inbox: RootView.fixtureInbox()).content
                        .navigationTitle("Sample inbox")
                } label: {
                    RelayEntry(title: "Sample inbox", detail: "See an interruption that needs a decision.",
                               symbol: "bell", accessory: "chevron.forward")
                }
                .accessibilityIdentifier("relay.sample-inbox")

                Divider().padding(.horizontal, PD.Space.l)

                NavigationLink {
                    HarborsView().content
                        .navigationTitle("Sample harbors")
                } label: {
                    RelayEntry(title: "Sample harbors", detail: "Compare current, stale, and unknown readings.",
                               symbol: "sailboat", accessory: "chevron.forward")
                }
                .accessibilityIdentifier("relay.sample-harbors")
            }
            .buttonStyle(.plain)
            .background(PD.Chrome.cardRaised, in: RoundedRectangle(cornerRadius: PD.Radius.medium, style: .continuous))
        }
        .navigationTitle("Sample data")
    }

    private func page<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PD.Space.xxl, content: content)
                .frame(maxWidth: 560, alignment: .leading)
                .padding(PD.Space.xl)
                .frame(maxWidth: .infinity)
        }
        .background(PD.Chrome.base)
    }
}

private struct RelayEntry: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let title: String
    let detail: String
    let symbol: String
    let accessory: String

    var body: some View {
        HStack(alignment: .top, spacing: PD.Space.m) {
            if !typeSize.isAccessibilitySize {
                Image(systemName: symbol)
                    .font(PDFont.headline)
                    .foregroundStyle(PD.Palette.cobalt)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: PD.Space.xs) {
                Text(title).font(PDFont.headline).foregroundStyle(PD.Chrome.primaryText)
                Text(detail).font(PDFont.subheadline).foregroundStyle(PD.Chrome.secondaryText)
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: accessory)
                .font(PDFont.subheadline.weight(.semibold))
                .foregroundStyle(PD.Palette.cobalt)
                .accessibilityHidden(true)
        }
        .frame(minHeight: PD.minimumTapTarget)
        .padding(PD.Space.l)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

struct RelaySampleNotice: View {
    var body: some View {
        Label("Sample data · Not your account", systemImage: "shippingbox")
            .font(PDFont.subheadline.weight(.semibold))
            .foregroundStyle(PD.Chrome.secondaryText)
            .fixedSize(horizontal: false, vertical: true)
            .padding(PD.Space.m)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(PD.Chrome.strong, in: RoundedRectangle(cornerRadius: PD.Radius.standard, style: .continuous))
            .accessibilityIdentifier("relay.sample-notice")
    }
}
