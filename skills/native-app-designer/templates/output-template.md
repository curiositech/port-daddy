# Native App Design Output Template

Fill in every section before handing off a native (or native-feel) design. Validate the underlying claims with `node scripts/native_design_audit.mjs --input <this-design-as-native-ui-spec>.json` before calling it done.

```markdown
## Design Brief Recap

- <Platform: iOS / macOS / cross-platform web with native feel>
- <App personality: Professional / Playful / Natural / Minimal / Vibrant — and why>
- <Primary user context this personality serves>

## Screens / Components

- <Screen or component name> — <one-line description of its role>
- ...

## Motion Design

- <Interaction> → <animation type: spring(response, dampingFraction) | eased | none> — <why this timing>

## Platform Compliance (must all be true before shipping)

- [ ] All icons are SF Symbols (or custom vectors drawn to SF Symbol conventions) — never emoji.
- [ ] Body/prose/caption text is >= 14pt and scales with Dynamic Type.
- [ ] Every interactive control has a >= 44x44pt tap target.
- [ ] Text/background contrast is >= 4.5:1 everywhere.
- [ ] Both light and dark appearances are implemented with semantic colors.
- [ ] Layout respects safe areas (notch, Dynamic Island, home indicator).
- [ ] Chrome/overlay surfaces use system materials where appropriate.

## native-ui-spec (for the auditor)

- `<path to the native-ui-spec.json for this design>`
```

## Checklist before marking ready

- [ ] `node scripts/native_design_audit.mjs --input <spec>.json` returns `pass: true`.
- [ ] No emoji used as a UI icon anywhere in the design (emoji in user-generated content is fine).
- [ ] No animation uses `.linear()`/constant easing (see SKILL.md "Linear Animation Death").
- [ ] Color palette stays within 3-4 colors, 60/30/10 rule applied.
- [ ] Reduced-motion and screen-reader/VoiceOver behavior specified, not assumed.
