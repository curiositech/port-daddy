#!/usr/bin/env bun
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolveDaemonUrl } from '../lib/daemon-url.js';

const PORT = Number(process.env.PORT ?? 8787);
const DAEMON_URL = resolveDaemonUrl();
const CHANNEL = process.env.PD_TUBE_CHANNEL ?? 'chat:mentions';
const TUBE_KIND = 'tube.msg';

type TubeEnvelope = {
  v: 1;
  kind: typeof TUBE_KIND;
  body: string;
  inReplyTo?: number;
};

function channelUrl() {
  return `${DAEMON_URL}/msg/${encodeURIComponent(CHANNEL)}`;
}

function tubeEnvelope(body: unknown, inReplyTo?: number): TubeEnvelope {
  const text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  return inReplyTo ? { v: 1, kind: TUBE_KIND, body: text, inReplyTo } : { v: 1, kind: TUBE_KIND, body: text };
}

async function publishTube(body: unknown, sender = 'local-webhook') {
  const res = await fetch(channelUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender, payload: tubeEnvelope(body) }),
  });

  if (!res.ok) {
    throw new Error(`Port Daddy publish failed: HTTP ${res.status}`);
  }

  return (await res.json()) as { id: number };
}

async function readMessages(after: number) {
  const res = await fetch(`${channelUrl()}?after=${after}`);
  if (!res.ok) {
    throw new Error(`Port Daddy read failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as { messages?: Array<{ id: number; sender?: string; payload?: unknown }> };
  return data.messages ?? [];
}

function decodeTubePayload(message: { payload?: unknown }) {
  const payload = message.payload;
  if (!payload || typeof payload !== 'object') return null;
  const envelope = payload as Partial<TubeEnvelope>;
  return envelope.kind === TUBE_KIND ? envelope : null;
}

async function waitForReply(parentId: number, timeoutMs = 120000) {
  let cursor = parentId;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const messages = await readMessages(cursor);
    for (const message of messages) {
      cursor = Math.max(cursor, message.id);
      const payload = decodeTubePayload(message);
      if (payload?.inReplyTo === parentId) {
        return { sender: message.sender, body: payload.body, messageId: message.id };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
  }

  return null;
}

async function readJsonBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req as any) {
    chunks.push(Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  return JSON.parse(text);
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload, null, 2));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `127.0.0.1:${PORT}`}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, channel: CHANNEL, agentCommand: `pd tube ${CHANNEL}` });
      return;
    }

    if (req.method !== 'POST' || !['/webhook', '/slack', '/discord', '/linear'].includes(url.pathname)) {
      sendJson(res, 404, {
        error: 'POST /webhook, /slack, /discord, or /linear',
        example: `curl -sS http://127.0.0.1:${PORT}/webhook -H 'Content-Type: application/json' -d '{"text":"hello"}'`,
      });
      return;
    }

    const incoming = await readJsonBody(req);
    const event = {
      kind: 'webhook.mention',
      route: url.pathname,
      headers: {
        'user-agent': req.headers['user-agent'],
        'x-slack-signature': req.headers['x-slack-signature'] ? '[present]' : undefined,
        'linear-delivery': req.headers['linear-delivery'],
      },
      body: incoming,
      ask: 'Handle this webhook using the current repo context, then reply with the answer that should go back to the caller.',
      at: new Date().toISOString(),
    };

    const posted = await publishTube(event);
    const wait = url.searchParams.get('wait') !== '0';

    if (!wait) {
      sendJson(res, 202, {
        published: true,
        channel: CHANNEL,
        messageId: posted.id,
        agentCommand: `pd tube ${CHANNEL}`,
        replyCommand: `printf '%s\\n' "answer" | pd tube ${CHANNEL} --reply ${posted.id}`,
      });
      return;
    }

    const reply = await waitForReply(posted.id);
    sendJson(res, reply ? 200 : 202, {
      published: true,
      channel: CHANNEL,
      messageId: posted.id,
      agentCommand: `pd tube ${CHANNEL}`,
      replyCommand: `printf '%s\\n' "answer" | pd tube ${CHANNEL} --reply ${posted.id}`,
      reply,
    });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[local-webhook-to-agent] listening on http://127.0.0.1:${PORT}`);
  console.log(`[local-webhook-to-agent] agent side: pd tube ${CHANNEL}`);
});
