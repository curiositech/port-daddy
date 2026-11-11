# audits: let an operator reopen a recorded verdict

A verdict could not be corrected once recorded, even when the auditor had looked at the wrong revision. `AuditBook.reopen(claim_id, reason)` discards the recorded verdict so that an auditor can record a new one before the audit is settled, and journals the reason (R9). An audit with no verdict cannot be reopened.
