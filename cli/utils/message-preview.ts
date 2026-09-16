/** Render durable message payloads without assuming every sender used a string. */
export function inboxMessagePreview(content: unknown, maxLength = 60): string {
  let text: string;
  if (typeof content === 'string') {
    text = content;
  } else {
    try {
      text = JSON.stringify(content) ?? String(content ?? '');
    } catch {
      text = String(content ?? '');
    }
  }
  return `${text.slice(0, maxLength)}${text.length > maxLength ? '...' : ''}`;
}

/**
 * Render an inbox message's sender honestly (#8877 / ADR-0122).
 *
 * The display layer used to print an unattributed message as coming from
 * "system" (`msg.from || 'system'`) — authority laundering: the daemon's own
 * name attached to a message nothing vouched for. There are three real
 * cases and they must look different:
 *
 *   - a credentialed send: the display name, plus the daemon-verified
 *     principal's soul class;
 *   - a daemon-internal send (parley, visual-task intake, suggestion-broker,
 *     surface-scan, the claim watcher): a name, but no credentialed
 *     principal behind it;
 *   - no sender recorded at all: say so, do not invent one.
 *
 * @param msg - The inbox message (from/fromActorId/fromSoulClass).
 * @returns A short sender label safe to print.
 */
export function inboxSenderLabel(msg: {
  from?: string | null;
  fromActorId?: string | null;
  fromSoulClass?: string | null;
}): string {
  const display = typeof msg.from === 'string' && msg.from.trim() ? msg.from.trim() : null;
  const actorId = typeof msg.fromActorId === 'string' && msg.fromActorId.trim()
    ? msg.fromActorId.trim()
    : null;
  if (!display) return '(unattributed)';
  if (!actorId) return `${display} (daemon-internal)`;
  const soulClass = typeof msg.fromSoulClass === 'string' && msg.fromSoulClass.trim()
    ? msg.fromSoulClass.trim()
    : null;
  return soulClass ? `${display} (${soulClass})` : display;
}
