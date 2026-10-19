# Source access ledger

| Source | Access and safe use |
| --- | --- |
| Wu et al., [AutoGen arXiv v2](https://arxiv.org/html/2308.08155v2), arXiv:2308.08155v2 (2023-10-03); COLM 2024 | Paper body inspected: §2.1–2.2 agents/reply/control; A1/Table 9 success; A3 ALFWorld; A4 OptiGuide; A5 manager loop; A6 chess/`register_reply`; limits. Main §3 labels A3/A4 correctly; Appendix E Tables 13/15 captions internally mislabel OptiGuide as A3, so case identity follows main §3 and Appendix D workflow labels. |
| [AutoGen 0.2 ConversableAgent API](https://microsoft.github.io/autogen/0.2/docs/reference/agentchat/conversable_agent/), [GroupChat API](https://microsoft.github.io/autogen/0.2/docs/reference/agentchat/groupchat/), and [human-in-the-loop tutorial](https://microsoft.github.io/autogen/0.2/docs/tutorial/human-in-the-loop/) | Versioned docs inspected: `is_termination_msg`, direct auto-reply bound, executor `work_dir`/Docker/timeout, `max_round`, speaker configuration, and input modes |
| [AutoGen v0.2.35 `ConversableAgent` source](https://raw.githubusercontent.com/microsoft/autogen/v0.2.35/autogen/agentchat/conversable_agent.py), `check_termination_and_human_reply` and `generate_reply` | Exact version source inspected: human-mode guard at lines 1649–1723 returns `(True, None)` on `exit`, returns a nonempty user response directly, and otherwise allows the auto-reply chain; `generate_reply` orders the guard before tool, code, and LLM reply functions (lines 1828–1890). |

Retrieved 2026-09-24. No active reference claims universal controller elimination, full-state transcripts, human approval, safety, or runtime verification.
