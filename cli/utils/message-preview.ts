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
