import Foundation
import PortholeStageCore

@MainActor
final class PortholeAutomationRuntime {
    let socketURL: URL

    private let server: PortholeAutomationServer

    init(controller: StageCaptureController, socketURL: URL) {
        self.socketURL = socketURL
        let coordinator = PortholeAutomationCoordinator(controller: controller)
        server = PortholeAutomationServer(socketURL: socketURL) { request in
            await coordinator.handle(request)
        }
    }

    func start() throws {
        try server.start()
    }

    func stop() {
        server.stop()
    }
}
