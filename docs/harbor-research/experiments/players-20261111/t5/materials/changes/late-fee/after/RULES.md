# Rules of the ledger

The code in `harborledger/` must keep these rules. A change that breaks one
is a defect, whatever its tests say.

**R1. Money.** Every amount is a whole number of cents held as `int`. No
`float` takes part in computing an amount. No amount is negative.

**R2. Rounding.** A share stated in basis points rounds down. When an amount
is divided among parties, the parts add up to the amount exactly: the last
party takes what is left.

**R3. Bonds.** `available = posted - held - slashed`, and it is never
negative. Only available money can be held or withdrawn.

**R4. Slashing.** A slash takes held money, and never more than is held.

**R5. Claims.** A task has at most one open claim. Only the agent that holds
a claim may act on it.

**R6. Deadlines.** A claim's deadline is `opened_at + ttl`. The claim is past
its deadline at every time `now >= deadline`. From then on its holder can do
nothing more with it, and `expire` returns its stake less a late fee of 5%,
which the ledger keeps.

**R7. Audits.** When the holder completes a claim, the stake stays held until
the claim is closed. Closing a claim draws for an audit. The draw is fixed by
the audit seed and the claim id alone, so that nothing an agent does can move
it. The claim is audited when `draw < rate`, with the rate in basis points
from 0 to 10,000.

**R8. Settlement.** An audit is settled once. A pass returns the stake. A
fail slashes the whole stake: the auditor gets the bounty share and the pool
gets the rest. No agent audits its own claim.

**R9. Journal.** Every change of state is written to the journal. Each
entry's hash covers every field of the entry and the hash of the entry
before it, so that `verify` finds any later edit.
