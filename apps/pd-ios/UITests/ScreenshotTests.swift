import XCTest

/// Runs in the hosted simulator fixture lane. The browser destinations are
/// checked for visibility but never opened; tests exercise only sample data.
@MainActor
final class ScreenshotTests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testLight() { captureJourney(theme: "light", ax5: false) }
    func testDark() { captureJourney(theme: "dark", ax5: false) }
    func testLightAX5() { captureJourney(theme: "light", ax5: true) }
    func testDarkAX5() { captureJourney(theme: "dark", ax5: true) }

    private func captureJourney(theme: String, ax5: Bool) {
        let app = XCUIApplication()
        app.launchArguments = ["--relay-proof-\(theme)"] + (ax5 ? ["--relay-proof-ax5"] : [])
        let suffix = theme + (ax5 ? "-ax5" : "")
        app.launch()
        defer { app.terminate() }

        XCTAssertTrue(element("relay.not-connected", in: app).waitForExistence(timeout: 15))
        XCTAssertFalse(element("relay.sample-notice", in: app).exists)
        shot("01-relay-\(suffix)")
        reveal(element("relay.open-interruptions", in: app), in: app)
        reveal(element("relay.open-harbors", in: app), in: app)
        tap("relay.explore-sample", in: app)

        assertSampleNoticeIsVisible(in: app)
        tap("relay.sample-inbox", in: app)
        XCTAssertTrue(element("relay.sample-ask.critical", in: app).waitForExistence(timeout: 10))
        XCTAssertFalse(app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH[c] %@", "Answer on the web")
        ).firstMatch.exists)
        shot("02-sample-inbox-\(suffix)")

        let expired = app.staticTexts["EXPIRED"].firstMatch
        reveal(expired, in: app, maxSwipes: 16)
        assertSampleNoticeIsVisible(in: app)
        shot("03-sample-expired-\(suffix)")
        app.navigationBars.buttons.firstMatch.tap()
        tap("relay.sample-harbors", in: app)
        assertSampleNoticeIsVisible(in: app)
        shot("04-sample-harbors-\(suffix)")

        tap("relay.harbor.stale", in: app)
        let reading = element("relay.reachability-reading", in: app)
        for _ in 0..<8 where !isVisible(reading, in: app) { app.swipeUp() }
        XCTAssertTrue(isVisible(reading, in: app), "The stale reading must be on screen")
        XCTAssertTrue(reading.label.contains("Stale"), "The detail must expose the stale reading")
        assertSampleNoticeIsVisible(in: app)
        shot("05-sample-stale-\(suffix)")
    }

    private func element(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func tap(_ id: String, in app: XCUIApplication) {
        let target = element(id, in: app)
        reveal(target, in: app)
        target.tap()
    }

    private func assertSampleNoticeIsVisible(in app: XCUIApplication, line: UInt = #line) {
        let notice = element("relay.sample-notice", in: app)
        XCTAssertTrue(notice.waitForExistence(timeout: 10), "Missing sample label", line: line)
        XCTAssertTrue(isVisible(notice, in: app), "Sample label is outside the viewport", line: line)
        XCTAssertTrue(notice.label.contains("not your account"), "Wrong sample provenance label", line: line)
    }

    private func isVisible(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
        element.exists && !element.frame.isEmpty && app.frame.contains(element.frame)
    }

    private func reveal(_ target: XCUIElement, in app: XCUIApplication, maxSwipes: Int = 8) {
        for _ in 0..<maxSwipes where !target.isHittable { app.swipeUp() }
        XCTAssertTrue(target.isHittable, "Expected reachability at current text size: \(target)")
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
