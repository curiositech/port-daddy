import XCTest
import SwiftUI
@testable import PortDaddyKit

/// Theme.swift had no test file at all. The ANSI colour-bucket LAW is
/// parity-tested against the TypeScript in MaritimeSignalsParityTests, but
/// nothing pinned that `PD.color(for:)` wires each bucket to the RIGHT
/// Palette colour, or that the spacing/tap-target tokens are what the file's
/// own header (ADR-0125 §7 — "state is never colour alone", "tap targets
/// >= 44pt") claims they are.
final class ThemeTests: XCTestCase {

    // MARK: - The bucket -> Palette mapping

    /// `PD.color(for: MaritimeSignals.ColorBucket)` is a switch with no
    /// `default:` — the same "the compiler makes you answer" rule the file's
    /// own comment draws between this function and `ControlVerbs.unsupportedReason`.
    /// Pinning every arm here means a bucket quietly wired to the wrong
    /// Palette colour (`.red` returning `Palette.warning` instead of
    /// `Palette.failure`, say) fails a test instead of only being visible on
    /// a device.
    func testEveryColorBucketMapsToItsOwnPaletteColor() {
        XCTAssertEqual(PD.color(for: .green), PD.Palette.healthy)
        XCTAssertEqual(PD.color(for: .yellow), PD.Palette.warning)
        XCTAssertEqual(PD.color(for: .red), PD.Palette.failure)
        XCTAssertEqual(PD.color(for: .blue), PD.Palette.active)
        XCTAssertEqual(PD.color(for: .magenta), PD.Palette.signal)
        XCTAssertEqual(PD.color(for: .gray), PD.Palette.dormant)
    }

    /// Every semantic colour is distinct. The header's law is "state is never
    /// colour alone" precisely because colour alone is not always enough to
    /// tell two states apart for every viewer — two buckets resolving to the
    /// same RGB would make the chip's word and flag letter the ONLY thing
    /// distinguishing them, silently, with nothing here to catch it.
    func testEveryPaletteColorIsDistinct() {
        let colors: Set<Color> = [
            PD.Palette.healthy, PD.Palette.active, PD.Palette.warning,
            PD.Palette.failure, PD.Palette.dormant, PD.Palette.signal,
        ]
        XCTAssertEqual(colors.count, 6, "two semantic Palette colours resolved to the same value")
    }

    /// `PD.color(for: CoordinationState)` composes `MaritimeSignals.bucket(for:)`
    /// with the mapping above. This is the call site every chip in
    /// Components.swift and InterruptionsView.swift actually uses, so it is
    /// pinned directly rather than trusting the two halves compose correctly.
    func testColorForCoordinationStateMatchesItsOwnBucket() {
        for state in CoordinationState.allCases {
            let bucket = MaritimeSignals.bucket(for: state)
            XCTAssertEqual(
                PD.color(for: state), PD.color(for: bucket),
                "\(state.rawValue) did not resolve through its own bucket (\(bucket))"
            )
        }
    }

    // MARK: - Spacing tokens

    /// The file's own header says "8pt grid, as FleetBar". Pinned as values,
    /// not just relative ordering, so a token silently drifting off the grid
    /// (an `m` of 10 instead of 12, say) is visible here rather than only as
    /// a layout that looks faintly wrong on a device.
    func testSpacingTokensFormTheDocumented8ptGrid() {
        XCTAssertEqual(PD.Space.xs, 4)
        XCTAssertEqual(PD.Space.s, 8)
        XCTAssertEqual(PD.Space.m, 12)
        XCTAssertEqual(PD.Space.l, 16)
        XCTAssertEqual(PD.Space.xl, 20)
        XCTAssertEqual(PD.Space.xxl, 24)

        let ordered = [PD.Space.xs, PD.Space.s, PD.Space.m, PD.Space.l, PD.Space.xl, PD.Space.xxl]
        XCTAssertEqual(ordered, ordered.sorted(), "the named steps must widen in the order they are named")
        XCTAssertEqual(Set(ordered).count, ordered.count, "two spacing steps collapsed to the same value")
    }

    /// ADR-0125 §7's accessibility floor. Every interactive row applies
    /// `PD.minimumTapTarget` rather than a hand-typed 44, so the floor moving
    /// is a one-token change — but only if the token itself still meets it.
    func testMinimumTapTargetMeetsTheAccessibilityFloor() {
        XCTAssertGreaterThanOrEqual(PD.minimumTapTarget, 44)
    }
}
