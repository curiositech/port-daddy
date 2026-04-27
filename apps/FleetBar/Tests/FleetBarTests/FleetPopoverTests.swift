import XCTest
import SwiftUI
import ViewInspector
@testable import FleetBar

@MainActor
final class FleetPopoverTests: XCTestCase {
    func testFooterControlsStayOutsideScrollView() throws {
        let store = FleetStore(autoStart: false)
        store.isDaemonRunning = true
        store.projects = []

        let costStore = CostStore(autoStart: false)
        costStore.liveProjects = [
            ProjectCostStatus(
                projectName: "billing-demo",
                projectDir: "/tmp/billing-demo",
                category: .liveFleet,
                totalUsd: 12.34,
                spawnCount: 4,
                estimatedCount: 1,
                topModel: "gpt-5.4",
                budgetUsdPerDay: 50,
                remainingUsd: 37.66,
                percentUsed: 24.68,
                overBudget: false
            )
        ]

        let inspected = try FleetPopover(store: store, costStore: costStore).inspect()

        let quitButton = try inspected.find(button: "Quit")
        let quitPath = String(describing: quitButton.pathToRoot)
        XCTAssertFalse(quitPath.contains("ScrollView"), quitPath)
    }

    func testScrollContentContainsCostDashboard() throws {
        let store = FleetStore(autoStart: false)
        store.isDaemonRunning = true
        store.projects = []

        let costStore = CostStore(autoStart: false)
        costStore.liveProjects = [
            ProjectCostStatus(
                projectName: "billing-demo",
                projectDir: "/tmp/billing-demo",
                category: .liveFleet,
                totalUsd: 12.34,
                spawnCount: 4,
                estimatedCount: 1,
                topModel: "gpt-5.4",
                budgetUsdPerDay: 50,
                remainingUsd: 37.66,
                percentUsed: 24.68,
                overBudget: false
            )
        ]

        let inspected = try FleetPopover(store: store, costStore: costStore).inspect()

        let costLabel = try inspected.find(text: "billing-demo")
        let costPath = String(describing: costLabel.pathToRoot)
        XCTAssertTrue(costPath.contains("scrollView"), costPath)

        let scrollView = try inspected.find(ViewType.ScrollView.self)
        XCTAssertNotNil(scrollView)
    }
}
