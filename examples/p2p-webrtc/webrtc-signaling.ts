#!/usr/bin/env bun

import { resolveDaemonUrl } from '../lib/daemon-url.js';

const DAEMON_URL = resolveDaemonUrl();

type InboxMessage = {
  id: number | string;
  from?: string;
  content?: unknown;
  payload?: unknown;
  message?: unknown;
};

function argValue(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${DAEMON_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} failed: HTTP ${res.status}`);
  }

  return (await res.json()) as T;
}

async function registerAgent(agentId: string, purpose: string) {
  await jsonFetch('/agents', {
    method: 'POST',
    body: JSON.stringify({ id: agentId, name: agentId, type: 'webrtc-demo', purpose }),
  });
}

async function unregisterAgent(agentId: string) {
  await fetch(`${DAEMON_URL}/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' }).catch(() => undefined);
}

async function sendInbox(agentId: string, from: string, content: unknown) {
  return jsonFetch<{ messageId?: number | string }>(`/agents/${encodeURIComponent(agentId)}/inbox`, {
    method: 'POST',
    body: JSON.stringify({ from, content: JSON.stringify(content), type: 'webrtc.signal' }),
  });
}

async function listInbox(agentId: string) {
  const data = await jsonFetch<{ messages?: InboxMessage[] }>(
    `/agents/${encodeURIComponent(agentId)}/inbox?unreadOnly=true`,
  );
  return data.messages ?? [];
}

async function markRead(agentId: string) {
  await fetch(`${DAEMON_URL}/agents/${encodeURIComponent(agentId)}/inbox/read-all`, { method: 'PUT' }).catch(
    () => undefined,
  );
}

function messageContent(message: InboxMessage) {
  const content = message.content ?? message.payload ?? message.message;
  if (typeof content === 'string') {
    try {
      return JSON.parse(content);
    } catch {
      return content;
    }
  }
  return content;
}

async function main() {
  const caller = argValue('--caller', 'agent-a');
  const receiver = argValue('--receiver', 'agent-b');

  console.log(`[webrtc-signaling] daemon=${DAEMON_URL}`);
  console.log(`[webrtc-signaling] caller=${caller} receiver=${receiver}`);

  await registerAgent(caller, 'WebRTC caller');
  await registerAgent(receiver, 'WebRTC receiver');

  try {
    const offer = {
      kind: 'WEBRTC_OFFER',
      sessionId: `rtc-${Date.now()}`,
      sdp: 'v=0\\no=- 46117326 2 IN IP4 127.0.0.1\\ns=Port Daddy demo offer',
      ice: [{ candidate: 'candidate:demo-caller udp 2122260223 10.0.0.2 49152 typ host' }],
    };

    const offerResult = await sendInbox(receiver, caller, offer);
    console.log(`[${caller}] sent offer to ${receiver} inbox id=${offerResult.messageId ?? 'unknown'}`);

    const receiverMessages = await listInbox(receiver);
    const receivedOffer = receiverMessages.map(messageContent).find((content: any) => content?.kind === 'WEBRTC_OFFER');
    if (!receivedOffer) {
      throw new Error(`${receiver} did not receive the offer`);
    }
    console.log(`[${receiver}] received offer session=${(receivedOffer as any).sessionId}`);

    const answer = {
      kind: 'WEBRTC_ANSWER',
      sessionId: (receivedOffer as any).sessionId,
      sdp: 'v=0\\no=- 46117327 2 IN IP4 127.0.0.1\\ns=Port Daddy demo answer',
      ice: [{ candidate: 'candidate:demo-receiver udp 2122260223 10.0.0.3 49153 typ host' }],
    };

    const answerResult = await sendInbox(caller, receiver, answer);
    console.log(`[${receiver}] sent answer to ${caller} inbox id=${answerResult.messageId ?? 'unknown'}`);

    const callerMessages = await listInbox(caller);
    const receivedAnswer = callerMessages.map(messageContent).find((content: any) => content?.kind === 'WEBRTC_ANSWER');
    if (!receivedAnswer) {
      throw new Error(`${caller} did not receive the answer`);
    }
    console.log(`[${caller}] received answer session=${(receivedAnswer as any).sessionId}`);

    await markRead(caller);
    await markRead(receiver);
    console.log('[webrtc-signaling] signaling exchange complete');
  } finally {
    await unregisterAgent(caller);
    await unregisterAgent(receiver);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
