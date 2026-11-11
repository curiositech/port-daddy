# claims: expire in deadline order and stop at the first claim that is not due

`expire` walked every claim on every call and returned ids in the order the claims were opened. It now sorts by deadline and stops at the first claim whose deadline has not come. The expired claims are returned and journaled earliest deadline first, which is the order an operator reading the journal expects.
