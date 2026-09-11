type: added

- **Porthole Stage now has a strict non-production macOS CI artifact lane.** Relevant changes run the Swift tests, repeat ad-hoc bundle assembly, verify exact app identity and contents, and require byte-identical normalized archives while the documented production boundary remains fail closed on Developer ID signing, notarization, release metadata, and fresh operator-hardware visual/privacy proof.
