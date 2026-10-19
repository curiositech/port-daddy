import XCTest

/// Boots the real PortDaddy app in a simulator and captures one screenshot per
/// root tab. This is the automated visual-evidence mechanism for apps/pd-ios:
/// the SwiftPM CI gate only proves PortDaddyKit compiles/tests, and never
/// renders the UI. This UI test drives the actual `@main` app through all four
/// RootTab cases (Roadmap / Harbors / Asks / Controls), attaching a named,
/// `.keepAlways` screenshot for each so `xcresulttool export attachments` can
/// pull them out of the result bundle after the run.
///
/// No network, no pairing, no auth: RootView is fixture-backed by default, so a
/// cold launch renders meaningful content deterministically.
final class ScreenshotTests: XCTestCase {

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testCaptureEveryRootTab() throws {
        let app = XCUIApplication()
        app.launch()

        // The intent-first RootTab titles, in RootView order. Harbors moved to
        // the Roadmap toolbar and Controls fold into each agent's detail.
        let tabs = ["Roadmap", "Agents", "Artifacts", "Ideas", "Asks"]

        let tabBar = app.tabBars.firstMatch
        XCTAssertTrue(
            tabBar.waitForExistence(timeout: 30),
            "Root tab bar should appear on a cold, fixture-backed launch"
        )

        for (index, title) in tabs.enumerated() {
            let button = tabBar.buttons[title]
            XCTAssertTrue(
                button.waitForExistence(timeout: 10),
                "Tab '\(title)' should exist in the tab bar"
            )
            button.tap()

            // Let the destination view render and any badge/animation settle.
            Thread.sleep(forTimeInterval: 1.2)

            let screenshot = XCUIScreen.main.screenshot()
            let attachment = XCTAttachment(screenshot: screenshot)
            attachment.name = String(format: "%02d-%@", index + 1, title.lowercased())
            attachment.lifetime = .keepAlways
            add(attachment)
        }

        // Drill into the first durable agent to capture the transcript-tail
        // detail. This is the surface the operator most asked for: follow a
        // durable agent, read its transcript.
        tabBar.buttons["Agents"].tap()
        let firstAgent = app.buttons["agent-row-0"]
        if firstAgent.waitForExistence(timeout: 10) {
            firstAgent.tap()
            Thread.sleep(forTimeInterval: 1.2)
            let detail = XCUIScreen.main.screenshot()
            let attachment = XCTAttachment(screenshot: detail)
            attachment.name = "06-agent-detail"
            attachment.lifetime = .keepAlways
            add(attachment)
        } else {
            XCTFail("agent-row-0 should exist on the Agents tab")
        }
    }
}
