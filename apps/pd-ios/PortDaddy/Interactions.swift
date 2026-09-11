import SwiftUI

// MARK: - Interaction polish (native-app-designer pass)
//
// Physicality for tappable rows: a subtle spring scale on press plus a light
// impact haptic, so a tap feels like it lands rather than like a link firing.
// The skill's spring numbers (response 0.3, damping 0.7) — quick, decisive, no
// bounce overshoot that would read as playful on a serious operator surface.
//
// Applied ONLY to rows with a real destination. A press animation on a row that
// navigates nowhere is exactly the fake-affordance this app refuses, so
// Artifacts/Ideas rows (no detail built yet) do not get it.

public struct PressableCardStyle: ButtonStyle {
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            // Snappy UI-control spring (motion-design-web: stiffness ~400,
            // damping ~28 → response 0.25, damping 0.86). No lingering bounce
            // on a serious operator surface.
            .animation(.spring(response: 0.25, dampingFraction: 0.86), value: configuration.isPressed)
            // Impact only on the press down, not the release — one tick per tap.
            .sensoryFeedback(.impact(weight: .light), trigger: configuration.isPressed) { _, pressed in
                pressed
            }
    }
}

// MARK: - Live motion (Story Linework `lw-pulse`)

/// The proposal's own live primitive: an expanding 1.5px linework ring that
/// scales 0.7→1.9 and fades 0.8→0 on a 1.8s loop. This is what marks a running
/// agent, not an opacity fade. GPU-only (transform + opacity); frozen under
/// Reduce Motion, where the solid dot alone still reads as "live".
public struct PulseRing: View {
    let color: Color
    var diameter: CGFloat = 8
    @State private var expanded = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(color: Color, diameter: CGFloat = 8) {
        self.color = color
        self.diameter = diameter
    }

    public var body: some View {
        Circle()
            .strokeBorder(color, lineWidth: PD.Line.mark)
            .frame(width: diameter, height: diameter)
            .scaleEffect(expanded ? 1.9 : 0.7)
            .opacity(expanded ? 0 : 0.8)
            .animation(
                reduceMotion ? nil : .easeOut(duration: 1.8).repeatForever(autoreverses: false),
                value: expanded
            )
            .onAppear { if !reduceMotion { expanded = true } }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// A solid state dot with the live pulse ring behind it. The ring overshoots
/// its own 8pt box, so callers leave a little room around it.
public struct LiveDot: View {
    let color: Color

    public init(color: Color) {
        self.color = color
    }

    public var body: some View {
        ZStack {
            PulseRing(color: color, diameter: 8)
            Circle().fill(color).frame(width: 8, height: 8)
        }
        .frame(width: 8, height: 8)
    }
}
