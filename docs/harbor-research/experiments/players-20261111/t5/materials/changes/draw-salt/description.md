# audits: mix the completion time into the audit draw

Two ledgers that share a seed gave every claim id the same draw, so claim 7 was audited in both or in neither. The draw now takes a salt, and `close` passes the time the claim was completed, which `complete` records on the claim. Draws for one claim id now differ between ledgers. The rate and the comparison are unchanged.
