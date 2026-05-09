# Swarm Researcher Template

A multi-agent research swarm that scrapes the web, synthesizes information, and produces a final report, coordinated entirely by Port Daddy.

## Architecture

1.  **Search Node:** Given a topic, queries Google/DuckDuckGo and publishes URLs to the `research:urls` channel.
2.  **Scraper Agents (x5):** A pool of 5 agents subscribe to `research:urls`. They use Port Daddy Distributed Locks (`pd lock acquire scrape:domain.com`) to ensure they don't hammer the same domain simultaneously.
3.  **Synthesizer Agent:** Waits for a `research:complete` signal, then reads all findings from the other agents' Session Notes to produce a final markdown report.

## Setup

```bash
pd start
pd up
pd pub research:start '{"topic": "The future of agentic orchestration"}'
```

## How it uses Port Daddy
*   **Distributed Locks:** Prevents rate-limiting by coordinating which agent scrapes which domain.
*   **Session Notes:** Agents dump their findings into immutable session notes, which the Synthesizer agent later reads using `pd notes --session <id>`.
*   **Agent Inbox:** The Synthesizer sends direct messages to scrapers if they return malformed data.
