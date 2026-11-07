# Frozen protocol input

The original protocol document is preserved byte-for-byte in
[comms-protocol.md.zip](comms-protocol.md.zip), member `comms-protocol.md`.
It is historical input to RED, including its broken security-document citation;
it is not current operational guidance. Altering that citation would change the
input against which RED's sealed findings were made.

The original member SHA-256 is `a1a7884b7c22ad30201b4675793ee7fbaa5505fd802a26a71837d11b383bcd47`.
The original RED seal retains its original logical path. The campaign seal
checker resolves that path from this archive without extracting or executing
anything. A raw local copy may remain for replay, but Git ignores it. All other
recorded bytes and the original outer seal remain unchanged.

[Current campaign scope and conclusions](../../README.md) distinguish the
historical protocol's claims from the repaired model and actual guest evidence.
