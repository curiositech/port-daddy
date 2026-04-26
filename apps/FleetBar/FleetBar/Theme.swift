import SwiftUI

// MARK: - FleetBar Design Tokens
//
// Harbor Heritage adapted for macOS vibrancy.
// The website uses sandstone/cinnabar/warm-ebony on opaque surfaces.
// FleetBar uses translucent materials, so colors must work over any desktop.
//
// Personality: Professional with natural warmth.
// The harbor master's instrument panel — calm until it matters.

enum Fleet {

    // MARK: - Spacing (8pt grid)

    enum Space {
        static let xs:   CGFloat = 4
        static let s:    CGFloat = 8
        static let m:    CGFloat = 12
        static let l:    CGFloat = 16
        static let xl:   CGFloat = 20
        static let xxl:  CGFloat = 24
    }

    // MARK: - Radius (continuous corners everywhere)

    enum Radius {
        static let small:    CGFloat = 6
        static let standard: CGFloat = 10
        static let medium:   CGFloat = 12
    }

    enum Chrome {
        static var popoverBackground: SwiftUI.Color { SwiftUI.Color(nsColor: .windowBackgroundColor).opacity(0.98) }
        static var panel: SwiftUI.Color { SwiftUI.Color(nsColor: .controlBackgroundColor).opacity(0.96) }
        static var panelRaised: SwiftUI.Color { SwiftUI.Color(nsColor: .underPageBackgroundColor).opacity(0.98) }
        static var card: SwiftUI.Color { SwiftUI.Color(nsColor: .textBackgroundColor).opacity(0.98) }
        static var border: SwiftUI.Color { SwiftUI.Color.primary.opacity(0.08) }
        static var secondaryText: SwiftUI.Color { SwiftUI.Color.secondary }
        static var tertiaryText: SwiftUI.Color { SwiftUI.Color.secondary.opacity(0.72) }
    }

    // MARK: - Semantic Colors
    //
    // These adapt automatically to light/dark/vibrancy.
    // Defined as computed properties so they resolve at render time.

    enum Color {
        /// Healthy agents, live connection — muted teal-green, not traffic-light green
        static let healthy = SwiftUI.Color(red: 0.29, green: 0.73, blue: 0.62)

        /// Active/running agents — warm blue, conveys motion without alarm
        static let active  = SwiftUI.Color(red: 0.35, green: 0.58, blue: 0.85)

        /// Warning state — warm amber (harbor heritage cinnabar, softened)
        static let warning = SwiftUI.Color(red: 0.88, green: 0.55, blue: 0.25)

        /// Failure state — muted red, not screaming
        static let failure = SwiftUI.Color(red: 0.78, green: 0.28, blue: 0.24)

        /// Idle/dormant — warm gray, not cold
        static let dormant = SwiftUI.Color(red: 0.55, green: 0.53, blue: 0.50)

        /// Dead agents — faded version of failure
        static let dead    = SwiftUI.Color(red: 0.78, green: 0.28, blue: 0.24).opacity(0.4)
    }

    // MARK: - Agent Icons
    //
    // Each fleet agent type gets a distinct SF Symbol
    // that tells you what it does at a glance.

    static func agentIcon(for name: String) -> String {
        switch name.lowercased() {
        case "spark":          return "sparkles"
        case "spider":         return "network"
        case "qa":             return "checkmark.shield"
        case "test-hunter":    return "scope"
        case "documentarian":  return "doc.text.magnifyingglass"
        case "simplifier":     return "scissors"
        case "cartographer":   return "map"
        case "gardener":       return "leaf"
        default:               return "gearshape"
        }
    }

    // MARK: - Type Icons

    static func typeIcon(for type: FleetAgent.AgentType) -> String {
        switch type {
        case .scheduled: return "clock"
        case .triggered: return "bolt.fill"
        case .watcher:   return "eye"
        case .adhoc:     return "person.crop.circle.badge.plus"
        }
    }

    // MARK: - Animation

    enum Motion {
        static let expandSpring: Animation = .spring(response: 0.35, dampingFraction: 0.8)
        static let snappy: Animation = .spring(response: 0.25, dampingFraction: 0.85)
        static let rowStagger: TimeInterval = 0.04
        static let sectionStagger: TimeInterval = 0.06
    }
}
