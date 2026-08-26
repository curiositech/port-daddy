// ScreenshotTests.swift – updated to use explicit UI waiting instead of fixed sleep
import XCTest

final class ScreenshotTests: XCTestCase {
    let app = XCUIApplication()

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        app.launch()
    }

    func testCaptureAllTabs() {
        // Define the tab identifiers (assumes accessibility identifiers are set)
        let tabs = [
            "homeTab",
            "searchTab",
            "notificationsTab",
            "profileTab"
        ]

        for (index, identifier) in tabs.enumerated() {
            let tabButton = app.buttons[identifier]
            // Wait for the tab button to become hittable before tapping
            XCTAssertTrue(tabButton.waitForExistence(timeout: 5), "Tab button \(identifier) not found")
            tabButton.tap()

            // Wait for the main view of the tab to appear – replace "mainView" with a stable element identifier per tab
            let mainView = app.otherElements["mainView_\(identifier)"]
            XCTAssertTrue(mainView.waitForExistence(timeout: 5), "Main view for \(identifier) did not appear")

            // Capture screenshot after UI stabilises
            let screenshot = XCUIScreen.main.screenshot()
            let attachment = XCTAttachment(screenshot: screenshot)
            attachment.name = "Tab_\(index)"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }
}
