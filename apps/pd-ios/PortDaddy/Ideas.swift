import Foundation

// MARK: - Ideas — hear proposals, chat to explore (design pass: mobile-intent-first)
//
// The surface for "hear new ideas" and "chat with agents to explore them."
// Snipe (the engine-room crew) surfaces suggestions; the operator promotes one
// to the roadmap or explores it in a thread. Fixture-backed: Snipe's suggestion
// job and per-idea chat threads are not built, so the actions render disabled
// with their reason and the composer is inert — the app does not offer a
// working control it does not have.

public struct Idea: Codable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let why: String
    public let source: String
}

public struct ChatMessage: Codable, Sendable, Identifiable {
    public enum Role: String, Codable, Sendable {
        case them
        case you
    }
    public let id: String
    public let role: Role
    public let author: String
    public let text: String
}

public struct IdeasFeed: Codable, Sendable {
    public let note: String?
    public let ideas: [Idea]
    public let exploringTopic: String?
    public let chat: [ChatMessage]
}
