import XCTest
import SwiftUI
import ViewInspector
@testable import FleetBar

@MainActor
final class FleetPopoverTests: XCTestCase {
    func testNativeControlSurfacesMatchWebControlPlaneTabs() {
        XCTAssertEqual(
            FleetControlSurface.allCases.map(\.rawValue),
            [
                "operator",
                "flow",
                "cloudfleet",
                "backend",
                "roadmap",
                "proposals",
                "nightshift",
                "agents",
                "visual",
                "resources",
                "activity",
                "channels",
                "inbox",
                "sorties",
                "memory",
                "shipwright",
                "yaml",
                "galaxy",
            ]
        )
        XCTAssertEqual(
            FleetControlSurface.allCases.map(\.title),
            [
                "Operator",
                "Flow",
                "Cloud Fleet",
                "Backend",
                "Roadmap",
                "Proposals",
                "Nightshift",
                "Agents",
                "Visual Task",
                "Resources",
                "Activity",
                "Channels",
                "Inbox",
                "Sorties",
                "Memory",
                "Shipwright",
                "YAML",
                "Galaxy",
            ]
        )
    }

    /// Native surfaces render via SwiftUI inside FleetBar; web surfaces are
    /// loaded through the embedded `/fleet-ui/` webview. Cloud Fleet, Backend,
    /// Proposals, Nightshift, and Galaxy are fully native — the loop must work
    /// even when the web bundle is stale or offline. Everything else is web. Pinning the exact
    /// native set catches an accidental opt-in (or opt-out) when surfaces are
    /// added.
    func testNativeSurfacesAreCloudFleetBackendNightshiftProposalsAndGalaxy() {
        let nativeRaws = FleetControlSurface.allCases.filter(\.isNative).map(\.rawValue)
        XCTAssertEqual(nativeRaws, ["cloudfleet", "backend", "proposals", "nightshift", "galaxy"])

        let nativeSet: Set<FleetControlSurface> = [.cloudfleet, .backend, .proposals, .nightshift, .galaxy]
        for surface in FleetControlSurface.allCases where !nativeSet.contains(surface) {
            XCTAssertFalse(surface.isNative, "Expected \(surface.rawValue) to be a web surface")
        }
    }

    func testConsoleLauncherSectionExposesVisualTaskAction() throws {
        var openedControlCenter = false
        var openedCloudFleet = false
        var openedVisualTask = false

        let section = ConsoleLauncherSection(
            berths: [],
            activeDaemonURL: nil,
            openControlCenter: { openedControlCenter = true },
            openCloudFleet: { openedCloudFleet = true },
            openVisualTask: { openedVisualTask = true }
        )

        let inspected = try section.inspect()
        XCTAssertNoThrow(try inspected.find(button: "Fleet Control Center"))
        let cloudFleetButton = try inspected.find(button: "Cloud Fleet")
        try cloudFleetButton.tap()
        XCTAssertTrue(openedCloudFleet, "Cloud Fleet should open its own native control surface")
        XCTAssertFalse(openedControlCenter, "Tapping Cloud Fleet should not fall through to the default Flow route")

        let visualButton = try inspected.find(button: "Send Visual Task")
        try visualButton.tap()

        XCTAssertTrue(openedVisualTask, "Visual Task should route through the native FleetBar tools section")
        XCTAssertFalse(openedControlCenter, "Tapping Visual Task should not open the default Flow route")
    }

    func testPopoverScrollContentContainsNativeCloudFleetSurface() throws {
        let store = FleetStore(autoStart: false)
        store.rebind(to: "https://active-berth.example")
        store.isDaemonRunning = true
        store.projects = []

        let inspected = try FleetPopover(
            store: store,
            costStore: CostStore(autoStart: false),
            backendStore: BackendStore(autoStart: false)
        ).inspect()

        let cloudFleetTitle = try inspected.find(text: "Cloud Fleet")
        let cloudFleetPath = String(describing: cloudFleetTitle.pathToRoot)
        XCTAssertTrue(cloudFleetPath.contains("scrollView"), cloudFleetPath)
        XCTAssertNoThrow(try inspected.find(text: "https://active-berth.example"))
        XCTAssertNoThrow(try inspected.find(text: "writes require approval"))
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

        let inspected = try FleetPopover(
            store: store,
            costStore: costStore,
            backendStore: BackendStore(autoStart: false)
        ).inspect()

        let quitButton = try inspected.find(button: "Quit")
        let quitPath = String(describing: quitButton.pathToRoot)
        XCTAssertFalse(quitPath.contains("ScrollView"), quitPath)
    }

    func testHeaderExposesVisualTaskOutsideScrollView() throws {
        let store = FleetStore(autoStart: false)
        store.isDaemonRunning = true
        store.projects = []

        let inspected = try FleetPopover(
            store: store,
            costStore: CostStore(autoStart: false),
            backendStore: BackendStore(autoStart: false)
        ).inspect()

        let visualTaskButton = try inspected.find(button: "Visual Task")
        let visualTaskPath = String(describing: visualTaskButton.pathToRoot)
        XCTAssertFalse(visualTaskPath.contains("ScrollView"), visualTaskPath)
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

        let inspected = try FleetPopover(
            store: store,
            costStore: costStore,
            backendStore: BackendStore(autoStart: false)
        ).inspect()

        let costLabel = try inspected.find(text: "billing-demo")
        let costPath = String(describing: costLabel.pathToRoot)
        XCTAssertTrue(costPath.contains("scrollView"), costPath)

        let scrollView = try inspected.find(ViewType.ScrollView.self)
        XCTAssertNotNil(scrollView)
    }

    /// Verifies long Heartbeat diagnostics stay readable in the Daemon Report.
    ///
    /// Sample input:
    /// `daemon heartbeat is publishing runtime evidence`
    ///
    /// Sample output:
    /// The Heartbeat status text has no single-line limit, so SwiftUI can wrap it.
    func testDaemonReportHeartbeatDiagnosticCanWrap() throws {
        let heartbeatReason = "daemon heartbeat is publishing runtime evidence"
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
                installDir: "/opt/homebrew/opt/port-daddy",
                nodeVersion: "v24.0.0"
            ),
            metrics: nil,
            runtime: DaemonRuntimeResponse(state: "nominal", degraded: false),
            guardians: DaemonGuardiansResponse(
                supervisor: nil,
                runtime: DaemonRuntimeWitnessResponse(
                    enabled: true,
                    state: "idle",
                    reason: heartbeatReason,
                    monitoredUrl: monitoredURL,
                    lastCheckAt: nil,
                    lastHealthyAt: nil,
                    lastFailureAt: nil,
                    failureCount: 0
                )
            ),
            history: DaemonHistoryResponse(
                lastActivityAt: nil,
                recentActivity: [],
                recentSpend: []
            )
        )

        let inspected = try FleetPopover(
            store: store,
            costStore: CostStore(autoStart: false),
            backendStore: BackendStore(autoStart: false)
        ).inspect()

        let heartbeatStatus = try inspected.find(text: heartbeatReason)
        XCTAssertNil(try heartbeatStatus.lineLimit())
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

    /// A CRITICAL daemon severity is the dominant menu-bar signal: the icon
    /// becomes an alarm triangle in the failure color, even with a healthy fleet.
    func testCriticalDaemonHealthRaisesAlarmIconAndTone() {
        let store = FleetStore(autoStart: false)
        store.isDaemonRunning = true
        store.projects = [project(agents: [agent(name: "cartographer", status: .running)])]
        store.daemonStatus = makeDaemonStatus(severity: "critical", runtimeState: "degraded", degraded: true)

        XCTAssertEqual(store.daemonSeverity, .critical)
        XCTAssertEqual(store.menuBarIcon, "exclamationmark.triangle.fill")
        XCTAssertEqual(store.menuBarTone, .critical)
    }

    /// A WARN daemon severity degrades the menu bar to the warning triangle/tone
    /// but stops short of the critical alarm.
    func testWarnDaemonHealthShowsWarningTriangle() {
        let store = FleetStore(autoStart: false)
        store.isDaemonRunning = true
        store.projects = [project(agents: [agent(name: "cartographer", status: .running)])]
        store.daemonStatus = makeDaemonStatus(severity: "warn", runtimeState: "degraded", degraded: true)

        XCTAssertEqual(store.daemonSeverity, .warn)
        XCTAssertEqual(store.menuBarIcon, "exclamationmark.triangle")
        XCTAssertEqual(store.menuBarTone, .warning)
    }

    /// An older daemon that omits `severity` still degrades via runtime.degraded.
    func testDaemonSeverityDerivesFromRuntimeWhenFieldAbsent() {
        let store = FleetStore(autoStart: false)
        store.isDaemonRunning = true
        store.projects = []
        store.daemonStatus = makeDaemonStatus(severity: nil, runtimeState: "degraded", degraded: true)

        XCTAssertEqual(store.daemonSeverity, .warn)
    }

    private func makeDaemonStatus(severity: String?, runtimeState: String, degraded: Bool) -> DaemonStatusResponse {
        DaemonStatusResponse(
            status: degraded ? "degraded" : "running",
            version: "3.22.0",
            pid: 4242,
            uptimeSeconds: 12,
            uptimeHuman: "12 sec",
            daemon: nil,
            metrics: nil,
            runtime: DaemonRuntimeResponse(state: runtimeState, degraded: degraded),
            guardians: nil,
            history: nil,
            severity: severity
        )
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

    /// Regression test for the "Start fleet" affordance bug.
    /// The old layout used `.borderless` + `.caption2` for remediation
    /// buttons, which made them look like static text and disappear next
    /// to the SF Symbol "Open console" button. This test pins that:
    ///   - the remediation button renders both an SF Symbol and the title,
    ///   - the action handler fires when the button is tapped,
    ///   - the help string surfaces the remediation detail for VoiceOver
    ///     and hover-tooltip discovery.
    func testRemediationButtonRendersIconLabelAndFiresAction() throws {
        let remediation = ProjectRemediation(
            action: "start_fleet",
            title: "Start fleet",
            detail: "Starts this pd-fleet.yml on the current daemon.",
            command: nil,
            suggestedBudgetUsdPerDay: nil
        )
        var fired = false
        let row = ProjectReadinessRow(
            project: projectWithRemediation(remediation),
            onOpenProject: {},
            onOpenVisualTask: {},
            onRemediateProject: { fired = true }
        )

        let inspected = try row.inspect()

        // Title and icon must both appear — the icon is what tells the user
        // this is a button at a glance, not a static label.
        XCTAssertNoThrow(try inspected.find(text: "Start fleet"))
        XCTAssertNoThrow(try inspected.find(ViewType.Image.self, where: { image in
            (try? image.actualImage().name() == "play.fill") ?? false
        }))

        let button = try inspected.find(button: "Start fleet")
        try button.tap()
        XCTAssertTrue(fired, "Remediation button must invoke onRemediateProject when tapped")
    }

    func testRemediationButtonIconMapsActionToVerb() throws {
        // The icon picker is private to ProjectReadinessRow but the user-
        // visible contract is "the glyph reinforces the verb". Spot-check a
        // few of the mappings via rendered output so a refactor that breaks
        // the picker is caught.
        let mappings: [(action: String, glyph: String, title: String)] = [
            ("start_fleet",  "play.fill",          "Start fleet"),
            ("set_budget",   "dollarsign.circle",  "Set $5/day budget"),
            ("fix_yaml",     "wrench.adjustable",  "Fix YAML"),
            ("create_fleet", "plus.circle",        "Create starter fleet"),
            ("run_scan",     "magnifyingglass",    "Scan project"),
        ]
        for mapping in mappings {
            let remediation = ProjectRemediation(
                action: mapping.action,
                title: mapping.title,
                detail: "",
                command: nil,
                suggestedBudgetUsdPerDay: nil
            )
            let row = ProjectReadinessRow(
                project: projectWithRemediation(remediation),
                onOpenProject: {},
                onOpenVisualTask: {},
                onRemediateProject: {}
            )
            let inspected = try row.inspect()
            XCTAssertNoThrow(
                try inspected.find(ViewType.Image.self, where: { image in
                    (try? image.actualImage().name() == mapping.glyph) ?? false
                }),
                "Expected SF Symbol \(mapping.glyph) for action \(mapping.action)"
            )
        }
    }

    private func projectWithRemediation(_ remediation: ProjectRemediation) -> FleetProject {
        var p = project(agents: [])
        p.operatorState = .ready
        p.operatorSummary = "8 agents configured and budgeted; fleet is stopped."
        p.operatorNextAction = "Start this fleet on the current daemon."
        p.remediation = remediation
        return p
    }

    private func project(agents: [FleetAgent]) -> FleetProject {
        FleetProject(
            id: "/tmp/port-daddy-test",
            name: "port-daddy-test",
            projectDir: "/tmp/port-daddy-test",
            worktree: nil,
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
