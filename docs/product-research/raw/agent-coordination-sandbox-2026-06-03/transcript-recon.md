# Agent Transcript Recon — Claude Code & Codex CLI

Read-only recon for PD ingestion. All paths normalized to `~`. Personal identifiers redacted where they appeared.

## Headline findings (read first)

1. **Both tools write append-only JSON Lines, both end every record with `\n`, neither uses a `.tmp` or rename-on-close pattern.** A line-buffered tailer is safe as long as it only consumes complete lines (look for terminating `\n`). The last byte of an *actively-written* file may be mid-line; do not assume the final line is parseable until a newline arrives.
2. **No file rotation, no rename on session end. The session id IS the filename.** Both tools keep appending to the same path for the life of the session. Sessions don't have an explicit "closed" marker — you infer end-of-session from mtime quiescence (or, for Codex, from a `task_complete` event followed by silence).
3. **Claude Code compaction is in-file**, not a new file. It appears as a synthetic `user` message with `isCompactSummary: true` and `isVisibleInTranscriptOnly: true`, whose `message.content` is a giant string starting with `"This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation."`. Everything before that line is pre-compact history; everything after is post-compact. There is no `type: "summary"` record despite what some folklore says.
4. **Claude Code spills large tool results to a side-channel directory** at `~/.claude/projects/<encoded-cwd>/<sessionId>/tool-results/<short>.txt` rather than inlining them into the jsonl. PD must follow these links if it wants the full payload — otherwise it gets a `<persisted-output>… Full output saved to: …` stub.
5. **Codex CLI dumps the entire system prompt + tool definitions + the `developer` message (which contains an inlined copy of `AGENTS.md`)** into every transcript. This is multi-KB of stable boilerplate per session and a redaction concern (any local-only AGENTS.md content is mirrored verbatim, including filesystem paths).
6. **Codex `reasoning` records carry `encrypted_content` (opaque base64) plus empty `summary`/`content` arrays.** You cannot read Codex chain-of-thought from the transcript. Plan accordingly — for salvage/routing you have user inputs, assistant `message` records, function calls, and outputs, but not the model's internal reasoning.
7. **Codex token-usage records leak plan info** (`"plan_type":"pro"`, used percentages, reset timestamps). Worth flagging for redaction in any shared Tube envelope.
8. **The encoded-cwd directory name is a literal `/` → `-` substitution**, not URL-encoding. `/Users/erichowens/coding/port-daddy` → `-Users-erichowens-coding-port-daddy`. Lossy: a real `-` in a path becomes ambiguous with the `/` substitution. Look for the `cwd` field inside any record to recover the true path.

---

## 1. Claude Code

### 1.1 Directory layout

`~/.claude/projects/` contains **51 top-level entries**, all directories. Pattern:

```
~/.claude/projects/
  -Users-erichowens-coding-port-daddy/        # 25 *.jsonl files + 1 subdir
  -Users-erichowens-coding-erichowensdotcom/  # 16 *.jsonl files
  -Users-erichowens-coding-jbuds4life/
  -Users-erichowens-coding-dominic/           # contains <sessionId>/ subdir
  -private-tmp-pd-swarm-cuckoo/               # yes, /tmp gets a project entry
  -private-tmp-pd-swarm-econ/
  -private-var-folders-17-r37ps6c54v3...      # macOS scratch dirs too
  -Users-erichowens/                          # cwd was $HOME
  ...
```

**Encoded-cwd rule**: replace every `/` in the absolute cwd with `-`. The leading `/` becomes a leading `-`. No other escaping. `/private/tmp/...` collapses to `-private-tmp-...`. **Lossy for paths containing a literal `-`** (rare but possible).

Inside each project directory:

```
~/.claude/projects/-Users-erichowens-coding-port-daddy/
  0487de03-3ecc-472c-b28f-977e99419a55.jsonl     # 8.8 MB
  3cff306a-ec5d-4d19-be12-70bcb9fb489a.jsonl     # 26 MB  (active)
  d4e7c76e-31ce-4fd2-9b5e-83ba1fe13b3f.jsonl     # 9.4 MB
  ...  (25 *.jsonl files total)
  # NB: in projects with side-channel tool results you also see:
  #   <sessionId>/tool-results/<short>.txt
```

The filename stem is the session id (UUIDv4). It also appears as `sessionId` on **every** record in the file. Permissions: `0600` (`-rw-------`).

### 1.2 Record taxonomy (top-level `type` field)

From two well-trafficked transcripts (`d4e7c76e-...` PD, `0e540ffb-...` erichowensdotcom):

| `type` | Purpose | Carries `message`? | Carries `uuid`/`parentUuid`? |
|---|---|---|---|
| `user` | User input or `tool_result` envelope | yes | yes |
| `assistant` | Model output (text, thinking, tool_use) | yes | yes |
| `system` | Daemon-side events (errors, hooks, bridge, away-summary, …) | no | yes |
| `attachment` | Side-band content (hook output, deferred tools, skill listings, date change, task reminder) | no | yes |
| `permission-mode` | Records the current Claude permission mode | no | no |
| `last-prompt` | Bookmarks the last user prompt for resume | no | no |
| `file-history-snapshot` | Tracks file backups Claude has taken for undo | no | no (uses `messageId`) |
| `queue-operation` | Internal enqueue/dequeue ops (only seen in older transcripts) | no | no |

**Stable on every conversational record (`user`/`assistant`/`system`/`attachment`):**

```
parentUuid, isSidechain, type, uuid, timestamp,
userType ("external"), entrypoint ("cli"),
cwd, sessionId, version, gitBranch
```

`gitBranch` is *not* always present — it's null/missing for cwd outside a git repo. `slug` appears on some records (a kebab-case nickname like `"peaceful-hugging-dongarra"`).

**`system` subtypes observed:**
- `bridge_status` — `/remote-control` URL announcement
- `stop_hook_summary` — output from stop hooks
- `away_summary` — "user was away for X minutes" banner
- `turn_duration` — `{durationMs, messageCount}`
- `informational` — generic
- `api_error` — `{cause, error, retryAttempt, retryInMs, maxRetries}` (load-bearing for telemetry)

**`attachment.type` subtypes observed:**
- `hook_success` — captures hook stdout/stderr/exitCode/command/durationMs
- `deferred_tools_delta` — `{addedNames[], addedLines[]}` toolname list
- `skill_listing` — full text blob of skill descriptions
- `mcp_instructions_delta` — MCP server-supplied instructions
- `date_change` — fires when the clock crosses midnight
- `task_reminder` — the "task tools haven't been used recently" nag

### 1.3 Assistant content shape

`message.content` is always an array; each element has a `type`:

- `text` → `{type, text}`
- `thinking` → `{type, thinking: "", signature: "<opaque base64>"}` — **`thinking` field is empty string, only `signature` carries data**. Equivalent to Codex's `encrypted_content` situation. You cannot recover the model's reasoning from a transcript.
- `tool_use` → `{type, id: "toolu_...", name: "Bash"|"Read"|"Edit"|...|"TaskCreate", input: {…}}` with a `caller` sibling: `{type: "direct"}`

The assistant envelope itself carries:
```json
{"role":"assistant","model":"claude-opus-4-7","id":"msg_01...",
 "type":"message","stop_reason":"end_turn|tool_use",
 "usage":{"input_tokens":N,"cache_creation_input_tokens":N,
          "cache_read_input_tokens":N,"output_tokens":N,
          "cache_creation":{"ephemeral_1h_input_tokens":N,...},
          "service_tier":"standard","speed":"...",
          "iterations":N,"server_tool_use":{...},"inference_geo":{...}}}
```

### 1.4 User content shape (3 variants)

1. **String content** (direct typed input):
   ```json
   {"type":"user","message":{"role":"user","content":"the user's typed message"},
    "uuid":"…","timestamp":"…","sessionId":"…","cwd":"…","gitBranch":"…"}
   ```
2. **Array content with `text`** (resume / programmatic prompts): `content:[{type:"text",text:"Continue from where you left off."}]`
3. **Array content with `tool_result`** (the response to a previous `tool_use`):
   ```json
   {"message":{"role":"user","content":[
     {"type":"tool_result","tool_use_id":"toolu_…",
      "is_error":false, "content":"<stdout as string>"}
   ]}}
   ```

`is_error` is `false` for success, `null` (not `false`) for many normal cases, and `true` on actual failure. Don't treat `null` as truthy.

There is also an envelope variant where `message.content` is a string but the string is `"<local-command-caveat>Caveat: The messages below were generated by the user while running local commands. DO NOT respond to these messages …</local-command-caveat>"` or `"<command-name>/effort</command-name>\n<command-message>effort</command-message>\n<command-args></command-args>"`. These are slash-command echoes.

### 1.5 Compaction

Compaction is **inlined as a synthetic user record** within the same file. Exact shape (truncated):

```json
{"parentUuid":"…","isSidechain":false,"promptId":"…","type":"user",
 "message":{"role":"user",
   "content":"This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n1. **Primary Request and Intent:**\n…\n\nIf you need specific details from before compaction…, read the full transcript at: ~/.claude/projects/-Users-erichowens-coding-port-daddy/d4e7c76e-…jsonl\nContinue the conversation from where it left off without asking the user any further questions. Resume directly…"
 },
 "isVisibleInTranscriptOnly":true,
 "isCompactSummary":true,
 "uuid":"430dab59-…","timestamp":"2026-04-20T14:52:26.391Z",
 "userType":"external","entrypoint":"cli",
 "cwd":"~/coding/port-daddy",
 "sessionId":"d4e7c76e-…","version":"2.1.114",
 "gitBranch":"main","slug":"peaceful-hugging-dongarra"}
```

**Detection predicate**: `record.type === "user" && record.isCompactSummary === true`. Records before this one are pre-compact; records after are post-compact. The `parentUuid` chain links it cleanly to the prior turn.

There is no `type: "summary"` record. There is no separate `.summary.jsonl` sidecar. Several `.jsonl` files in the port-daddy project have zero compaction events (sessions short enough to never hit the limit).

### 1.6 Sidechains

`isSidechain` is a boolean on every conversational record. I sampled multiple transcripts and **did not find `isSidechain: true`** in any port-daddy or erichowensdotcom session, even ones using `TaskCreate`. The mechanism exists in the schema for spawning sub-agent conversations, but it appears to be rarely emitted in this corpus, possibly because subagents now get their own session files. Implementer should treat `isSidechain: true` records as part of a parent conversation but logically distinct (different turn DAG).

### 1.7 File-history snapshots

```json
{"type":"file-history-snapshot",
 "messageId":"22c5c2ff-…",
 "snapshot":{
   "messageId":"22c5c2ff-…",
   "trackedFileBackups":{},
   "timestamp":"2026-04-19T06:18:55.743Z"},
 "isSnapshotUpdate":false}
```

These are checkpoint records for Claude Code's file undo system. Useful as integrity anchors (you know the file state Claude believed it was working against at that point in the conversation). `trackedFileBackups` keys are absolute paths.

### 1.8 Side-channel tool results

In `~/.claude/projects/-Users-erichowens-coding-dominic/` and `~/.claude/projects/-Users-erichowens-coding-port-daddy/` I found:

```
-Users-erichowens-coding-dominic/
  38261b8c-7dec-4d47-b0cc-f5ecd2fcce88.jsonl    # 13 MB transcript
  38261b8c-7dec-4d47-b0cc-f5ecd2fcce88/         # sidecar directory
    tool-results/
      bxu6lm8n7.txt                              # 115 KB
```

When a tool result is too large to inline, Claude writes a `<persisted-output>` stub into the jsonl pointing at the side-channel file. **PD ingestion must resolve these.** The directory name matches the session id (no `.jsonl` extension).

### 1.9 Size profile (3,811 jsonl files across all projects)

| metric | bytes | reading |
|---|---|---|
| min | 1,872 | empty session, just session_meta + a stop |
| median | 193,175 | ~190 KB |
| p95 | 830,929 | ~810 KB |
| max | 42,661,360 | ~40 MB |

For port-daddy specifically, large active transcripts are routinely 10–26 MB. A tailer must handle multi-MB files and partial lines at EOF. Append rate is reasonable (kB/s during active turns, idle otherwise).

---

## 2. Codex CLI

### 2.1 Directory layout

`~/.codex/` is the root. **`~/.cache/codex/` and `~/.config/codex/` do not exist.** `~/Library/Application Support/Codex/` exists but is the **Electron desktop Codex app** (`blob_storage`, `Cookies`, `Local Storage`, etc.) — NOT the CLI. Ignore it for CLI transcript ingestion.

```
~/.codex/
  sessions/
    2025/<MM>/<DD>/rollout-<ISO>-<sessionId>.jsonl   # 1,158 session files
    2026/<MM>/<DD>/...
  agents/
  memories/                                           # writable to Codex sandbox
  shell_snapshots/
  config.toml                                         # user config
  auth.json                                           # OAuth credentials (private)
  history.jsonl                                       # cross-session input history (558 KB)
  session_index.jsonl                                 # session → thread_name map (86 entries)
  logs_2.sqlite                                       # 313 MB ops log
  state_5.sqlite                                      # 16 MB state
  models_cache.json
  AGENTS.md -> /Users/erichowens/AGENTS.md            # symlink
```

**Filename**: `rollout-YYYY-MM-DDTHH-MM-SS-<sessionId>.jsonl`, e.g.
`rollout-2026-05-17T10-43-50-019e3709-8294-7a31-9eb7-82f7a550588b.jsonl`.

`sessionId` is a UUIDv7 (note the `019e3709-...` time-prefixed form). It also appears inside the file's `session_meta` record.

**`session_index.jsonl`** is an inverted index: `{id, thread_name, updated_at}`. Useful for ingestion because it gives the *human-named* thread label, but it covers only 86 of the 1,158 sessions on disk — not authoritative.

### 2.2 Record taxonomy

Every line is `{"timestamp":"<ISO>","type":"<top-level>","payload":{...}}`.

Top-level `type` values from a sample 246-line session:

```
188  response_item          # the conversation stream
 57  event_msg              # daemon-side events (token counts, task start/end, …)
  1  turn_context           # written at session start, carries sandbox policy
  1  session_meta           # written at session start
```

**Stable session-start preamble** (always lines 1–2):

```json
{"timestamp":"2026-05-17T17:43:58.643Z","type":"session_meta",
 "payload":{"id":"019e3709-…","timestamp":"…","cwd":"~/coding/port-daddy",
            "originator":"Codex Desktop","cli_version":"0.131.0-alpha.9",
            "source":"exec","model_provider":"openai",
            "base_instructions":{"text":"You are Codex, a coding agent based on GPT-5. …",
                                 …}}}
{"timestamp":"…","type":"turn_context",
 "payload":{"turn_id":"019e3709-866a-…","cwd":"~/coding/port-daddy",
            "current_date":"2026-05-17","timezone":"America/Los_Angeles",
            "approval_policy":"never",
            "sandbox_policy":{"type":"workspace-write",
                              "writable_roots":["~/.codex/memories"],
                              "network_access":false,…},
            "permission_profile":{…full filesystem access matrix…}}}
```

The `base_instructions.text` is the entire Codex system prompt (multi-KB of personality + editing rules + tool docs). Pre-redact it before ingesting into PD; it's identical across all sessions and adds noise.

**`response_item` payload types:**

| `payload.type` | `payload.role` | Notes |
|---|---|---|
| `message` | `developer` | Contains inlined `AGENTS.md` and permission instructions. **Redaction candidate.** |
| `message` | `user` | The actual user prompt (or system-prefixed prompt) |
| `message` | `assistant` | Model output |
| `function_call` | — | Tool invocation, `{name, call_id, arguments: <json-string>}` |
| `function_call_output` | — | Tool result, `{call_id, output: <string>}` — output begins with `"Chunk ID: …\nWall time: …s\nProcess exited with code N\nOriginal token count: …\nOutput:\n…"` |
| `custom_tool_call` | — | `apply_patch` and similar — input is the raw patch text |
| `custom_tool_call_output` | — | Result of `apply_patch` etc. |
| `reasoning` | — | `{summary:[], content:[], encrypted_content:"<base64>"}` — **opaque chain-of-thought** |
| `web_search_call` | — | Web search request |

**`event_msg` payload types observed:**

- `task_started` — `{turn_id, started_at, model_context_window: 258400, collaboration_mode_kind: "default"}`
- `task_complete` — `{completed_at, duration_ms, time_to_first_token_ms, last_agent_message: "<final assistant text>"}`
- `agent_message` — duplicate of an assistant message (delivered as event)
- `user_message` — duplicate of a user message
- `patch_apply_end` — file edit completion
- `web_search_end`
- `token_count` — full rate-limit envelope: `{info:null, rate_limits:{limit_id:"codex", primary:{used_percent, window_minutes, resets_at}, secondary:{...}, credits:null, plan_type:"pro", rate_limit_reached_type:null}}`

### 2.3 Session lifecycle

- **Start**: `session_meta` then `turn_context`.
- **Each turn**: `task_started` event → some number of `response_item`s (user message, reasoning, function_call, function_call_output, assistant message) → `task_complete` event.
- **End**: there is no explicit "session_end". File goes quiet. To detect "session done", you wait for sustained mtime quiescence after the last `task_complete`.

There is **no compaction marker** equivalent in Codex transcripts that I could find. Codex sessions also tend to be shorter and the CLI may simply spawn a new session file when context is exhausted.

### 2.4 Function-call argument shape

Arguments are stored as a **JSON-encoded string**, not as a nested object:

```json
{"payload":{"type":"function_call",
 "name":"exec_command",
 "call_id":"call_hCaDRxKRHx58rkV6VweWtfm8",
 "arguments":"{\"cmd\":\"ls -la\",\"workdir\":\"~/coding/port-daddy\",\"max_output_tokens\":...,\"yield_time_ms\":...}"}}
```

Observed tool names: `exec_command`, `write_stdin`, `apply_patch` (as `custom_tool_call`).

### 2.5 Size profile (1,155 jsonl files)

| metric | bytes | reading |
|---|---|---|
| min | 42,942 | bare-minimum session (preamble dominates) |
| median | 599,044 | ~585 KB |
| p95 | 19,986,540 | ~19 MB |
| max | 465,072,200 | **~465 MB — outlier, a runaway session** |

Codex sessions are larger on average than Claude sessions because of the inlined system prompt + `developer` message dumping `AGENTS.md`. The 465 MB outlier deserves a flag — long-running agent runs can produce gigantic transcripts; PD must cap ingestion size or stream.

---

## 3. Practical capture concerns

### 3.1 Atomicity and partial-line risk

- Both tools write directly to the session file. **No `.tmp` shadow file, no rename-on-close.** I scanned both directories: zero `*.tmp*` or `*.swp` files. Writes are direct `O_APPEND`.
- Both files terminate every complete record with `\n`. Both files I inspected ended in `}\n` (no trailing junk).
- **A tailer that uses "split on `\n`, parse each line as JSON" is safe as long as it never tries to parse a chunk that doesn't end in `\n`.** Use a line-buffered reader (e.g. `readline` on the file descriptor, watching for size changes via `fs.watch` or `inotify`/FSEvents). Hold any trailing partial line until the next newline arrives.
- For Node, a tail implementation should `fs.open(..., 'r')`, track byte offset, and on each watch event read from offset → current size, split at the **last** `\n`, parse complete lines, and stash the remainder.
- Concurrent reads while the agent writes are fine on macOS (the writer holds no exclusive lock). Don't try to `flock` the file.

### 3.2 Rotation, renaming, atomic-replace

- **Neither tool rotates.** A single session = a single file, forever. There is no `.1`/`.2` rotation, no compression, no archive directory.
- **Neither tool renames the file on session end.** The session id remains stable from creation through whatever final write happens.
- This means a stable file id is `(<encoded-cwd-dir>, <sessionId>)` for Claude and `<sessionId>` (UUIDv7) for Codex. Inode is also stable since there's no rename.
- Both file trees have `.DS_Store` entries (macOS Finder). Skip them.

### 3.3 What's sensitive — default-redaction candidates

**High priority (do not ingest raw):**
- Codex `session_meta.base_instructions.text` — full system prompt, includes "you are Codex" framing. Mostly stable boilerplate. Strip or replace with a content hash.
- Codex `developer` message (`payload.type=="message", payload.role=="developer"`) — contains a verbatim copy of `AGENTS.md`, sandbox-policy details, and absolute filesystem paths. Strip path absolutes; replace `AGENTS.md` body with a hash + length.
- Codex `turn_context.permission_profile.file_system.entries[].path.path` — full writable-root paths leak directory structure.
- Codex `token_count.rate_limits` — leaks plan tier (`"plan_type":"pro"`), used percentages, reset epochs. PII-adjacent.

**Medium priority:**
- Any `Bash` / `exec_command` tool input — commands routinely contain pasted secrets, API keys via env-var (`ANTHROPIC_API_KEY=...`), private file paths. Tool inputs deserve a secret-scanner pass.
- `function_call_output` and Claude `tool_result.content` — these are command stdout. They will contain anything `printenv`, `cat .env`, `gh auth status`, etc. produced.
- Claude `attachment.hook_success.stdout` / `.stderr` — hooks that read project state can spill secrets.
- Claude `cwd` and `gitBranch` fields — directory layout reveals project structure. Likely fine for PD's purposes since PD already tracks projects, but flag for any cross-org sharing.
- Claude `slug` — kebab-case session nickname. Sometimes derivative of user input.

**Low but-still-flag:**
- User name in env, prompts, paths. Both transcripts contain literal `erichowens` in dozens of fields.
- Git branch names — sometimes encode ticket numbers / customer names.
- `assistant.thinking.signature` (Claude) and `reasoning.encrypted_content` (Codex) are opaque blobs but should still be treated as model-internal artifacts not exposed.

**Bare key scan**: I grepped both samples for `sk-ant`, `sk_live`, `sk-proj`, `ANTHROPIC_API`, `GEMINI_API`, `API_KEY` literal — no real key material in the sessions I sampled, but the substring `ANTHROPIC_API_KEY` appears in Codex `base_instructions` and similar boilerplate. False positives are likely; use an entropy-based scanner alongside any name-based scanner.

### 3.4 Active-session identification

For a tailer to know which file is active:

- **Claude**: file with most recent mtime under `~/.claude/projects/<encoded-cwd>/`. Multiple may be simultaneously active (parallel terminals). Resolve canonical session via the `sessionId` field inside the file — never trust the filename alone.
- **Codex**: file with most recent mtime under `~/.codex/sessions/YYYY/MM/DD/`. UUIDv7 lets you sort filenames lexically to get chronological order.

### 3.5 Side-channel files PD must follow

- **Claude tool-results sidecar**: `~/.claude/projects/<encoded-cwd>/<sessionId>/tool-results/<short>.txt`. Detect by parsing `<persisted-output>… Full output saved to: <path>` in `tool_result.content`. Resolve and attach.
- **Codex memories writable area**: `~/.codex/memories/` is the only `writable_roots` entry. Agent-modified memory files live here and may be relevant to coordination context.

### 3.6 Schema versioning

- Claude records carry `version` (e.g. `"2.1.114"`, `"2.1.117"`). I saw both `2.1.114` and `2.1.117` in port-daddy alone. PD's parser should tolerate version drift and warn (don't fail) on unknown subtypes.
- Codex carries `cli_version` (e.g. `"0.131.0-alpha.9"`) inside `session_meta` but not on every record. Track per-session.

---

## 4. Quick implementer cheat sheet

```
# Watch all Claude transcripts for cwd == this project
PD_PROJECT=~/coding/port-daddy
ENCODED=$(echo "$PD_PROJECT" | sed 's|/|-|g')
DIR=~/.claude/projects/$ENCODED
# tail every *.jsonl in $DIR, line-buffered, JSON-parse each complete line

# Watch all Codex transcripts
find ~/.codex/sessions -name '*.jsonl' -newer <marker>
# filter by reading session_meta.payload.cwd == "$PD_PROJECT"

# Compaction detection (Claude only):
#   record.type === "user" && record.isCompactSummary === true
# Pre-compact records all share parentUuid chain rooted before this record.

# Tool-result sidecar resolver (Claude):
#   if tool_result.content matches /Full output saved to: (.+\.txt)/
#   resolve to that absolute path and attach

# Codex chain-of-thought:
#   you can't read it. record.payload.type === "reasoning" → payload.encrypted_content is opaque
```

---

## 5. Pointers, not data

The two reference transcripts that were most illuminating (not consumed by this run):

- Claude with compaction: `~/.claude/projects/-Users-erichowens-coding-port-daddy/d4e7c76e-31ce-4fd2-9b5e-83ba1fe13b3f.jsonl` (9.4 MB, contains exactly the compaction shape shown above)
- Claude with side-channel tool result: `~/.claude/projects/-Users-erichowens-coding-dominic/38261b8c-7dec-4d47-b0cc-f5ecd2fcce88.jsonl` + sibling `38261b8c-…/tool-results/bxu6lm8n7.txt`
- Codex full preamble: `~/.codex/sessions/2026/05/17/rollout-2026-05-17T10-43-50-019e3709-8294-7a31-9eb7-82f7a550588b.jsonl`
- Codex active-while-writing example (for atomicity testing): pick the newest mtime under `~/.codex/sessions/2026/05/` after starting a fresh Codex session.
