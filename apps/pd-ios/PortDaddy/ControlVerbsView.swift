import SwiftUI

// MARK: - Controls — the honest verb matrix (ADR-0125 §4)
//
// The rule this screen exists to keep: an unsupported verb is VISIBLE,
// DISABLED, and LABELLED WITH ITS REASON. Not hidden. Not silently swapped for
// a neighbouring verb that happens to work.
//
// Hiding `pause` on a remote body would produce a tidier screen and a worse
// operator. They would not learn that remote bodies cannot be suspended, they
// would not learn that Checkpoint-then-Kill is the substitute, and the next
// person to ask "why is there no pause?" would get no answer from the product
// at all.
//
// The lifecycle strip below is the §4 second rule: a command's state is one of
// six, never a spinner. An operator who cannot tell "queued" from
// "acknowledged" cannot tell a working control from a black hole.
//
// NOTHING ON THIS SCREEN ISSUES A COMMAND. The verb rows are disabled
// end-to-end in this slice: issuing requires the pairing ritual of ADR-0125 §3
// (a device membership record, a per-command jti, and the harbor authority
// epoch it was authorized under), and none of that exists yet. A control that
// looked live and did nothing would be the exact failure the rest of this file
// is written to prevent.

public struct ControlVerbsView: View {
    @State private var backend: ControlBackend = .cloudflareRemote

    public init(backend: ControlBackend = .cloudflareRemote) {
        _backend = State(initialValue: backend)
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: PD.Space.l) {
                    ProvenanceBar(.unbuilt(what: "pairing is not built, so no control here can be issued"))

                    SectionCard(
                        title: "Backend",
                        subtitle: "A verb's availability is a property of the body's backend, not of the app."
                    ) {
                        Picker("Backend", selection: $backend) {
                            ForEach(ControlBackend.allCases, id: \.self) { candidate in
                                Text(candidate.title).tag(candidate)
                            }
                        }
                        .pickerStyle(.segmented)
                    }

                    SectionCard(
                        title: "Controls",
                        subtitle: "Every verb, every time. Unsupported ones stay on screen with the reason."
                    ) {
                        VStack(spacing: PD.Space.s) {
                            // The whole matrix, unfiltered. There is no
                            // `.filter { $0.support.isSupported }` here and
                            // there must never be one.
                            ForEach(ControlVerbs.matrix(for: backend)) { availability in
                                ControlVerbRow(
                                    verb: availability.verb,
                                    support: availability.support
                                )
                            }
                        }
                    }

                    SectionCard(
                        title: "Command lifecycle",
                        subtitle: "What a control reports back. Six states, never a spinner."
                    ) {
                        VStack(alignment: .leading, spacing: PD.Space.s) {
                            ForEach(CommandState.allCases, id: \.self) { state in
                                HStack(spacing: PD.Space.s) {
                                    SignalChip(state: state.coordinationState, text: state.rawValue)
                                    Text(lifecycleExplanation(state))
                                        .font(PDFont.subheadline)
                                        .foregroundStyle(PD.Chrome.secondaryText)
                                        .fixedSize(horizontal: false, vertical: true)
                                    Spacer(minLength: 0)
                                }
                                .frame(minHeight: PD.minimumTapTarget)
                            }
                        }
                    }
                }
                .padding(PD.Space.l)
            }
            .scrollContentBackground(.hidden)
            .background(PD.Chrome.base)
            .navigationTitle("Controls")
        }
    }

    /// ADR-0122 §5: a queued command terminates in ack or failure. Expiry
    /// without delivery is a failure record, not silence.
    private func lifecycleExplanation(_ state: CommandState) -> String {
        switch state {
        case .queued:       return "Accepted, not yet handed to a body."
        case .delivered:    return "The body has it. No answer yet."
        case .acknowledged: return "The body acted on it."
        case .failed:       return "Refused or errored, with a recorded reason."
        case .expired:      return "Never delivered before its expiry. This is a failure record, not silence."
        case .unsupported:  return "This backend has no such verb. It was never issued."
        }
    }
}

/// One verb row. Supported or not, the row is the same size and in the same
/// place — an operator learns the shape of the control set once.
public struct ControlVerbRow: View {
    let verb: ControlVerb
    let support: VerbSupport

    public init(verb: ControlVerb, support: VerbSupport) {
        self.verb = verb
        self.support = support
    }

    private var tint: Color {
        if !support.isSupported { return PD.Chrome.tertiaryText }
        return verb.isDestructive ? PD.Palette.failure : PD.Palette.active
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: PD.Space.xs) {
            HStack(spacing: PD.Space.m) {
                Image(systemName: verb.systemImage)
                    .font(PDFont.body)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verb.title)
                        .font(PDFont.body.weight(.semibold))
                    if !support.isSupported {
                        // The word, not just the greyed-out styling. State is
                        // never colour alone, and "disabled" is a state.
                        Text("UNSUPPORTED ON THIS BACKEND")
                            .font(PDFont.caption.weight(.bold))
                            .foregroundStyle(PD.Palette.warning)
                    }
                }
                Spacer(minLength: 0)
                if support.isSupported {
                    Text("available")
                        .font(PDFont.subheadline)
                        .foregroundStyle(PD.Chrome.tertiaryText)
                }
            }
            .foregroundStyle(tint)

            if let reason = support.reason {
                Text(reason)
                    .font(PDFont.subheadline)
                    .foregroundStyle(PD.Chrome.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if support.isSupported {
                Text("Issuing controls needs device pairing, which is not built yet.")
                    .font(PDFont.subheadline)
                    .foregroundStyle(PD.Chrome.tertiaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, minHeight: PD.minimumTapTarget, alignment: .leading)
        .padding(PD.Space.m)
        .background(RoundedRectangle(cornerRadius: PD.Radius.standard, style: .continuous).fill(PD.Chrome.cardRaised))
        .opacity(support.isSupported ? 1.0 : 0.75)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
    }

    /// VoiceOver gets the same honesty the screen does: the verb, whether it
    /// is available, and why not.
    private var accessibilityText: String {
        if let reason = support.reason {
            return "\(verb.title). Unsupported on this backend. \(reason)"
        }
        return "\(verb.title). Available. Issuing controls needs device pairing, which is not built yet."
    }
}

#if DEBUG
#Preview("Controls — remote body (pause and fork unsupported)") {
    ControlVerbsView(backend: .cloudflareRemote)
}

#Preview("Controls — observed only (nothing supported, nothing hidden)") {
    ControlVerbsView(backend: .hookOnlyObserved)
}
#endif
