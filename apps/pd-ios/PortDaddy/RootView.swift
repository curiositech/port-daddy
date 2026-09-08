import SwiftUI

// MARK: - Root
//
// The landing tab is the ROADMAP, not the fleet. That is an operator ruling,
// not a layout preference: the roadmap is home on every sanctioned surface —
// web account home, pd-console's roadmap pane, and here — and the fleet is the
// plumbing that serves it. A phone that opens on a list of running agents
// invites the operator to manage machinery; a phone that opens on the roadmap
// asks them what should happen next.
//
// Tab order follows how often an operator needs each: what should happen next,
// where can it happen, what is blocked on me, what can I do about it.

public enum RootTab: String, CaseIterable, Hashable, Sendable {
    case roadmap
    case harbors
    case asks
    case controls

    var title: String {
        switch self {
        case .roadmap:  return "Roadmap"
        case .harbors:  return "Harbors"
        case .asks:     return "Asks"
        case .controls: return "Controls"
        }
    }

    var systemImage: String {
        switch self {
        case .roadmap:  return "list.bullet.rectangle"
        case .harbors:  return "sailboat"
        case .asks:     return "bell.badge"
        case .controls: return "slider.horizontal.3"
        }
    }
}

public struct RootView: View {
    @State private var tab: RootTab = .roadmap
    @State private var inbox: Loadable<InterruptionListResponse>

    public init(inbox: Loadable<InterruptionListResponse>? = nil) {
        // Fixture-backed by default so previews and a fresh simulator launch
        // both render the real layout. The provenance bar inside each screen
        // states that it is a fixture — there is no unlabelled path.
        if let inbox {
            _inbox = State(initialValue: inbox)
        } else {
            _inbox = State(initialValue: RootView.fixtureInbox())
        }
    }

    static func fixtureInbox() -> Loadable<InterruptionListResponse> {
        do {
            return .loaded(try PortDaddyFixtures.interruptions(), provenance: .fixture(name: "interruptions.fixture.json"))
        } catch {
            return .unknown(reason: String(describing: error))
        }
    }

    /// The open-ask badge. Nil when the inbox is unknown, which renders as no
    /// badge rather than a zero — a zero badge is a claim that there is
    /// nothing waiting, and an unread inbox has not earned it.
    private var openAskBadge: Int? {
        guard let response = inbox.value else { return nil }
        let open = response.interruptions.filter { $0.state == .open }.count
        return open > 0 ? open : nil
    }

    public var body: some View {
        TabView(selection: $tab) {
            RoadmapHomeView()
                .tabItem { Label(RootTab.roadmap.title, systemImage: RootTab.roadmap.systemImage) }
                .tag(RootTab.roadmap)

            HarborsView()
                .tabItem { Label(RootTab.harbors.title, systemImage: RootTab.harbors.systemImage) }
                .tag(RootTab.harbors)

            InterruptionsView(inbox: inbox)
                .tabItem { Label(RootTab.asks.title, systemImage: RootTab.asks.systemImage) }
                .badge(openAskBadge ?? 0)
                .tag(RootTab.asks)

            ControlVerbsView()
                .tabItem { Label(RootTab.controls.title, systemImage: RootTab.controls.systemImage) }
                .tag(RootTab.controls)
        }
    }
}

#if DEBUG
#Preview("Root — roadmap lands first") {
    RootView()
}
#endif
