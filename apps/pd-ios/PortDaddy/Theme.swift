import SwiftUI
import UIKit

// MARK: - Design tokens — Story Linework v2 (docs/design/story-linework/proposal.html)
//
// This is the canonical palette: every hue re-derived in OKLCH and gated by
// CIEDE2000 so no two semantic colours read the same, and every foreground/
// background pair verified against WCAG 2.2 (§02 of the proposal). The values
// below are the exact light/dark hexes from ports/port.css — not an
// approximation that splits the difference and matches neither theme.
//
// The bar this surface is held to:
//   - SF Symbols, never emoji.  - Dynamic Type, no body text below 14pt.
//   - Tap targets >= 44pt.      - Both themes shipped together.
//   - State is never colour alone (maritime chip: flag + word + colour).
//
// Line-weight law (§05): 1px = texture (hairlines), 1.5px = linework marks
// (brackets, pulse rings, stripes), 2px = enclosure (primary panels). Never
// adjacent-mix 1.5 and 2.

public enum PD {

    // MARK: - Spacing (8pt grid)

    public enum Space {
        public static let xs: CGFloat = 4
        public static let s: CGFloat = 8
        public static let m: CGFloat = 12
        public static let l: CGFloat = 16
        public static let xl: CGFloat = 20
        public static let xxl: CGFloat = 24
    }

    public enum Radius {
        public static let small: CGFloat = 6
        public static let standard: CGFloat = 10
        public static let medium: CGFloat = 12
    }

    /// The line-weight law, as widths.
    public enum Line {
        public static let hairline: CGFloat = 1     // texture
        public static let mark: CGFloat = 1.5       // linework: brackets, stripes, pulse rings
        public static let enclosure: CGFloat = 2    // primary panels
        public static let stripe: CGFloat = 3       // layer/state stripe inset
        public static let bracket: CGFloat = 14     // corner tick length
    }

    public static let minimumTapTarget: CGFloat = 44

    // MARK: - Surfaces + chrome (exact, theme-aware)

    public enum Chrome {
        public static let base    = dyn(0xf2eee6, 0x101216)
        public static let raised  = dyn(0xf7f3eb, 0x181c22)
        public static let strong  = dyn(0xe9e2d5, 0x222833)
        public static let sunken  = dyn(0xe0d9cb, 0x0b0d11)
        /// The card well: light cream compresses tints, so cards sit on STRONG
        /// (1.11:1 vs base); dark keeps RAISED. Either way an unbordered card
        /// MUST carry a hairline edge — see the proposal's adjacency study.
        public static let card    = dyn(0xe9e2d5, 0x181c22)
        public static let cardRaised = dyn(0xf7f3eb, 0x222833)
        public static let inverse = dyn(0xfbf7ef, 0x121212)

        public static let primaryText   = dyn(0x121212, 0xf5f3ed)
        public static let secondaryText = dyn(0x403b34, 0xd3cec2)
        public static let mutedText     = dyn(0x47423a, 0xa59f93)
        public static let ghostText     = dyn(0x98928a, 0x5c574e)
        // Alias kept for existing call sites.
        public static var tertiaryText: Color { mutedText }

        /// 1px texture hairline (ink at 14% / cream at 14%).
        public static let hair = Color(uiColor: UIColor { t in
            t.userInterfaceStyle == .dark
                ? UIColor(white: 0.96, alpha: 0.14)
                : UIColor(white: 0.07, alpha: 0.14)
        })
        /// The heavier hairline used for brackets and fractional linework.
        public static let strongBorder = Color(uiColor: UIColor { t in
            t.userInterfaceStyle == .dark
                ? UIColor(white: 0.96, alpha: 0.34)
                : UIColor(white: 0.07, alpha: 0.34)
        })
        /// 2px enclosure ink — full-strength border for primary panels.
        public static let borderStrong = dyn(0x121212, 0xf5f3ed)
        // Alias kept for existing call sites.
        public static var border: Color { hair }
    }

    // MARK: - Palette v2 (CIEDE2000-separated, WCAG-verified)

    public enum Palette {
        public static let cobalt = dyn(0x003fb8, 0x7db4ff)
        public static let teal   = dyn(0x006b5f, 0x8fd0a7)
        public static let health = dyn(0x1f7a4d, 0x5fce97)
        public static let amber  = dyn(0xa66f00, 0xf2be51)
        /// Amber is not a text colour on cream (3.71:1). Text uses this cut.
        public static let amberOnTint = dyn(0x5b3900, 0xffe0a0)
        public static let error  = dyn(0xbf2f2f, 0xff7d7d)
        public static let indigo = dyn(0x353a85, 0x8a8af8)   // protocol / federation
        public static let violet = dyn(0x933fa5, 0xe0a5ed)   // identity / continuity
        public static let rust   = dyn(0x7a4514, 0xb98e6b)   // reputation / Elo
        /// Economy / value — the money colour, its own token (not amber).
        public static let gold   = dyn(0x666a00, 0xd8dd3c)
        public static let goldOnTint = dyn(0x4d5000, 0xf5fa78)
        public static let lime   = Color(hex: 0xcad900)
        public static let dormant = Chrome.mutedText

        // Aliases kept for existing call sites (semantic → story name).
        public static var healthy: Color { health }
        public static var active: Color { cobalt }
        public static var warning: Color { amber }
        public static var failure: Color { error }
        public static var signal: Color { violet }
    }

    /// The ANSI colour law from lib/maritime-signals.ts, mapped to palette v2.
    /// The BUCKETS are canonical; the hexes are this surface's rendering.
    public static func color(for bucket: MaritimeSignals.ColorBucket) -> Color {
        switch bucket {
        case .green:   return Palette.health
        case .yellow:  return Palette.amber
        case .red:     return Palette.error
        case .blue:    return Palette.cobalt
        case .magenta: return Palette.violet
        case .gray:    return Palette.dormant
        }
    }

    public static func color(for state: CoordinationState) -> Color {
        color(for: MaritimeSignals.bucket(for: state))
    }

    // MARK: - Colour construction

    /// A light/dark dynamic colour from two 0xRRGGBB literals.
    static func dyn(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(uiColor: UIColor { t in
            t.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light)
        })
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(uiColor: UIColor(hex: hex))
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xff) / 255,
            green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255,
            alpha: 1
        )
    }
}
