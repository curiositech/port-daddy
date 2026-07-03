# Source Map: AI Coding Assistant Product Landscape

Use this when grounding product claims in current market evidence.

## Product Mechanics To Track

| Product | Mechanics users notice | Product lesson |
| --- | --- | --- |
| Cursor | Agent, rules, model selection, terminal/browser tools, checkpoints, queued messages, codebase search, cloud/background agent surface. | Low friction comes from editor-native context plus recoverable edits. Rules and AGENTS.md are part of the product, not docs trivia. |
| Claude Code | Terminal, IDE, desktop, web, mobile/remote control, MCP, hooks, skills, background agents, routines, subagents, and git/PR workflows. | Users want one agent brain across many surfaces, with composable automation and durable session handoff. |
| Codex | App, CLI, IDE, web, GitHub/Slack/Linear integrations, worktrees, sandboxing, subagents, automation, skills, and evaluation loops. | OpenAI frames coding agents as a broader agent platform; Port Daddy should integrate, supervise, and evaluate rather than only compete. |
| GitHub Copilot cloud agent | Assign agents to issues/PRs, compare agents inside GitHub, consume premium requests, and keep work inside GitHub flows. | The pull request is becoming the agent work receipt. Multi-agent selection belongs near issues and reviews. |
| Devin/Windsurf Cascade | Code/chat modes, planning agent, todo lists, queued messages, checkpoints/reverts, real-time awareness, linter integration, simultaneous cascades, worktrees. | Long-running tasks need plan state, continuation, revert, and collision guidance. |
| Warp Code | Prompt-to-production from terminal, native editor, inline diffs, codebase context, project rules, zero-state setup, code review, worktrees. | Terminal-native agents win when setup, context, diffs, and repo initialization are one flow. |
| Cline/Roo/Aider/OpenHands/homegrown | Local control, BYO model, explicit diffs, cheap iteration, scripts, tmux/worktrees, GitHub automation. | Power users build the control plane vendors do not expose: isolation, budgets, transcripts, evals, and recovery. |

## Current Source Anchors

- Cursor agent overview: https://cursor.com/docs/agent/overview.md
- Cursor rules and AGENTS.md support: https://cursor.com/docs/rules.md
- Claude Code overview: https://code.claude.com/docs/en/overview
- OpenAI Codex docs and use cases: https://developers.openai.com/codex and https://developers.openai.com/codex/use-cases
- OpenAI Codex app docs: https://developers.openai.com/codex/app
- OpenAI agent improvement loop with traces/evals: https://developers.openai.com/cookbook/examples/agents_sdk/agent_improvement_loop
- GitHub Copilot cloud agent docs: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent
- GitHub Agent HQ coverage: https://www.theverge.com/news/873665/github-claude-codex-ai-agents
- Devin Desktop Cascade docs: https://docs.devin.ai/desktop/cascade/cascade
- Warp Code overview: https://docs.warp.dev/code/overview/
- Warp Drive overview: https://docs.warp.dev/knowledge-and-collaboration/warp-drive
- SWE-agent ACI paper: https://arxiv.org/abs/2405.15793
- AIDev GitHub agentic PR dataset: https://arxiv.org/abs/2602.09185
- Failed agentic PR taxonomy: https://arxiv.org/abs/2601.15195
- Comparing AI coding agents by PR acceptance: https://arxiv.org/abs/2602.08915
- Agentic AI shift evidence from Codex: https://arxiv.org/abs/2606.26959
- AI coding agent malware/social-engineering risk coverage: https://www.tomshardware.com/tech-industry/cyber-security/ai-coding-agents-can-be-tricked-into-installing-malware-via-clean-github-repositories-mozillas-0din-team-shows-how-claude-code-can-be-exploited-by-its-own-helpfulness
- Cursor pricing/support trust incidents: https://techcrunch.com/2025/07/07/cursor-apologizes-for-unclear-pricing-changes-that-upset-users/ and https://arstechnica.com/ai/2025/04/company-apologizes-after-ai-support-agent-invents-policy-that-causes-user-uproar/

## Social And Homegrown Signals

Treat Reddit, Hacker News, Discord, X, and GitHub issues as weak but valuable demand signals. Extract:

- repeated hacks: worktrees per agent, tmux boards, shell scripts wrapping Claude/Codex, custom AGENTS.md/rules, PR bot loops, local caches, cost trackers
- repeated delight: "it fixed the thing while I watched," "I could queue the next task," "it used my test failure as context," "I can revert"
- repeated distrust: pricing surprises, false policy/support claims, opaque context, unsafe package installs, agents editing the same files, no proof tests ran

Do not quote social posts as truth unless corroborated by docs, code, or repeated independent reports.
