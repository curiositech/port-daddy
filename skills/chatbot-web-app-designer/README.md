# Chatbot Web App Designer

Runs a founder-interview-to-locked-PRD product discovery process — structured interview, live low-fidelity wireframes, a real feature/page node-graph (not a flat list), a founder-confirmed lock-in checkpoint, then a generated PRD, a Mermaid-rendered sitemap, and a mocked-up design system.

## Structure

```
chatbot-web-app-designer/
├── SKILL.md                              # Core process, anti-patterns
├── CHANGELOG.md
├── README.md                             # This file
└── references/
    ├── interview-script.md               # Structured founder interview question bank
    ├── node-graph-schema.md              # Node/edge data model + Mermaid rendering
    ├── prd-template.md                   # PRD structure, generated only post-lock-in
    ├── design-system-handoff.md          # Skill invocation order after lock-in
    └── chatbot-implementation-stack.md   # Cloudflare Think harness + Excalidraw +
                                           # React Flow + Mermaid + 21st.dev build
```

## Quick Start

1. Run the interview (`references/interview-script.md`), wireframing and node-graphing as you go.
2. Get explicit lock-in confirmation before generating anything downstream.
3. Generate the PRD, Mermaid sitemap, and design system together (`references/prd-template.md`, `references/design-system-handoff.md`).
4. To build this as a live chatbot instead of running it manually, see `references/chatbot-implementation-stack.md`.
