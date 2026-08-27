import SwiftUI

// MARK: - Design tokens (ADR-0125 §7)
//
// The bar this surface is held to:
//   - SF Symbols, never emoji.
//   - Dynamic Type, with no body text below 14 pt.
//   - Tap targets >= 44 pt.
//   - Both themes shipped together.
//   - State is never colour alone.
//
// The last one is why every state on this surface renders as a maritime chip:
// a flag letter, a word, and a colour. Strip the colour and it still reads.
// Strip the word and it still reads. That is the same reason the terminal
// surfaces print "[V] conflict" rather than a red dot.
//
// Semantic colours are the same RGB values apps/FleetBar/FleetBar/Theme.swift
// uses, so a state does not change hue between the operator's menu bar and
// the operator's phone. Chrome is expressed as opacity over Color.primary
// rather than platform materials, which gives a correct result in light and
// dark without importing UIKit.

public enum PD {

    // MARK: - Spacing (8pt grid, as FleetBar)

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

    /// Minimum tap target. Every interactive row applies this.
    public static let minimumTapTarget: CGFloat = 44

    // MARK: - Chrome

    public enum Chrome {
        public static var card: Color { Color.primary.opacity(0.045) }
        public static var cardRaised: Color { Color.primary.opacity(0.075) }
        public static var border: Color { Color.primary.opacity(0.10) }
        /// Heavier hairline for instrument brackets and fractional linework.
        public static var strongBorder: Color { Color.primary.opacity(0.34) }
        public static var secondaryText: Color { Color.secondary }
        public static var tertiaryText: Color { Color.secondary.opacity(0.72) }
    }

    // MARK: - Semantic colours (shared with FleetBar)

    public enum Palette {
        /// Healthy, live — muted teal-green, not traffic-light green.
        public static let healthy = Color(red: 0.29, green: 0.73, blue: 0.62)
        /// Active, informational — warm blue.
        public static let active = Color(red: 0.35, green: 0.58, blue: 0.85)
        /// Caution — warm amber.
        public static let warning = Color(red: 0.88, green: 0.55, blue: 0.25)
        /// Alert — muted red, not screaming.
        public static let failure = Color(red: 0.78, green: 0.28, blue: 0.24)
        /// Neutral, dormant — warm gray, not cold.
        public static let dormant = Color(red: 0.55, green: 0.53, blue: 0.50)
        /// Domain-specific signalling (the magenta bucket).
        public static let signal = Color(red: 0.62, green: 0.42, blue: 0.78)
    }

    /// The ANSI colour law from lib/maritime-signals.ts, expressed in the
    /// phone's palette. The BUCKETS are the canonical part; the RGB is this
    /// surface's rendering of them. Which letters share a bucket is not a
    /// decision this file gets to make.
    public static func color(for bucket: MaritimeSignals.ColorBucket) -> Color {
        switch bucket {
        case .green:   return Palette.healthy
        case .yellow:  return Palette.warning
        case .red:     return Palette.failure
        case .blue:    return Palette.active
        case .magenta: return Palette.signal
        case .gray:    return Palette.dormant
        }
    }

    public static func color(for state: CoordinationState) -> Color {
        color(for: MaritimeSignals.bucket(for: state))
    }
}
