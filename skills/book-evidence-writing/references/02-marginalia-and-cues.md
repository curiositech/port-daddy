# Marginalia and Cues: Visual and Textual Apparatus

## The Function of the Margin

In the Tufte-style layout of the Harbor Book, the margin is not dead whitespace or a scratchpad for trivia. It serves as an active parallel track:
- **Counterexamples**: Demonstrating the exact boundary where the main text's claim ceases to hold.
- **Concrete Parameters**: Real-world constants, latency bounds, and byte limits.
- **Historical Analogies & Caveats**: Parallels to physical maritime or distributed systems precedents, explicitly noting the limit of the analogy.

## Prohibited Patterns in Marginalia

### 1. Bare Category Labels
Never write:
- ❌ `Pitfall`
- ❌ `Key Idea`
- ❌ `Note:`
- ❌ `Warning:`

These placeholders waste reader attention and force the eye to scan back into the body to find what the warning actually is.

### 2. Active Assertion Rule
Always write the assertion or hazard itself as a complete, tight sentence:
- ✅ `A restore from backup can silently resurrect a revoked bearer card.`
- ✅ `Gossip protocols bound eventual delivery, not instant admission safety.`
- ✅ `A zero-trust edge worker cannot decrypt payloads without an ephemeral enclave key.`

## Typography and Restraint

1. **Font Hierarchy**: Maintain the book's strict typographical ladder (Palatino body, Heros sans annotations, Suisse accents).
2. **Restrained Emphasis**: Do not sprinkle bold, italics, or small caps arbitrarily throughout margin blocks. Let the position and brevity provide the emphasis.
3. **Asset Provenance**: Keep generation and asset metadata in build sidecars; never clutter public margin captions with production notes like "AI generated analogy".
