# audits: let the operator change the audit rate

The rate was fixed when the book was made. `AuditBook.set_rate` changes it for claims closed afterwards, refuses a rate outside 0 to 10,000 basis points as the constructor does, and journals the change (R9). Claims already in audit are not touched.
