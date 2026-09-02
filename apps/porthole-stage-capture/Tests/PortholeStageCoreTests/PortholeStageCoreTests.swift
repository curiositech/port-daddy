import Foundation
import XCTest
@testable import PortholeStageCore

final class PortholeStageCoreTests: XCTestCase {
    func testPickerGeometryKeepsHitTestingInPointsAndBackingScaleInPixels() {
        let sample = PickerHitTestGeometry(
            windowOriginInScreenPoints: PortholePoint(x: 120, y: 240),
            windowSizeInPoints: PortholeSize(width: 736, height: 488),
            contentLayoutOriginInWindowPoints: PortholePoint(x: 0, y: 0),
            contentLayoutSizeInPoints: PortholeSize(width: 720, height: 460),
            mouseLocationInWindowPoints: PortholePoint(x: 360, y: 230),
            backingScaleFactor: 2
        )

        XCTAssertEqual(sample.mouseLocationInScreenPoints, PortholePoint(x: 480, y: 470))
        XCTAssertEqual(sample.mouseLocationInBackingPixels, PortholePoint(x: 960, y: 940))
        XCTAssertEqual(
            sample.windowPoint(fromScreenPoint: sample.mouseLocationInScreenPoints),
            sample.mouseLocationInWindowPoints
        )
    }

    func testExactWindowStreamIncludesFilterBoundPointerButNoClickHalosOrUnscopedGhosts() {
        let policy = ExactWindowStreamPolicy.standard
        XCTAssertTrue(policy.includesPhysicalCursorPixels)
        XCTAssertFalse(policy.includesMouseClickIndicators)

        let cursorStore = CursorStore()
        XCTAssertTrue(cursorStore.visible.isEmpty)
        let scoped = cursor(id: "agent", kind: .agent, x: 0.5, sequence: 1, clock: 10)
        XCTAssertFalse(CursorLeasePolicy.permits(scoped, activeLeaseID: nil))
        XCTAssertFalse(CursorLeasePolicy.permits(scoped, activeLeaseID: "another-lease"))
        XCTAssertTrue(CursorLeasePolicy.permits(scoped, activeLeaseID: "lease-a"))
    }

    func testSafeFixtureUsesStandardUntransformedAppKitWindowContract() {
        let contract = SafeFixtureWindowContract.standard
        XCTAssertEqual(contract.contentSizeInPoints, PortholeSize(width: 720, height: 460))
        XCTAssertFalse(contract.usesFullSizeContentView)
        XCTAssertTrue(contract.usesIdentityContentTransform)
        XCTAssertFalse(contract.isResizable)
    }

    func testPickerSelectedSourceValidatorRejectsOwnExcludedBackgroundAndTinySources() {
        let policy = PickerSelectedSourcePolicy(currentProcessID: 42)
        let allowed = descriptor(id: 1, pid: 91, bundle: "com.example.rust-app", title: "Canvas")
        let own = descriptor(id: 2, pid: 42, bundle: nil, title: "Porthole Stage")
        let console = descriptor(id: 3, pid: 92, bundle: "dev.portdaddy.console.debug", title: "Console")
        let background = descriptor(id: 4, pid: 93, bundle: "com.example.app", title: "HUD", layer: 8)
        let offscreen = descriptor(id: 5, pid: 94, bundle: "com.example.app", title: "Hidden", onScreen: false)
        let tiny = descriptor(id: 6, pid: 95, bundle: "com.example.app", title: "Popover", width: 90, height: 70)

        XCTAssertTrue(policy.accepts(allowed))
        XCTAssertFalse(policy.accepts(own))
        XCTAssertFalse(policy.accepts(console))
        XCTAssertFalse(policy.accepts(background))
        XCTAssertFalse(policy.accepts(offscreen))
        XCTAssertFalse(policy.accepts(tiny))
    }

    func testFrameRingIsBoundedAndRejectsNonMonotonicMetadata() throws {
        var ring = try MonotonicFrameRing<String>(capacity: 3)
        try ring.append(sequence: 1, monotonicNanos: 10, value: "one")
        try ring.append(sequence: 2, monotonicNanos: 20, value: "two")
        try ring.append(sequence: 3, monotonicNanos: 30, value: "three")
        let evicted = try ring.append(sequence: 4, monotonicNanos: 40, value: "four")

        XCTAssertEqual(evicted?.value, "one")
        XCTAssertEqual(ring.entries.map(\.value), ["two", "three", "four"])
        XCTAssertThrowsError(try ring.append(sequence: 4, monotonicNanos: 50, value: "stale")) {
            XCTAssertEqual($0 as? FrameRingError, .nonMonotonicSequence(previous: 4, incoming: 4))
        }
        XCTAssertThrowsError(try ring.append(sequence: 5, monotonicNanos: 40, value: "clock")) {
            XCTAssertEqual($0 as? FrameRingError, .nonMonotonicClock(previous: 40, incoming: 40))
        }
    }

    func testCursorStoreValidatesTypedLocalEventsAndDropsStaleUpdates() throws {
        var store = CursorStore()
        let human = cursor(id: "person", kind: .human, x: 0.2, sequence: 1, clock: 100)
        let agent = cursor(id: "agent", kind: .agent, x: 0.8, sequence: 1, clock: 101)
        try store.ingest(agent)
        try store.ingest(human)
        XCTAssertEqual(store.visible.map(\.participantID), ["person", "agent"])

        XCTAssertThrowsError(try store.ingest(human)) {
            XCTAssertEqual($0 as? CursorIngestError, .staleSequence)
        }
        XCTAssertThrowsError(try store.ingest(cursor(id: "bad", kind: .agent, x: 1.2, sequence: 1, clock: 1))) {
            XCTAssertEqual($0 as? CursorIngestError, .coordinateOutOfRange)
        }
        store.removeAll()
        XCTAssertTrue(store.visible.isEmpty)
    }

    func testApprovalLedgerStartsEmptyAndProjectsOnlyApprovedSources() throws {
        var ledger = SourceApprovalLedger()
        XCTAssertTrue(ledger.approvedSources.isEmpty, "normal Stage starts with zero source cards")

        let approved = approval(scope: .exactWindow, capabilities: .previewOnly)
        try ledger.approve(approved)
        XCTAssertEqual(ledger.approvedSources, [approved])
        XCTAssertEqual(ledger.approvedSources.map(\.displayTitle), ["Fixture · Porthole Safe Fixture"])

        XCTAssertEqual(ledger.revoke(approvalID: approved.approvalID), approved)
        XCTAssertTrue(ledger.approvedSources.isEmpty)
    }

    func testApprovalCapabilitiesAreIndependentAndApprovalCannotStartCapture() throws {
        let shareOnly = approval(
            scope: .exactWindow,
            capabilities: SourceCapabilities(preview: false, liveShare: true, persistRecording: false)
        )
        try SourceApprovalPolicy.validate(shareOnly)
        XCTAssertFalse(SourceApprovalPolicy.permits(.preview, approval: shareOnly))
        XCTAssertTrue(SourceApprovalPolicy.permits(.liveShare, approval: shareOnly))
        XCTAssertFalse(SourceApprovalPolicy.permits(.persistRecording, approval: shareOnly))

        var machine = CaptureStateMachine(state: .ready)
        var ledger = SourceApprovalLedger()
        try ledger.approve(shareOnly)
        XCTAssertEqual(machine.state, .ready, "approval mutates policy only, never capture lifecycle")
        XCTAssertThrowsError(try machine.transition(to: .paused))
    }

    func testInstanceAndWindowApprovalsExpireOnLaunchOrWindowDrift() {
        let exact = approval(scope: .exactWindow, capabilities: .previewOnly)
        let instance = approval(scope: .runningInstance, capabilities: .previewOnly)
        let observation = SourceRuntimeObservation(
            program: exact.program,
            processID: 41,
            launchIdentity: "launch-a",
            openWindowIDs: [77]
        )
        XCTAssertTrue(SourceApprovalValidity.remainsValid(exact, observation: observation))
        XCTAssertTrue(SourceApprovalValidity.remainsValid(instance, observation: observation))

        let reusedPID = SourceRuntimeObservation(
            program: exact.program,
            processID: 41,
            launchIdentity: "launch-b",
            openWindowIDs: [77]
        )
        XCTAssertFalse(SourceApprovalValidity.remainsValid(exact, observation: reusedPID))
        XCTAssertFalse(SourceApprovalValidity.remainsValid(instance, observation: reusedPID))

        let closed = SourceRuntimeObservation(
            program: exact.program,
            processID: 41,
            launchIdentity: "launch-a",
            openWindowIDs: []
        )
        XCTAssertFalse(SourceApprovalValidity.remainsValid(exact, observation: closed))
        XCTAssertTrue(SourceApprovalValidity.remainsValid(instance, observation: closed))
    }

    func testCaptureLeaseRejectsStaleSourceRelabeling() {
        let runtime = testRuntime()
        let lease = CaptureLeaseIdentity(
            leaseID: "lease-a",
            approvalID: "approval-a",
            displayTitle: "Fixture · Porthole Safe Fixture",
            sourceKind: .window,
            sourceWindowID: 77
        )
        XCTAssertTrue(lease.matches(frame(sequence: 1, clock: 100, runtime: runtime)))

        let stale = FrameMetadata(
            sequence: 2,
            monotonicNanos: 200,
            captureLeaseID: "lease-old",
            sourceApprovalID: "approval-old",
            sourceDisplayTitle: "Typora · _raw_response.md",
            sourceKind: .window,
            sourceWindowID: 91,
            sourceWidthPoints: 640,
            sourceHeightPoints: 400,
            pixelWidth: 1280,
            pixelHeight: 800,
            contentScale: 2,
            runtime: runtime
        )
        XCTAssertFalse(lease.matches(stale))
    }

    func testDurableProgramAuthoritySurvivesAnchoredUpdateButAdHocDoesNot() {
        let anchoredV1 = program(digest: String(repeating: "a", count: 64), anchored: true)
        let anchoredV2 = program(digest: String(repeating: "b", count: 64), anchored: true)
        XCTAssertTrue(ProgramIdentityPolicy.sameApprovedAuthority(approved: anchoredV1, observed: anchoredV2))

        let adHocV1 = program(digest: String(repeating: "a", count: 64), anchored: false)
        let adHocV2 = program(digest: String(repeating: "b", count: 64), anchored: false)
        XCTAssertFalse(ProgramIdentityPolicy.sameApprovedAuthority(approved: adHocV1, observed: adHocV2))
    }

    func testCaptureApprovalDoesNotCrossRepositoryEvidenceTenancy() {
        let scope = EvidenceAccessScope(
            tenancy: .projectScoped,
            accountID: "account-1",
            teamID: "team-1",
            harborID: "harbor-1",
            repositoryID: "repo-a",
            sessionID: "session-a",
            actorID: "actor-a",
            perspectiveID: "human-pov",
            allowRead: true,
            allowShare: false,
            allowSemanticIndex: true
        )
        let repoA = evidenceRequest(repositoryID: "repo-a", capability: .read)
        let repoB = evidenceRequest(repositoryID: "repo-b", capability: .read)
        XCTAssertTrue(EvidenceAccessPolicy.permits(scope: scope, request: repoA))
        XCTAssertFalse(EvidenceAccessPolicy.permits(scope: scope, request: repoB))
        XCTAssertFalse(EvidenceAccessPolicy.permits(scope: .standaloneNoAccess, request: repoA))

        let captureApproval = approval(scope: .signedProgram, capabilities: .previewOnly)
        XCTAssertEqual(captureApproval.authorizationDomain, .deviceOperatorCaptureOnly)
        XCTAssertNil(captureApproval.runningInstance)
        XCTAssertFalse(captureApproval.displayTitle.contains("Porthole Safe Fixture"))
    }

    func testProofModeDoesNotHydrateDurableProgramApprovals() {
        XCTAssertTrue(SourceApprovalHydrationPolicy.shouldLoadDurableApprovals(
            proofOnlyExactFixtureMode: false
        ))
        XCTAssertFalse(SourceApprovalHydrationPolicy.shouldLoadDurableApprovals(
            proofOnlyExactFixtureMode: true
        ))
    }

    func testBackgroundEvidenceRequiresAdvancingExactFilterFramesWhileBothAppsInactive() {
        let runtime = testRuntime()
        var accumulator = BackgroundCaptureAccumulator()
        accumulator.observe(
            frame: frame(sequence: 1, clock: 100, runtime: runtime),
            activity: CaptureActivitySnapshot(
                captureApplicationActive: true,
                sourceApplicationActive: false,
                differentForegroundApplicationPresent: false
            )
        )
        accumulator.observe(
            frame: frame(sequence: 2, clock: 200, runtime: runtime),
            activity: CaptureActivitySnapshot(
                captureApplicationActive: false,
                sourceApplicationActive: false,
                differentForegroundApplicationPresent: true
            )
        )
        var evidence = accumulator.evidence(
            sourceWindowOnScreenAtFirstFrame: true,
            displayOrScreenFallbackUsed: false
        )
        XCTAssertEqual(evidence?.backgroundCompleteFrameCount, 1)
        XCTAssertFalse(evidence?.provesBackgroundContinuity == true)

        accumulator.observe(
            frame: frame(sequence: 3, clock: 300, runtime: runtime),
            activity: CaptureActivitySnapshot(
                captureApplicationActive: false,
                sourceApplicationActive: false,
                differentForegroundApplicationPresent: true
            )
        )
        evidence = accumulator.evidence(
            sourceWindowOnScreenAtFirstFrame: true,
            displayOrScreenFallbackUsed: false
        )
        XCTAssertEqual(evidence?.acceptedCompleteFrameCount, 3)
        XCTAssertEqual(evidence?.firstBackgroundFrameSequence, 2)
        XCTAssertEqual(evidence?.lastBackgroundFrameSequence, 3)
        XCTAssertTrue(evidence?.provesBackgroundContinuity == true)
    }

    func testCaptureSourcesContainNoDesktopCatalogOrGlobalPointerPolling() throws {
        let packageRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let sources = packageRoot.appendingPathComponent("Sources")
        let forbiddenTokens = [
            ["SC", "Shareable", "Content"].joined(),
            ["CG", "Event"].joined(),
            ["CG", "Window"].joined(),
            ["Window", "List"].joined(),
            ["running", "Applications"].joined(),
        ]
        guard let enumerator = FileManager.default.enumerator(
            at: sources,
            includingPropertiesForKeys: [.isRegularFileKey]
        ) else {
            return XCTFail("Could not enumerate package sources")
        }
        for case let fileURL as URL in enumerator where fileURL.pathExtension == "swift" {
            let source = try String(contentsOf: fileURL, encoding: .utf8)
            for forbidden in forbiddenTokens {
                XCTAssertFalse(
                    source.contains(forbidden),
                    "\(fileURL.lastPathComponent) must not use \(forbidden)"
                )
            }
        }
    }

    func testPrivacyPersistenceFailsClosedUntilClearApprovedFixture() {
        let unknown = assessment(.unknown)
        let protected = assessment(.protected)
        let clear = assessment(.clear)

        XCTAssertFalse(PrivacyPersistencePolicy.evaluate(
            assessment: unknown,
            explicitOperatorApproval: true,
            isSyntheticSafeFixture: true
        ).allowed)
        XCTAssertFalse(PrivacyPersistencePolicy.evaluate(
            assessment: protected,
            explicitOperatorApproval: true,
            isSyntheticSafeFixture: true
        ).allowed)
        XCTAssertFalse(PrivacyPersistencePolicy.evaluate(
            assessment: clear,
            explicitOperatorApproval: false,
            isSyntheticSafeFixture: true
        ).allowed)
        XCTAssertFalse(PrivacyPersistencePolicy.evaluate(
            assessment: clear,
            explicitOperatorApproval: true,
            isSyntheticSafeFixture: false
        ).allowed)
        XCTAssertTrue(PrivacyPersistencePolicy.evaluate(
            assessment: clear,
            explicitOperatorApproval: true,
            isSyntheticSafeFixture: true
        ).allowed)
    }

    func testCaptureStateMachineMakesPauseAndStopExplicit() throws {
        var machine = CaptureStateMachine()
        try machine.transition(to: .ready)
        try machine.transition(to: .live)
        try machine.transition(to: .paused)
        try machine.transition(to: .live)
        try machine.transition(to: .stopped)
        XCTAssertEqual(machine.state, .stopped)
        XCTAssertThrowsError(try machine.transition(to: .paused))
    }

    func testPersistedProofIsSingleSegmentWhileMemoryOnlyPreviewMayPause() {
        XCTAssertFalse(CapturePausePolicy.permitsPause(proofPersistenceEnabled: true))
        XCTAssertTrue(CapturePausePolicy.permitsPause(proofPersistenceEnabled: false))
    }

    func testProofManifestStatesExactWindowNoAudioAndNoPreapprovalWrite() throws {
        let runtime = testRuntime()
        let first = frame(sequence: 1, clock: 100, runtime: runtime)
        let last = frame(sequence: 2, clock: 200, runtime: runtime)
        let sourceApproval = approval(scope: .exactWindow, capabilities: SourceCapabilities(
            preview: true,
            liveShare: true,
            persistRecording: true
        ))
        let captureLease = CaptureLeaseIdentity(
            leaseID: "lease-a",
            approvalID: sourceApproval.approvalID,
            displayTitle: "Fixture · Porthole Safe Fixture",
            sourceKind: .window,
            sourceWindowID: 77
        )
        let manifest = PortholeProofManifest(
            createdAt: "2026-08-31T00:00:00Z",
            source: descriptor(id: 77, pid: 2, bundle: "dev.portdaddy.fixture", title: "Porthole Safe Fixture"),
            safeFixtureAttestation: SafeFixtureAttestation(
                processID: 2,
                exactWindowTitle: "Porthole Safe Fixture",
                applicationIdentity: "dev.portdaddy.porthole.safe-fixture:PortholeFixture:PortholeFixture",
                captureBundleIdentifier: "dev.portdaddy.porthole",
                fixtureBundleIdentifier: "dev.portdaddy.porthole.safe-fixture",
                executableFilename: "PortholeFixture",
                designatedRequirement: sourceApproval.program.designatedRequirement,
                launchIdentity: "launch-a",
                expectedExecutableSHA256: String(repeating: "a", count: 64),
                observedExecutableSHA256: String(repeating: "a", count: 64),
                verified: true
            ),
            sourceApproval: sourceApproval,
            captureLease: captureLease,
            backgroundCaptureEvidence: BackgroundCaptureEvidence(
                captureApplicationActiveAtFirstFrame: false,
                sourceApplicationActiveAtFirstFrame: false,
                differentForegroundApplicationPresentAtFirstFrame: true,
                sourceWindowOnScreenAtFirstFrame: true,
                acceptedCompleteFrameCount: 2,
                backgroundCompleteFrameCount: 2,
                firstBackgroundFrameSequence: 1,
                lastBackgroundFrameSequence: 2,
                firstBackgroundFrameMonotonicNanos: 100,
                lastBackgroundFrameMonotonicNanos: 200,
                displayOrScreenFallbackUsed: false
            ),
            evidenceAccessScope: .standaloneNoAccess,
            privacyAssessment: assessment(.clear),
            persistenceGate: PersistenceGate(allowed: true, label: "Approved", reason: "Fixture"),
            firstFrame: first,
            lastFrame: last,
            capturedFrameCount: 2,
            ringCapacity: 3,
            cursorParticipants: [],
            excludedBundlePrefixes: PickerSelectedSourcePolicy.productExcludedBundlePrefixes,
            sourceMediaFilename: "stage-source.mov"
        )

        XCTAssertTrue(manifest.exactDesktopIndependentWindow)
        XCTAssertFalse(manifest.audioCaptureEnabled)
        XCTAssertFalse(manifest.microphoneCaptureEnabled)
        XCTAssertTrue(manifest.physicalCursorIncludedInSourcePixels)
        XCTAssertFalse(manifest.mouseClickIndicatorsEnabled)
        XCTAssertTrue(manifest.namedCursorOverlayRequiresActiveLease)
        XCTAssertFalse(manifest.rawFrameWrittenBeforeApproval)
        XCTAssertTrue(manifest.explicitSafeFixtureApproval)
        XCTAssertTrue(manifest.safeFixtureAttestation.proofOnlyCapability)
        XCTAssertTrue(manifest.safeFixtureAttestation.verified)
        XCTAssertEqual(manifest.approvedSourceCount, 1)
        XCTAssertFalse(manifest.unapprovedSourceMetadataRendered)
        XCTAssertFalse(manifest.approvalStartedCapture)
        XCTAssertEqual(manifest.evidenceAccessScope, .standaloneNoAccess)
        XCTAssertTrue(manifest.captureLease.matches(manifest.firstFrame))
        XCTAssertTrue(manifest.captureLease.matches(manifest.lastFrame))
        XCTAssertFalse(manifest.backgroundCaptureEvidence.captureApplicationActiveAtFirstFrame)
        XCTAssertFalse(manifest.backgroundCaptureEvidence.sourceApplicationActiveAtFirstFrame)
        XCTAssertTrue(manifest.backgroundCaptureEvidence.differentForegroundApplicationPresentAtFirstFrame)
        XCTAssertFalse(manifest.backgroundCaptureEvidence.displayOrScreenFallbackUsed)
        XCTAssertTrue(manifest.backgroundCaptureEvidence.provesBackgroundContinuity)
        XCTAssertFalse(manifest.shareableContentEnumerationUsed)
        XCTAssertEqual(manifest.stageCompositeDisposition, .deferredUntilInProcessRenderer)
        XCTAssertLessThan(manifest.firstFrame.monotonicNanos, manifest.lastFrame.monotonicNanos)
        let encoded = try JSONEncoder().encode(manifest)
        XCTAssertEqual(try JSONDecoder().decode(PortholeProofManifest.self, from: encoded), manifest)
    }

    func testPackagingProducesExplicitTestOnlyAdHocApplicationIdentities() throws {
        let packageRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let output = packageRoot
            .appendingPathComponent(".build")
            .appendingPathComponent("packaging-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: output) }

        try run(
            packageRoot.appendingPathComponent("Scripts/package-apps.sh"),
            [
                "--skip-build",
                "--allow-ad-hoc",
                "--signing-identity", "-",
                "--configuration", "debug",
                "--output", output.path,
            ]
        )

        let captureApp = output.appendingPathComponent("Porthole.app")
        let fixtureApp = output.appendingPathComponent("PortholeFixture.app")
        XCTAssertEqual(try plistValue("CFBundleIdentifier", app: captureApp), "dev.portdaddy.porthole")
        XCTAssertEqual(try plistValue("CFBundleExecutable", app: captureApp), "Porthole")
        XCTAssertEqual(try plistValue("CFBundleIconFile", app: captureApp), "PortholeIcon")
        XCTAssertEqual(
            try plistValue("NSScreenCaptureUsageDescription", app: captureApp),
            "Porthole receives only the window or app you choose in the macOS picker. Audio and microphone capture are off, and pixels remain memory-only unless you separately approve persistence."
        )
        XCTAssertEqual(
            try plistValue("CFBundleIdentifier", app: fixtureApp),
            "dev.portdaddy.porthole.safe-fixture"
        )
        XCTAssertEqual(try plistValue("CFBundleExecutable", app: fixtureApp), "PortholeFixture")
        XCTAssertTrue(FileManager.default.isExecutableFile(
            atPath: captureApp.appendingPathComponent("Contents/MacOS/Porthole").path
        ))
        XCTAssertTrue(FileManager.default.isExecutableFile(
            atPath: fixtureApp.appendingPathComponent("Contents/MacOS/PortholeFixture").path
        ))
        let iconURL = captureApp.appendingPathComponent("Contents/Resources/PortholeIcon.icns")
        XCTAssertTrue(FileManager.default.fileExists(atPath: iconURL.path))
        XCTAssertGreaterThan(
            (try FileManager.default.attributesOfItem(atPath: iconURL.path)[.size] as? NSNumber)?.intValue ?? 0,
            10_000
        )

        try run(URL(fileURLWithPath: "/usr/bin/codesign"), ["--verify", "--deep", "--strict", captureApp.path])
        try run(URL(fileURLWithPath: "/usr/bin/codesign"), ["--verify", "--deep", "--strict", fixtureApp.path])
        let captureSignature = try run(
            URL(fileURLWithPath: "/usr/bin/codesign"),
            ["--display", "--verbose=4", captureApp.path]
        )
        let fixtureSignature = try run(
            URL(fileURLWithPath: "/usr/bin/codesign"),
            ["--display", "--verbose=4", fixtureApp.path]
        )
        XCTAssertTrue(captureSignature.contains("Identifier=dev.portdaddy.porthole"))
        XCTAssertTrue(fixtureSignature.contains("Identifier=dev.portdaddy.porthole.safe-fixture"))
        XCTAssertTrue(captureSignature.contains("Signature=adhoc"))
        XCTAssertTrue(fixtureSignature.contains("Signature=adhoc"))
    }

    private func descriptor(
        id: UInt32,
        pid: Int32,
        bundle: String?,
        title: String,
        width: Double = 640,
        height: Double = 400,
        layer: Int = 0,
        onScreen: Bool = true
    ) -> ShareableWindowDescriptor {
        ShareableWindowDescriptor(
            windowID: id,
            ownerPID: pid,
            ownerName: "Fixture",
            bundleIdentifier: bundle,
            title: title,
            width: width,
            height: height,
            layer: layer,
            isOnScreen: onScreen
        )
    }

    private func cursor(
        id: String,
        kind: ParticipantKind,
        x: Double,
        sequence: UInt64,
        clock: UInt64
    ) -> CursorEvent {
        CursorEvent(
            captureLeaseID: "lease-a",
            participantID: id,
            kind: kind,
            displayName: id,
            colorHex: "#65D8FF",
            normalizedX: x,
            normalizedY: 0.5,
            sequence: sequence,
            monotonicNanos: clock
        )
    }

    private func assessment(_ status: PrivacyStatus) -> PrivacyAssessment {
        PrivacyAssessment(status: status, reason: "test", assessedAtMonotonicNanos: 1)
    }

    private func testRuntime() -> RuntimeMetadata {
        RuntimeMetadata(
            processID: 12,
            operatingSystem: "test",
            appVersion: "test",
            audioCaptureEnabled: false,
            microphoneCaptureEnabled: false,
            physicalCursorIncludedInSourcePixels: true,
            mouseClickIndicatorsEnabled: false,
            frameRingCapacity: 3
        )
    }

    private func program(
        digest: String = String(repeating: "a", count: 64),
        anchored: Bool = false
    ) -> SignedProgramIdentity {
        SignedProgramIdentity(
            bundleIdentifier: "dev.portdaddy.porthole.safe-fixture",
            designatedRequirement: anchored
                ? "identifier \"dev.portdaddy.porthole.safe-fixture\" and anchor apple generic"
                : "identifier \"dev.portdaddy.porthole.safe-fixture\"",
            executableSHA256: digest
        )
    }

    private func approval(
        scope: SourceApprovalScopeKind,
        capabilities: SourceCapabilities
    ) -> SourceApproval {
        let program = program()
        let instance = RunningApplicationIdentity(
            program: program,
            processID: 41,
            launchIdentity: "launch-a"
        )
        return SourceApproval(
            approvalID: "approval-a",
            scope: scope,
            sourceKind: scope == .exactWindow ? .window : .application,
            displayTitle: scope == .exactWindow
                ? "Fixture · Porthole Safe Fixture"
                : "PortholeFixture",
            capabilities: capabilities,
            program: program,
            runningInstance: scope == .signedProgram ? nil : instance,
            exactWindow: scope == .exactWindow
                ? ExactWindowIdentity(application: instance, windowID: 77)
                : nil,
            createdAtMonotonicNanos: 10
        )
    }

    private func evidenceRequest(
        repositoryID: String,
        capability: EvidenceCapability
    ) -> EvidenceAccessRequest {
        EvidenceAccessRequest(
            accountID: "account-1",
            teamID: "team-1",
            harborID: "harbor-1",
            repositoryID: repositoryID,
            sessionID: "session-a",
            actorID: "actor-a",
            perspectiveID: "human-pov",
            capability: capability
        )
    }

    private func frame(sequence: UInt64, clock: UInt64, runtime: RuntimeMetadata) -> FrameMetadata {
        FrameMetadata(
            sequence: sequence,
            monotonicNanos: clock,
            captureLeaseID: "lease-a",
            sourceApprovalID: "approval-a",
            sourceDisplayTitle: "Fixture · Porthole Safe Fixture",
            sourceKind: .window,
            sourceWindowID: 77,
            sourceWidthPoints: 640,
            sourceHeightPoints: 400,
            pixelWidth: 1280,
            pixelHeight: 800,
            contentScale: 2,
            runtime: runtime
        )
    }

    private func plistValue(_ key: String, app: URL) throws -> String {
        let data = try Data(contentsOf: app.appendingPathComponent("Contents/Info.plist"))
        let value = try PropertyListSerialization.propertyList(from: data, format: nil)
        guard let dictionary = value as? [String: Any], let string = dictionary[key] as? String else {
            XCTFail("Missing plist string \(key) in \(app.lastPathComponent)")
            return ""
        }
        return string
    }

    @discardableResult
    private func run(_ executable: URL, _ arguments: [String]) throws -> String {
        let process = Process()
        let stdout = Pipe()
        let stderr = Pipe()
        process.executableURL = executable
        process.arguments = arguments
        process.standardOutput = stdout
        process.standardError = stderr
        try process.run()
        process.waitUntilExit()
        let output = stdout.fileHandleForReading.readDataToEndOfFile()
        let errors = stderr.fileHandleForReading.readDataToEndOfFile()
        let combined = String(decoding: output + errors, as: UTF8.self)
        XCTAssertEqual(process.terminationStatus, 0, combined)
        if process.terminationStatus != 0 {
            throw NSError(
                domain: "PortholeStagePackagingTests",
                code: Int(process.terminationStatus),
                userInfo: [NSLocalizedDescriptionKey: combined]
            )
        }
        return combined
    }
}
