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
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: configuration.isPressed)
            // Impact only on the press down, not the release — one tick per tap.
            .sensoryFeedback(.impact(weight: .light), trigger: configuration.isPressed) { _, pressed in
                pressed
            }
    }
}
