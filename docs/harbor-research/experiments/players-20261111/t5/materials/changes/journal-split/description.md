# audits: journal the auditor and the split when an audit settles

The `audit.settle` entry said only which claim settled and how. So that the pool and the bounties can be rebuilt from the journal alone, the entry now also names the auditor, the amount slashed, the bounty and the pool's part. A passed audit journals zeros.
