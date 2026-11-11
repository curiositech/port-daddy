# audits: make the auditor's share of a slash a setting

`BOUNTY_BPS` was a constant. A harbor that wants to pay its auditors more or less can now pass `bounty_bps` when it makes the `AuditBook`. The default is the old 20%. Both parts of a slash are computed from the setting. `test_split_adds_up` covers the split: the bounty and the pool's part add up to the amount slashed (R2).
