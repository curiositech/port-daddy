# claims: let the holder renew a claim

Long tasks ran out of time and had to be released and claimed again, which let another agent take the task in between. `ClaimBook.renew` moves the deadline of an open claim to `now + ttl`. Only the holder may renew (R5), and a claim past its deadline cannot be renewed. The renewal is journaled.
