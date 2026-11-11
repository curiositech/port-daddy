# bonds: move available money between two bonds

An operator sometimes has to move a deposit from one agent to another, for instance when an agent is renamed. `BondBook.transfer` withdraws the amount from the source bond, so only available money can move (R3), and posts it to the target. The total across bonds does not change. A test holds both points.
