import SwiftUI

// MARK: - Story Linework Grammar

enum FleetSignalFlag: String, CaseIterable, Identifiable {
    case kilo
    case papa
    case quebec
    case uniform
    case november
    case foxtrot
    case lima
    case mike
    case delta
    case oscar
    case xray
    case bravo

    var id: String { rawValue }

    var letter: String {
        switch self {
        case .kilo: return "K"
        case .papa: return "P"
        case .quebec: return "Q"
        case .uniform: return "U"
        case .november: return "N"
        case .foxtrot: return "F"
        case .lima: return "L"
        case .mike: return "M"
        case .delta: return "D"
        case .oscar: return "O"
        case .xray: return "X"
        case .bravo: return "B"
        }
    }

    var meaning: String {
        switch self {
        case .kilo: return "I wish to communicate with you"
        case .papa: return "All aboard; about to proceed to sea"
        case .quebec: return "My vessel is healthy; I request free pratique"
        case .uniform: return "You are running into danger"
        case .november: return "No"
        case .foxtrot: return "I am disabled; communicate with me"
        case .lima: return "You should stop your vessel instantly"
        case .mike: return "My vessel is stopped"
        case .delta: return "Keep clear; maneuvering with difficulty"
        case .oscar: return "Man overboard"
        case .xray: return "Stop carrying out your intentions and watch for my signals"
        case .bravo: return "I am taking in, discharging, or carrying dangerous goods"
        }
    }

    var firstColor: Color {
        switch self {
        case .kilo: return Fleet.Color.fixed("#F2BE51")
        case .papa: return Fleet.Color.activeSlab
        case .quebec: return Fleet.Color.fixed("#F2BE51")
        case .uniform: return Fleet.Color.warning
        case .november: return Fleet.Color.activeSlab
        case .foxtrot: return Fleet.Color.failure
        case .lima: return Fleet.Color.fixed("#121212")
        case .mike: return Fleet.Color.activeSlab
        case .delta: return Fleet.Color.fixed("#F2BE51")
        case .oscar: return Fleet.Color.failure
        case .xray: return Fleet.Color.fixed("#FBF7EF")
        case .bravo: return Fleet.Color.failure
        }
    }

    var secondColor: Color {
        switch self {
        case .kilo: return Fleet.Color.activeSlab
        case .papa: return Fleet.Color.fixed("#FBF7EF")
        case .quebec: return Fleet.Color.fixed("#F2BE51")
        case .uniform: return Fleet.Color.fixed("#FBF7EF")
        case .november: return Fleet.Color.fixed("#FBF7EF")
        case .foxtrot: return Fleet.Color.fixed("#FBF7EF")
        case .lima: return Fleet.Color.fixed("#F2BE51")
        case .mike: return Fleet.Color.fixed("#FBF7EF")
        case .delta: return Fleet.Color.activeSlab
        case .oscar: return Fleet.Color.fixed("#F2BE51")
        case .xray: return Fleet.Color.activeSlab
        case .bravo: return Fleet.Color.failure
        }
    }

    var letterColor: Color {
        switch self {
        case .kilo, .quebec, .uniform, .lima, .oscar, .xray:
            return Fleet.Color.fixed("#121212")
        default:
            return Fleet.Color.fixed("#FBF7EF")
        }
    }
}

enum FleetVisualState: String, CaseIterable, Identifiable {
    case running
    case ok
    case warn
    case error
    case blocked
    case idle

    var id: String { rawValue }

    var label: String {
        switch self {
        case .running: return "Running"
        case .ok: return "OK"
        case .warn: return "Warn"
        case .error: return "Error"
        case .blocked: return "Blocked"
        case .idle: return "Idle"
        }
    }

    var color: Color {
        switch self {
        case .running: return Fleet.Color.active
        case .ok: return Fleet.Color.healthy
        case .warn: return Fleet.Color.warning
        case .error: return Fleet.Color.failure
        case .blocked: return Fleet.Color.blocked
        case .idle: return Fleet.Color.dormant
        }
    }

    var zoneColor: Color {
        switch self {
        case .running: return Fleet.Color.activeSlab
        case .blocked: return Fleet.Color.violetSlab
        default: return color
        }
    }

    var signal: FleetSignalFlag {
        switch self {
        case .running: return .kilo
        case .ok: return .quebec
        case .warn: return .uniform
        case .error: return .november
        case .blocked: return .foxtrot
        case .idle: return .mike
        }
    }

    var animates: Bool { self == .running }

    init(agentStatus: FleetAgent.AgentStatus) {
        switch agentStatus {
        case .running, .queued, .armed, .scheduled:
            self = .running
        case .paused, .salvaged:
            self = .warn
        case .failed, .dead:
            self = .error
        case .orphanReconciled:
            self = .ok
        case .historical, .idle:
            self = .idle
        }
    }

    init(projectState: ProjectOperatorState, needsBudget: Bool) {
        if needsBudget {
            self = .blocked
            return
        }
        switch projectState {
        case .running: self = .running
        case .ready: self = .ok
        case .blocked: self = .blocked
        case .serviceOnly, .contextOnly: self = .warn
        case .missing: self = .error
        }
    }

    init(menuBarTone: FleetMenuBarTone) {
        switch menuBarTone {
        case .healthy: self = .running
        case .warning: self = .warn
        case .critical: self = .error
        case .dormant: self = .idle
        }
    }
}

struct SignalFlagGlyph: View {
    let signal: FleetSignalFlag
    var showsLetter = true

    var body: some View {
        ZStack {
            HStack(spacing: 0) {
                signal.firstColor
                signal.secondColor
            }
            if showsLetter {
                Text(signal.letter)
                    .font(.system(size: 7.5, weight: .black, design: .monospaced))
                    .foregroundStyle(signal.letterColor)
                    .shadow(color: Color.black.opacity(0.18), radius: 0, x: 0, y: 0.5)
                    .minimumScaleFactor(0.65)
            }
        }
        .frame(width: 15, height: 10)
        .overlay(Rectangle().stroke(Color.primary.opacity(0.28), lineWidth: 0.5))
        .accessibilityLabel("\(signal.letter) flag: \(signal.meaning)")
        .help("\(signal.letter) — \(signal.meaning)")
    }
}

struct StoryStateDot: View {
    let state: FleetVisualState
    var size: CGFloat = 7
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        ZStack {
            Circle()
                .fill(state.color)
                .frame(width: size, height: size)
            if state.animates && !reduceMotion {
                Circle()
                    .stroke(state.color, lineWidth: 1.25)
                    .frame(width: size + 8, height: size + 8)
                    .scaleEffect(pulse ? 1.28 : 0.72)
                    .opacity(pulse ? 0 : 0.62)
                    .animation(.easeOut(duration: 1.8).repeatForever(autoreverses: false), value: pulse)
            }
        }
        .frame(width: size + 10, height: size + 10)
        .onAppear {
            guard state.animates && !reduceMotion else { return }
            pulse = true
        }
        .onChange(of: reduceMotion) { _, newValue in
            pulse = state.animates && !newValue
        }
        .accessibilityHidden(true)
    }
}

struct StoryCornerTicks: View {
    var color: Color = Fleet.Chrome.rule
    var length: CGFloat = 12
    var lineWidth: CGFloat = 1.5

    var body: some View {
        GeometryReader { proxy in
            let w = proxy.size.width
            let h = proxy.size.height
            Path { path in
                path.move(to: CGPoint(x: 0, y: length))
                path.addLine(to: CGPoint(x: 0, y: 0))
                path.addLine(to: CGPoint(x: length, y: 0))

                path.move(to: CGPoint(x: w - length, y: 0))
                path.addLine(to: CGPoint(x: w, y: 0))
                path.addLine(to: CGPoint(x: w, y: length))

                path.move(to: CGPoint(x: w, y: h - length))
                path.addLine(to: CGPoint(x: w, y: h))
                path.addLine(to: CGPoint(x: w - length, y: h))

                path.move(to: CGPoint(x: length, y: h))
                path.addLine(to: CGPoint(x: 0, y: h))
                path.addLine(to: CGPoint(x: 0, y: h - length))
            }
            .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .square, lineJoin: .miter))
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

struct StoryRule: View {
    var body: some View {
        HStack(spacing: 0) {
            Rectangle()
                .fill(Fleet.Chrome.rule)
                .frame(width: 64, height: 1)
            Spacer(minLength: 0)
        }
        .frame(height: 1)
        .accessibilityHidden(true)
    }
}

struct StoryStateRow<Accessory: View>: View {
    let state: FleetVisualState
    let title: String
    let detail: String
    let time: String
    let signal: FleetSignalFlag?
    let accessory: Accessory

    init(
        state: FleetVisualState,
        title: String,
        detail: String,
        time: String,
        signal: FleetSignalFlag? = nil,
        @ViewBuilder accessory: () -> Accessory = { EmptyView() }
    ) {
        self.state = state
        self.title = title
        self.detail = detail
        self.time = time
        self.signal = signal
        self.accessory = accessory()
    }

    var body: some View {
        HStack(alignment: .center, spacing: Fleet.Space.s) {
            Rectangle()
                .fill(state.color)
                .frame(width: 3)
                .padding(.vertical, 6)
            StoryStateDot(state: state)
            SignalFlagGlyph(signal: signal ?? state.signal)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(.caption, design: .monospaced).weight(.semibold))
                    .foregroundStyle(state == .error ? Fleet.Color.failure : .primary)
                    .lineLimit(1)
                if !detail.isEmpty {
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: Fleet.Space.s)
            accessory
            Text(time)
                .font(.system(.caption2, design: .monospaced).weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(minWidth: 40, alignment: .trailing)
        }
        .frame(minHeight: 34)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(state.label), \(title), \(detail), \(time)")
    }
}

struct StoryLiveZone: View {
    let title: String
    let detail: String
    let meta: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        HStack(alignment: .center, spacing: Fleet.Space.m) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: Fleet.Space.s) {
                    StoryStateDot(state: .running, size: 8)
                    SignalFlagGlyph(signal: .kilo)
                    Text("Now running")
                        .font(.system(.caption2, design: .monospaced).weight(.bold))
                        .textCase(.uppercase)
                        .foregroundStyle(Color.white.opacity(0.86))
                }
                Text(title)
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(Color.white)
                    .lineLimit(1)
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(Color.white.opacity(0.78))
                    .lineLimit(2)
            }
            Spacer(minLength: Fleet.Space.s)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.plain)
                    .font(.system(.caption, design: .monospaced).weight(.bold))
                    .foregroundStyle(Color.white)
                    .padding(.horizontal, Fleet.Space.s)
                    .padding(.vertical, 5)
                    .background(Color.black.opacity(0.22))
            }
            Text(meta)
                .font(.system(.caption2, design: .monospaced).weight(.bold))
                .foregroundStyle(Color.white.opacity(0.78))
        }
        .padding(.horizontal, Fleet.Space.m)
        .padding(.vertical, Fleet.Space.s)
        .background(Fleet.Color.activeSlab)
        .overlay(StoryCornerTicks(color: Color.white.opacity(0.58), length: 11, lineWidth: 1.25))
    }
}

struct FleetMenuBarMark: View {
    let state: FleetVisualState
    let pendingGateCount: Int
    var devBadge: String?

    var body: some View {
        HStack(spacing: 3) {
            ZStack(alignment: .topTrailing) {
                HStack(spacing: 2) {
                    Rectangle()
                        .fill(state.zoneColor)
                        .frame(width: 4, height: 15)
                    SignalFlagGlyph(signal: pendingGateCount > 0 ? .foxtrot : state.signal, showsLetter: false)
                        .frame(width: 17, height: 12)
                    StoryStateDot(state: pendingGateCount > 0 ? .blocked : state, size: 5)
                        .frame(width: 8, height: 12)
                }
                if pendingGateCount > 0 {
                    Text(min(pendingGateCount, 9), format: .number)
                        .font(.system(size: 7, weight: .black, design: .monospaced))
                        .foregroundStyle(Color.white)
                        .frame(width: 10, height: 10)
                        .background(Fleet.Color.violetSlab)
                        .offset(x: 5, y: -5)
                }
            }
            if let devBadge {
                Text(devBadge)
                    .font(.system(size: 9, weight: .heavy))
                    .tracking(0.5)
                    .foregroundStyle(state.color)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
        .help(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        if pendingGateCount > 0 {
            return "FleetBar, \(pendingGateCount) human gate\(pendingGateCount == 1 ? "" : "s") waiting"
        }
        return "FleetBar, \(state.label.lowercased())"
    }
}
