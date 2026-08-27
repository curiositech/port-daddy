import AppKit
import SwiftUI
import XCTest
@testable import FleetBar

@MainActor
final class DoctrineSectionSnapshotTests: XCTestCase {
    func testRenderDoctrineEvidenceFixtureWhenRequested() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let output = env["FLEETBAR_DOCTRINE_SNAPSHOT_OUT"], !output.isEmpty else {
            throw XCTSkip("Set FLEETBAR_DOCTRINE_SNAPSHOT_OUT to render the labeled CASE-13 doctrine fixture.")
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DoctrineFixtureURLProtocol.self]
        let store = FleetDoctrineStore(
            baseURL: "http://fixture.port-daddy.test",
            session: URLSession(configuration: configuration)
        )
        await store.refresh(projectDir: "/fixture/case-13")
        XCTAssertEqual(store.candidates.count, 1)
        XCTAssertEqual(store.selectedCandidate?.status, .provisional)

        let view = VStack(spacing: 0) {
            Text("FIXTURE — CASE-13 synthetic evidence ledger; not live doctrine")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 18)
                .padding(.vertical, 8)
                .background(Color(red: 0.35, green: 0.12, blue: 0.06))
            FleetDoctrineSection(store: store, projectDir: "/fixture/case-13")
        }
        .frame(width: 1280, height: 860)
        .preferredColorScheme(.dark)

        let hosting = NSHostingView(rootView: view)
        hosting.frame = NSRect(x: 0, y: 0, width: 1280, height: 860)
        hosting.appearance = NSAppearance(named: .darkAqua)
        hosting.layoutSubtreeIfNeeded()
        guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else {
            XCTFail("Could not encode the doctrine fixture screenshot")
            return
        }
        hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        guard let data = bitmap.representation(using: .png, properties: [:]) else {
            XCTFail("Could not encode the doctrine fixture screenshot as PNG")
            return
        }
        let url = URL(fileURLWithPath: output)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url)
    }
}

private final class DoctrineFixtureURLProtocol: URLProtocol {
    private static let responses: [String: String] = [
        "/doctrine/status": """
        {"success":true,"advisory":true,"canonicalStore":"agent-harbor:doctrine-evidence","counts":{"episodes":1,"candidates":1,"provisional":1,"established":0,"contested":0}}
        """,
        "/doctrine/candidates": """
        {"success":true,"advisory":true,"candidates":[{"id":"candidate-case13","doctrineId":"doctrine:case13","episodeId":"episode-case13","projectDir":"/fixture/case-13","actorId":"steward","citations":["fixture://case13/episode"],"occurredAt":"2026-08-26T00:00:00Z","decisionClass":"integration.merge","title":"Evidence-weighted merge gate","when":"a merge has independent technical review evidence","prefer":"inspect the technical concern and its resolution","over":"blocking solely on an unresolved bot-thread counter","because":"thread state is a proxy, not the underlying defect signal","unless":["the thread contains unexamined independent evidence"],"school":"evidence-weighted stewardship","skillRefs":["port-daddy-agent-skill"],"status":"provisional","reviewerId":"fixture-reviewer","experimentId":"experiment-case13","admissionCitations":["fixture://case13/admission"],"contestedReason":null}]}
        """,
        "/doctrine/doctrine:case13": """
        {"success":true,"advisory":true,"doctrine":{"id":"candidate-case13","doctrineId":"doctrine:case13","episodeId":"episode-case13","projectDir":"/fixture/case-13","actorId":"steward","citations":["fixture://case13/episode"],"occurredAt":"2026-08-26T00:00:00Z","decisionClass":"integration.merge","title":"Evidence-weighted merge gate","when":"a merge has independent technical review evidence","prefer":"inspect the technical concern and its resolution","over":"blocking solely on an unresolved bot-thread counter","because":"thread state is a proxy, not the underlying defect signal","unless":["the thread contains unexamined independent evidence"],"school":"evidence-weighted stewardship","skillRefs":["port-daddy-agent-skill"],"status":"provisional","reviewerId":"fixture-reviewer","experimentId":"experiment-case13","admissionCitations":["fixture://case13/admission"],"contestedReason":null},"episode":{"id":"episode-case13","projectDir":"/fixture/case-13","actorId":"steward","citations":["fixture://case13/episode"],"occurredAt":"2026-08-26T00:00:00Z","decisionClass":"integration.merge","summary":"The steward held a merge because one bot review thread remained unresolved, despite green CI and no identified technical defect.","historicalAction":"hold merge","alternatives":["merge","request technical review"],"cues":["green CI","open bot thread"],"fidelity":"T4","provenance":{"model":"fixture-model","modelVersion":"case13","harness":"fixture","worktree":"/fixture/case-13","environment":"test"}},"experiment":{"id":"experiment-case13","candidateId":"candidate-case13","projectDir":"/fixture/case-13","actorId":"researcher","citations":["fixture://case13/experiment"],"occurredAt":"2026-08-26T00:00:00Z","hypothesis":"Sensitivity should track independent technical concern, not merely unresolved-thread state.","primaryOutcome":"merge versus hold decision","control":"Factual replay with independent concern absent.","treatment":"Matched replay with an independent technical concern present.","sham":"Wording-only review-interface change.","runs":[{"id":"run-control","experimentId":"experiment-case13","arm":"control","action":"merge after inspecting evidence","outcome":"thread state alone did not block","fidelity":"matched","notes":null,"occurredAt":"2026-08-26T00:00:00Z","citations":["fixture://case13/control"]},{"id":"run-treatment","experimentId":"experiment-case13","arm":"treatment","action":"hold for technical review","outcome":"independent concern changed the decision","fidelity":"matched","notes":null,"occurredAt":"2026-08-26T00:00:00Z","citations":["fixture://case13/treatment"]},{"id":"run-sham","experimentId":"experiment-case13","arm":"sham","action":"merge after inspecting evidence","outcome":"wording-only change did not change action","fidelity":"matched","notes":null,"occurredAt":"2026-08-26T00:00:00Z","citations":["fixture://case13/sham"]}]},"retrievals":[],"applications":[],"outcomes":[]}
        """,
    ]

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "fixture.port-daddy.test"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url,
              let payload = Self.responses[url.path] else {
            client?.urlProtocol(self, didFailWithError: URLError(.fileDoesNotExist))
            return
        }
        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(payload.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
