import XCTest
import Foundation
import SwiftUI
import ViewInspector
@testable import FleetBar

@MainActor
final class FleetPopoverTests: XCTestCase {
    func testNativeControlSurfacesMatchWebControlPlaneTabs() {
        XCTAssertEqual(
            FleetControlSurface.allCases.map(\.rawValue),
            [
                "flow",
                "roadmap",
                "agents",
                "resources",
                "activity",
                "channels",
                "inbox",
                "sorties",
                "memory",
                "shipwright",
                "yaml",
            ]
        )
        XCTAssertEqual(
            FleetControlSurface.allCases.map(\.title),
            [
                "Flow",
                "Roadmap",
                "Agents",
                "Resources",
                "Activity",
                "Channels",
                "Inbox",
                "Sorties",
                "Memory",
                "Shipwright",
                "YAML",
            ]
        )
    }

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

    /// Verifies long Bosun diagnostics stay readable in the Daemon Report.
    ///
    /// Sample input:
    /// `daemon heartbeat writer active; pd-bosun supervisor binary available`
    ///
    /// Sample output:
    /// The Bosun status text has no single-line limit, so SwiftUI can wrap it.
    func testDaemonReportBosunDiagnosticCanWrap() throws {
        let bosunReason = "daemon heartbeat writer active; pd-bosun supervisor binary available"
        let monitoredURL = try XCTUnwrap(URL(string: DaemonLocation.resolveBaseURL()))
            .appendingPathComponent("status")
            .absoluteString
        let store = FleetStore(autoStart: false)
        store.isDaemonRunning = true
        store.projects = []
        store.daemonStatus = DaemonStatusResponse(
            status: "running",
            version: "3.11.0",
            pid: 61830,
            uptimeSeconds: 38,
            uptimeHuman: "38 sec",
            daemon: DaemonBuildResponse(
                version: "3.11.0",
                codeHash: "e11c6ea29427",
                startedAt: 1_777_328_400_000,
                installDir: "/Users/erichowens/port-daddy-stable",
                nodeVersion: "v24.0.0"
            ),
            metrics: nil,
            runtime: DaemonRuntimeResponse(state: "nominal", degraded: false),
            guardians: DaemonGuardiansResponse(
                supervisor: nil,
                bosun: DaemonBarnacleResponse(
                    enabled: true,
                    state: "idle",
                    reason: bosunReason,
                    monitoredUrl: monitoredURL,
                    binaryExists: true,
                    lastCheckAt: nil,
                    lastHealthyAt: nil,
                    lastFailureAt: nil,
                    lastResurrectedAt: nil,
                    failureCount: 0
                ),
                barnacle: nil
            ),
            history: DaemonHistoryResponse(
                lastActivityAt: nil,
                recentActivity: [],
                recentSpend: []
            )
        )

        let inspected = try FleetPopover(store: store, costStore: CostStore(autoStart: false)).inspect()

        let bosunStatus = try inspected.find(text: bosunReason)
        XCTAssertNil(try bosunStatus.lineLimit())
    }

    func testMenuBarFailurePreservesBoatGlyphAndWarnsByColor() {
        let store = FleetStore(autoStart: false)
        store.isDaemonRunning = true
        store.projects = [
            project(agents: [
                agent(name: "cartographer", status: .running),
                agent(name: "test-hunter", status: .failed),
            ]),
        ]

        XCTAssertEqual(store.menuBarIcon, "sailboat.fill")
        XCTAssertEqual(store.menuBarTone, .warning)
    }

    func testMenuBarFailedIdleFleetStillPreservesBoatGlyph() {
        let store = FleetStore(autoStart: false)
        store.isDaemonRunning = true
        store.projects = [
            project(agents: [
                agent(name: "test-hunter", status: .failed),
            ]),
        ]

        XCTAssertEqual(store.menuBarIcon, "sailboat")
        XCTAssertEqual(store.menuBarTone, .warning)
    }

    func testProjectMenuGroupsCollapseSiblingWorktrees() {
        let groupId = "/repo/port-daddy/.git"
        let primary = project(
            id: "/repo/port-daddy",
            name: "port-daddy",
            agents: [],
            worktree: ProjectWorktreeInfo(
                isGitWorktree: true,
                isLinkedWorktree: false,
                groupId: groupId,
                groupName: "port-daddy",
                mainWorktreeRoot: "/repo/port-daddy",
                worktreeName: "port-daddy",
                branch: "main",
                head: nil
            )
        )
        let feature = project(
            id: "/repo/port-daddy-feature",
            name: "port-daddy-feature",
            agents: [],
            worktree: ProjectWorktreeInfo(
                isGitWorktree: true,
                isLinkedWorktree: true,
                groupId: groupId,
                groupName: "port-daddy",
                mainWorktreeRoot: "/repo/port-daddy",
                worktreeName: "port-daddy-feature",
                branch: "codex/worktree-picker",
                head: nil
            )
        )
        let other = project(id: "/repo/workgroup-ai", name: "workgroup-ai", agents: [])

        let groups = makeProjectMenuGroups([feature, other, primary])
        let worktreeGroup = groups.first { $0.id == "worktree:\(groupId)" }

        XCTAssertEqual(groups.filter(\.isWorktreeGroup).count, 1)
        XCTAssertEqual(worktreeGroup?.label, "port-daddy worktrees")
        XCTAssertEqual(worktreeGroup?.detail, "2 checkouts")
        XCTAssertEqual(worktreeGroup?.projects.map(\.id), [primary.id, feature.id])
        XCTAssertTrue(groups.contains { $0.id == "project:/repo/workgroup-ai" })
    }

    func testNativeWorktreeDetectorReadsGitFileAndCommonDir() throws {
        let workspace = FileManager.default.temporaryDirectory
            .appendingPathComponent("FleetBarWorktree-\(UUID().uuidString)", isDirectory: true)
        let primary = workspace.appendingPathComponent("port-daddy", isDirectory: true)
        let linked = workspace.appendingPathComponent("port-daddy-feature", isDirectory: true)
        let primaryGit = primary.appendingPathComponent(".git", isDirectory: true)
        let linkedGit = primaryGit
            .appendingPathComponent("worktrees", isDirectory: true)
            .appendingPathComponent("port-daddy-feature", isDirectory: true)
        defer {
            try? FileManager.default.removeItem(at: workspace)
        }

        try FileManager.default.createDirectory(at: primaryGit, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: linkedGit, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: linked, withIntermediateDirectories: true)
        try "ref: refs/heads/main\n".write(to: primaryGit.appendingPathComponent("HEAD"), atomically: true, encoding: .utf8)
        try "../..\n".write(to: linkedGit.appendingPathComponent("commondir"), atomically: true, encoding: .utf8)
        try "ref: refs/heads/codex/worktree-picker\n".write(to: linkedGit.appendingPathComponent("HEAD"), atomically: true, encoding: .utf8)
        try "gitdir: \(linkedGit.path)\n".write(to: linked.appendingPathComponent(".git"), atomically: true, encoding: .utf8)

        let primaryInfo = try XCTUnwrap(detectLocalWorktreeInfo(projectDir: primary.path))
        let linkedInfo = try XCTUnwrap(detectLocalWorktreeInfo(projectDir: linked.path))

        XCTAssertFalse(primaryInfo.isLinkedWorktree)
        XCTAssertEqual(primaryInfo.groupId, primaryGit.path)
        XCTAssertEqual(primaryInfo.branch, "main")
        XCTAssertTrue(linkedInfo.isLinkedWorktree)
        XCTAssertEqual(linkedInfo.groupId, primaryInfo.groupId)
        XCTAssertEqual(linkedInfo.groupName, "port-daddy")
        XCTAssertEqual(linkedInfo.worktreeName, "port-daddy-feature")
        XCTAssertEqual(linkedInfo.branch, "codex/worktree-picker")
    }

    func testAgentRowShowsCodexTelemetryRecoveryHint() throws {
        let reason = "Failed: Exact telemetry required, but codex did not return token counts."
        let row = AgentRow(
            agent: agent(name: "test-hunter", status: .failed, statusReason: reason),
            onInspect: {},
            onRunAgent: {},
            onPauseToggle: {},
            onOpenInEditor: { _ in },
            onRevealInFinder: { _ in }
        )

        let inspected = try row.inspect()
        let statusReason = try inspected.find(text: reason)
        XCTAssertNil(try statusReason.lineLimit())
        XCTAssertNoThrow(try inspected.find(text: "Next: run `codex exec --json \"print ok\"`; if usage appears, run this agent again. If usage is missing, fix Codex auth/CLI."))
    }

    func testAgentRowShowsSpawnQuotaRecoveryHint() throws {
        let reason = "Failed: quota: hourly spawn limit (10/hr) reached"
        let row = AgentRow(
            agent: agent(name: "test-hunter", status: .failed, statusReason: reason),
            onInspect: {},
            onRunAgent: {},
            onPauseToggle: {},
            onOpenInEditor: { _ in },
            onRevealInFinder: { _ in }
        )

        let inspected = try row.inspect()
        XCTAssertNoThrow(try inspected.find(text: "Next: wait for the hourly spawn window to clear, then run this agent again."))
    }

    func testAgentRowShowsOneSentencePurpose() throws {
        let purpose = "Run the test suite and write meaningful tests for uncovered paths."
        let row = AgentRow(
            agent: agent(name: "test-hunter", status: .armed, purpose: purpose),
            onInspect: {},
            onRunAgent: {},
            onPauseToggle: {},
            onOpenInEditor: { _ in },
            onRevealInFinder: { _ in }
        )

        let inspected = try row.inspect()
        XCTAssertNoThrow(try inspected.find(text: purpose))
    }

    private func project(
        id: String = "/tmp/port-daddy-test",
        name: String = "port-daddy-test",
        agents: [FleetAgent],
        worktree: ProjectWorktreeInfo? = nil
    ) -> FleetProject {
        FleetProject(
            id: id,
            name: name,
            projectDir: id,
            worktree: worktree,
            agents: agents
        )
    }

    private func agent(
        name: String,
        status: FleetAgent.AgentStatus,
        purpose: String? = nil,
        statusReason: String? = nil
    ) -> FleetAgent {
        FleetAgent(
            id: "port-daddy-test:fleet:\(name)",
            name: name,
            type: .triggered,
            isConfiguredFleetAgent: true,
            inboxTarget: nil,
            purpose: purpose,
            status: status,
            statusReason: statusReason,
            queueDepth: 0,
            lastActivity: nil,
            lastEvent: nil,
            lastSummary: nil,
            recentFiles: []
        )
    }
}
