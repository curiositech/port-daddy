# Protocol state and transport boundary

Instantiate a conversation with a version, roles, conversation ID, content schema, legal acts, terminal states, and a separate timeout/duplicate/cancellation profile. On a late message, preserve the ID and profile decision; absence of a reply is not success. A protocol transition has no authority to perform a domain effect.

XC00037H defines FIPA communicative-act semantics and notes its conformance-testing limitation: <https://jmvidal.cse.sc.edu/library/XC00037H.pdf>. XC00025D metadata was available but the body was not used: <https://citeseerx.ist.psu.edu/document?doi=e772d3fb25d0edc5d39caed97dc1c21841935d97&repid=rep1&type=pdf>.
