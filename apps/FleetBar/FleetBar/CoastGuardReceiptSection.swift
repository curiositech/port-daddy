import SwiftUI

/// A compact, receipt-only history for the menu-bar operator surface. It does
/// not claim all spawns were confined: unavailable receipts render nothing.
struct CoastGuardReceiptSection: View {
    @ObservedObject var store: CoastGuardReceiptStore

    var body: some View {
        if !store.receipts.isEmpty {
            VStack(alignment: .leading, spacing: Fleet.Space.s) {
                HStack(spacing: Fleet.Space.s) {
                    Image(systemName: "shield.lefthalf.filled")
                        .foregroundStyle(Fleet.Color.active)
                    Text("Recent confinement")
                        .font(.system(size: 16, weight: .semibold))
                    Spacer()
                    Text("RECEIPTS")
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .kerning(0.6)
                        .foregroundStyle(.secondary)
                }

                ForEach(store.receipts.prefix(3)) { receipt in
                    receiptRow(receipt)
                }
            }
            .padding(Fleet.Space.m)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Recent Coast Guard confinement receipts")
        }
    }

    private func receiptRow(_ receipt: CoastGuardReceiptSummary) -> some View {
        HStack(alignment: .top, spacing: Fleet.Space.s) {
            Image(systemName: receipt.confined ? "checkmark.shield.fill" : "exclamationmark.shield.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(receipt.confined ? Fleet.Color.healthy : Fleet.Color.warning)

            VStack(alignment: .leading, spacing: 2) {
                Text(receipt.agentId)
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .lineLimit(1)
                Text("\(receipt.mechanismLabel) · \(receipt.egressLabel)")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
    }
}

private extension CoastGuardReceiptSummary {
    var mechanismLabel: String {
        confined ? mechanism : "\(mechanism) (not confined)"
    }

    var egressLabel: String {
        guard let egress else { return "egress totals unavailable" }
        let bytes = ByteCountFormatter.string(fromByteCount: Int64(egress.bytes), countStyle: .file)
        let blocked = egress.blocked == 0 ? "" : ", \(egress.blocked) blocked"
        return "\(egress.requests) requests, \(bytes)\(blocked)"
    }
}
