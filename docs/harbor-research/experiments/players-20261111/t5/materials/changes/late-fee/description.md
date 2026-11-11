# claims: charge a late fee when a claim expires

Letting a claim run out cost its holder nothing, so agents sat on tasks. An expired claim now pays a late fee of 5% of its stake: `expire` slashes the fee from the held stake (R4), returns the rest, adds the fee to `ClaimBook.late_fees` and journals it. R6 in RULES.md says so. `test_expire_charges_late_fee` covers the fee and where it goes.
