# Port Daddy Global Design-System Literal Audit

Date: 2026-04-29

Scope: source UI surfaces in `website-v2/src`, `website-v2/public`, `website-v2/public/css`, `fleet-config-ui/src`, `dashboard/src`, and `apps/FleetBar/FleetBar`.

Excluded from primary counts: generated bundles, dependencies, build outputs, `node_modules`, `.build`, `dist`, `coverage`, `.next`, and `.vite`.

## Executive Findings

The website still has systemic design-system debt even after the relief cleanup. The worst offenders are not isolated hex codes. They are escape hatches that let route files, docs pages, and control-plane panels bypass normalized primitives:

- Raw color literals still exist outside the semantic token layer.
- The public website still names its accent tone `lime`, which encourages a return to the yellow-acid visual language even after the token color is repaired.
- Large radii and arbitrary radius tokens remain widespread, especially `rounded-xl`, `rounded-2xl`, `rounded-[var(--radius-4xl)]`, and `rounded-[60px]`.
- Arbitrary spacing and arbitrary typography are everywhere, including `p-[...]`, `max-w-[...]`, `text-[10px]`, `tracking-[0.25em]`, and many hand-tuned route-level compositions.
- Fleet config UI uses many inline visual styles and large pill radii. Some are token-backed, but the pattern still bypasses reusable primitives.
- Native FleetBar Swift uses direct `.font(...)` modifiers heavily. That is not a web CSS violation, but it is still a design-system consistency gap if the native app is meant to share a brand system.

The current P0 visible issue is the acid-lime accent on beige. That color has been removed from `website-v2/src/styles/tokens.semantic.css` in the working tree and replaced with maritime green / sea-glass accent tokens:

- Light accent: `#006b5f`
- Light accent on tint: `#004a42`
- Dark accent: `#8fd0a7`
- Dark accent on tint: `#bce8ca`

The regression guard in `website-v2/src/design-system-contracts.test.ts` now rejects the old acid-lime values: `#dfff00`, `#e8ff37`, `#d8ff36`, and `#a7ff8b`.

## Audit Counts

335 source files scanned.

| Category | Total Hits | Files | Primary Hotspots |
|---|---:|---:|---|
| Raw color literals: hex, rgb, hsl, oklch | 402 | 29 | `tokens.semantic.css`, `fleet-config-ui/src/index.css`, `website-v2/public/css/shared.css`, `design-brief.md`, `data/mcp.ts`, `InstallCTASection.tsx` |
| Arbitrary hex Tailwind classes | 3 | 1 | `website-v2/src/data/design-brief.md` |
| Non-semantic named Tailwind colors | 26 | 20 | `InstallCTASection.tsx`, `ActivityFeed.tsx`, `AboutPage.tsx`, Fleet config checkbox accents |
| Arbitrary radius utilities | 77 | 23 | `design-brief.md`, `Surface.tsx`, `CookbookPage.tsx`, `IntegrationsPage.tsx`, `DemoGallery.tsx` |
| Large radius classes | 323 | 88 | `fleet-config-ui/src/components/MemoryPanel.tsx`, `fleet-config-ui/src/App.tsx`, `ProjectPicker.tsx`, `tutorials/Harbors.tsx` |
| Arbitrary spacing and size utilities | 794 | 68 | `site/primitives.tsx`, `MCPPage.tsx`, `AgentsPage.tsx`, `whitepaper/index.tsx`, `TutorialsPage.tsx` |
| Oversized spacing scale classes | 198 | 48 | `design-brief.md`, `IntegrationsPage.tsx`, `TutorialLayout.tsx`, `CookbookPage.tsx`, `MaturitySection.tsx` |
| Arbitrary typography utilities | 2400 | 126 | `site/primitives.tsx`, SDK docs pages, `whitepaper/index.tsx`, `BlogPage.tsx`, Fleet config app shell |
| Raw font-family / direct font modifiers | 171 | 10 | `FleetPopover.swift`, `FleetControlCenter.swift`, `CostDashboard.swift`, `shared.css`, `index.css` |
| Extreme font weights | 266 | 53 | `BlogPage.tsx`, `TutorialLayout.tsx`, `TemplatePage.tsx`, `whitepaper/index.tsx`, `AboutPage.tsx` |
| Inline visual styles | 1166 | 86 | `fleet-config-ui/src/App.tsx`, `AgentsPanel.tsx`, `ProjectPicker.tsx`, `SortiePanel.tsx`, `ApiReference.tsx` |

## P0 Remediation

1. Keep the acid-lime token replacement.
2. Add the regression guard against the old acid-lime values.
3. Rename public accent APIs from `lime` to a neutral semantic tone such as `accent`, `roadmap`, or `signal`, while preserving a compatibility alias only if needed during migration.
4. Remove the remaining literal yellow glow in `website-v2/src/pages/cookbook/RecipePage.tsx`.
5. Replace `selection:text-white`, `text-white`, `bg-black/50`, `from-black/40`, and `accent-red-600` with semantic inverse, scrim, overlay, and danger/control tokens.

## P1 Remediation

1. Normalize radius usage:
   - Cards, panels, and repeated blocks should use the canonical primitive radius.
   - Route files should not use `rounded-2xl`, `rounded-3xl`, `rounded-full`, `rounded-[60px]`, or `rounded-[var(--radius-4xl)]` unless the design-system contract explicitly allows that role.
   - Pills/chips should be replaced with squared or lightly curved Swiss-modern label primitives unless the component is a true native control.
2. Normalize spacing:
   - Replace route-level `py-24`, `py-32`, `p-16`, `lg:p-20`, and hand-tuned `max-w-[...]` with section, page, panel, and measure tokens.
   - Keep arbitrary utilities only when they reference canonical tokens, for example `var(--layout-gutter)`, and only inside primitives.
3. Normalize typography:
   - Convert repeated `text-[10px]`, `tracking-[0.25em]`, `font-black`, and `font-extrabold` into named role classes or primitive props.
   - Route files should not own optical sizing, letter spacing, or weight decisions.
4. Move token-backed inline visual styles into reusable primitives or role classes. Token-backed inline styles are better than raw literals, but they still make route pages visually fork the system.

## P2 Remediation

1. Reconcile `website-v2/public/css/shared.css` with the three-layer token system or explicitly mark it as a legacy/static-doc exception.
2. Move domain-specific maritime signal colors out of component files and into semantic signal tokens:
   - `website-v2/src/components/ui/SignalFlags.tsx`
   - `website-v2/src/components/viz/MaritimeFlags.tsx`
3. Delete or quarantine default starter assets such as Vite SVGs if they are not part of production.
4. Give Fleet config UI a matching primitive layer so control-plane panels do not keep inventing local pills, surfaces, and inline visual styles.
5. Define a native app token bridge for FleetBar so Swift typography and color choices map back to the same brand roles.

## Reproduction Commands

Run the global source scan:

```bash
node <<'NODE'
const fs=require('fs'), path=require('path');
const roots=['website-v2/src','website-v2/public/css','website-v2/public','fleet-config-ui/src','dashboard/src','apps/FleetBar/FleetBar'];
const exts=new Set(['.ts','.tsx','.js','.jsx','.css','.md','.mdx','.svg','.html','.swift']);
const ignore=new Set(['node_modules','dist','build','.git','coverage','.next','.vite','.build']);
function rootOf(f){return roots.find(r=>f===r||f.startsWith(r+'/'))||'other'}
function walk(d,o=[]){if(!fs.existsSync(d))return o;for(const e of fs.readdirSync(d,{withFileTypes:true})){if(ignore.has(e.name))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p,o);else if(exts.has(path.extname(e.name)))o.push(p)}return o}
const files=[...new Set(roots.flatMap(r=>walk(r)))].sort();
const rules={rawColorLiteral:/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl)a?\([^)]*\)|\boklch\([^)]*\)/g,arbitraryHexClass:/\b(?:bg|text|border|from|via|to|ring|shadow|fill|stroke|outline|decoration)-\[#[^\]\s]+\]/g,namedTailwindColor:/\b(?:bg|text|border|from|via|to|ring|shadow|fill|stroke|outline|decoration|accent)-(?:black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-[0-9]{2,3})?(?:\/[0-9]{1,3})?\b/g,arbitraryRadius:/\b(?:rounded|rounded-[trbl][r]?|radius)-\[[^\]]+\]/g,largeRadius:/\brounded-(?:xl|2xl|3xl|4xl|full)\b/g,arbitrarySpacingSize:/\b(?:p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y|w|h|min-w|max-w|min-h|max-h|top|right|bottom|left|inset|translate-x|translate-y|z)-\[[^\]]+\]/g,oversizedSpacing:/\b(?:p|px|py|pt|pb|pl|m|mx|my|mt|mb|ml|gap|space-x|space-y)-(?:12|14|16|20|24|28|32|36|40|44|48|52|56|60|64|72|80|96)\b/g,arbitraryType:/\b(?:text|leading|tracking|font)-\[[^\]]+\]/g,rawFontFamily:/fontFamily\s*:\s*['"][^'"]+['"]|font-family\s*:\s*[^;]+;|\.font\s*\([^)]*\)/g,extremeWeight:/\bfont-(?:black|extrabold)\b|font-weight\s*:\s*(?:800|900|1000)\b|\.fontWeight\s*\(\.(?:black|heavy|bold)\)/g,inlineVisualStyle:/style=\{\{[^}]*\b(?:color|background|border|boxShadow|textShadow|filter|backdropFilter|fontFamily|fontSize|borderRadius|padding|margin|width|height)\b/g};
const res={}; for(const k of Object.keys(rules))res[k]={total:0,files:new Map(),roots:new Map()};
for(const f of files){const s=fs.readFileSync(f,'utf8');for(const [k,re] of Object.entries(rules)){re.lastIndex=0;let m;while((m=re.exec(s))){res[k].total++;res[k].files.set(f,(res[k].files.get(f)||0)+1);const r=rootOf(f);res[k].roots.set(r,(res[k].roots.get(r)||0)+1)}}}
console.log(`files_scanned=${files.length}`);for(const [k,d] of Object.entries(res)){console.log(`${k}|total=${d.total}|files=${d.files.size}|roots=${[...d.roots.entries()].sort((a,b)=>b[1]-a[1]).map(([r,c])=>`${r}:${c}`).join(', ')}|top=${[...d.files.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([f,c])=>`${f}:${c}`).join('; ')}`)}
NODE
```

Pull exact line inventories for remediation:

```bash
rg -n "#[0-9a-fA-F]{3,8}\b|\b(rgb|hsl)a?\(|\boklch\(" website-v2/src website-v2/public/css website-v2/public fleet-config-ui/src apps/FleetBar/FleetBar
rg -n "\b(bg|text|border|from|via|to|ring|shadow|fill|stroke|outline|decoration|accent)-(black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)" website-v2/src fleet-config-ui/src
rg -n "\brounded-(xl|2xl|3xl|4xl|full)\b|\brounded-\[[^]]+\]" website-v2/src fleet-config-ui/src
rg -n "\b(p|px|py|pt|pb|pl|m|mx|my|mt|mb|ml|gap|space-x|space-y)-(12|14|16|20|24|28|32|36|40|44|48|52|56|60|64|72|80|96)\b" website-v2/src fleet-config-ui/src
rg -n "\bfont-(black|extrabold)\b|\b(text|leading|tracking|font)-\[[^]]+\]" website-v2/src fleet-config-ui/src
```

## Definition Of Done

This audit should not be considered complete as product work until:

- Raw production color literals exist only in token files or documented domain-token exceptions.
- Route files use semantic primitive props instead of direct brand color, radius, spacing, and typography utilities.
- The `lime` tone name is gone from public website data and primitives.
- Regression tests forbid acid-lime token values and raw literals in protected production modules.
- Screenshots for `/`, `/examples`, `/tutorials`, `/whitepaper`, `/docs`, `/mcp`, `/agents`, and `/roadmap` are reviewed for remaining yellow-on-beige, pill-neumorphism, and oversized radii.
