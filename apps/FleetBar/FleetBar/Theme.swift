import SwiftUI
import AppKit

// MARK: - FleetBar Design Tokens
//
// Harbor Heritage adapted for macOS vibrancy.
// The website uses cobalt/teal/amber on cream (see website-v2/docs/design/BRAND.md).
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
        static var popoverBackground: SwiftUI.Color { Color.adaptive(light: "#F2EEE6", dark: "#101216") }
        static var panel: SwiftUI.Color { Color.adaptive(light: "#F7F3EB", dark: "#181C22") }
        static var panelRaised: SwiftUI.Color { Color.adaptive(light: "#E9E2D5", dark: "#222833") }
        static var card: SwiftUI.Color { Color.adaptive(light: "#F7F3EB", dark: "#181C22") }
        static var border: SwiftUI.Color { Color.adaptive(light: "#D5CABC", dark: "#2D3542") }
        static var rule: SwiftUI.Color { Color.adaptive(light: "#C9BDAE", dark: "#3A4350").opacity(0.68) }
        static var secondaryText: SwiftUI.Color { SwiftUI.Color.secondary }
        static var tertiaryText: SwiftUI.Color { SwiftUI.Color.secondary.opacity(0.72) }
    }

    // MARK: - Semantic Colors
    //
    // These adapt automatically to light/dark/vibrancy.
    // Defined as computed properties so they resolve at render time.

    enum Color {
        static func adaptive(light: String, dark: String) -> SwiftUI.Color {
            SwiftUI.Color(nsColor: NSColor(name: nil) { appearance in
                let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                return nsColor(hex: isDark ? dark : light)
            })
        }

        static func fixed(_ hex: String) -> SwiftUI.Color {
            SwiftUI.Color(nsColor: nsColor(hex: hex))
        }

        /// Healthy agents, live connection — muted teal-green, not traffic-light green
        static let healthy = adaptive(light: "#2E7D5B", dark: "#5FCE97")

        /// Active/running agents — palette-v2 cobalt.
        static let active = adaptive(light: "#003FB8", dark: "#7DB4FF")
        static let activeSlab = fixed("#003FB8")

        /// Warning state — warm amber (brand status-warning)
        static let warning = adaptive(light: "#B8801F", dark: "#F2BE51")

        /// Failure state — muted red, not screaming
        static let failure = adaptive(light: "#B5392E", dark: "#FF7D7D")

        /// Human gates and blocked work — palette-v2 violet/plum.
        static let blocked = adaptive(light: "#6B3F8A", dark: "#E0A5ED")
        static let violetSlab = fixed("#933FA5")

        /// Economy/budget — palette-v2 solid gold.
        static let gold = adaptive(light: "#666A00", dark: "#D8DD3C")
        static let onGold = adaptive(light: "#FBF7EF", dark: "#121212")

        /// Idle/dormant — warm gray, not cold
        static let dormant = adaptive(light: "#98928A", dark: "#A59F93")

        /// Dead agents — faded version of failure
        static let dead = failure.opacity(0.45)

        /// Parse a `#RRGGBB` / `#RGB` hex string (as the daemon reports a berth
        /// colour, ADR-0084) into a Color. Returns nil on a malformed string so
        /// callers fall back to a tier-derived default rather than rendering wrong.
        static func hex(_ raw: String) -> SwiftUI.Color? {
            var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if s.hasPrefix("#") { s.removeFirst() }
            if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() } // #RGB → #RRGGBB
            guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
            return SwiftUI.Color(
                red:   Double((v >> 16) & 0xFF) / 255.0,
                green: Double((v >> 8) & 0xFF) / 255.0,
                blue:  Double(v & 0xFF) / 255.0
            )
        }

        private static func nsColor(hex raw: String) -> NSColor {
            var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if s.hasPrefix("#") { s.removeFirst() }
            if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
            guard s.count == 6, let v = UInt32(s, radix: 16) else {
                return NSColor.labelColor
            }
            return NSColor(
                calibratedRed: CGFloat((v >> 16) & 0xFF) / 255.0,
                green: CGFloat((v >> 8) & 0xFF) / 255.0,
                blue: CGFloat(v & 0xFF) / 255.0,
                alpha: 1
            )
        }
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
