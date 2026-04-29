"use client";

import { useState, useEffect, useRef, useCallback, useId } from "react";
import { MessageCircle, Heart, Reply, Send, Loader2 } from "lucide-react";
import { Surface } from "@/components/ui/Surface";
import { Badge } from "@/components/ui/Badge";

// ── Types ───────────────────────────────────────────────────

interface Comment {
  id: string;
  post_slug: string;
  parent_id: string | null;
  author_name: string;
  body: string;
  likes: number;
  created_at: string;
}

interface BlogCommentsProps {
  slug: string;
}

// ── Helpers ─────────────────────────────────────────────────

/**
 * Signal flag palette for deterministic avatar colors.
 * Each entry maps to a CSS custom property from the harbor heritage tokens.
 */
const SIGNAL_FLAG_COLORS = [
  { bg: "var(--signal-charlie)", text: "var(--text-inverse)" },
  { bg: "var(--signal-kilo)", text: "var(--text-inverse)" },
  { bg: "var(--surface-strong)", text: "var(--text-primary)" },
  { bg: "var(--signal-victor)", text: "var(--text-inverse)" },
  { bg: "var(--brand-secondary)", text: "var(--text-inverse)" },
  { bg: "var(--brand-accent)", text: "var(--brand-accent-foreground)" },
  { bg: "var(--signal-lima)", text: "var(--text-inverse)" },
] as const;

function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return SIGNAL_FLAG_COLORS[Math.abs(h) % SIGNAL_FLAG_COLORS.length];
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso + "Z").getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

/**
 * Render a safe subset of markdown to HTML.
 * Only allows: bold, italic, inline code, fenced code blocks, links, line breaks.
 */
function renderMd(text: string): string {
  return (
    text
      // Escape HTML entities first
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // Fenced code blocks
      .replace(/```[\w]*\n?([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
      // Inline code (must come after fenced blocks)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // Bold
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      // Italic
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      // Links — only http(s)
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
        '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>'
      )
      // Line breaks
      .replace(/\n/g, "<br>")
  );
}

/**
 * DOM-based HTML sanitizer. Whitelist: STRONG, EM, CODE, PRE, A, BR, #text.
 * Strips all attributes except href/rel/target on anchors.
 * This runs client-side only; on the server it returns raw HTML.
 */
function sanitize(html: string): string {
  if (typeof document === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const allowed = new Set([
    "STRONG",
    "EM",
    "CODE",
    "PRE",
    "A",
    "BR",
    "#text",
  ]);
  function walk(node: Node) {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        if (!allowed.has(el.tagName)) {
          const text = document.createTextNode(el.textContent || "");
          node.replaceChild(text, child);
        } else {
          for (const attr of Array.from(el.attributes)) {
            if (
              el.tagName === "A" &&
              ["href", "rel", "target"].includes(attr.name)
            )
              continue;
            el.removeAttribute(attr.name);
          }
          if (el.tagName === "A") {
            el.setAttribute("rel", "noopener noreferrer");
            el.setAttribute("target", "_blank");
          }
          walk(child);
        }
      }
    }
  }
  walk(doc.body);
  return doc.body.innerHTML;
}

// ── Avatar ──────────────────────────────────────────────────

function Avatar({ name }: { name: string }) {
  const c = avatarColor(name);
  const initial = name.charAt(0).toUpperCase();
  return (
    <div
      className="w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center text-sm font-semibold select-none"
      style={{ backgroundColor: c.bg, color: c.text }}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}

// ── CommentCard ─────────────────────────────────────────────

function CommentCard({
  comment,
  replies,
  isReply,
  replyTo,
  onSetReplyTo,
  onSubmitReply,
  onLike,
}: {
  comment: Comment;
  replies?: Comment[];
  isReply?: boolean;
  replyTo: string | null;
  onSetReplyTo: (id: string | null) => void;
  onSubmitReply: (name: string, body: string, parentId: string) => Promise<void>;
  onLike: (id: string) => void;
}) {
  const html = sanitize(renderMd(comment.body));

  const cardContent = (
    <div className="flex items-start gap-3">
      <Avatar name={comment.author_name} />
      <div className="flex-1 min-w-0">
        {/* Author + time */}
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Badge variant="teal" size="sm">
            {comment.author_name}
          </Badge>
          <span
            className="text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            {timeAgo(comment.created_at)}
          </span>
        </div>

        {/* Body — sanitized markdown output */}
        <div
          className="text-sm leading-relaxed [&_a]:underline [&_a]:text-[var(--brand-secondary)] [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_code]:bg-[var(--surface-sunken)] [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:my-2 [&_pre]:bg-[var(--surface-sunken)] [&_pre]:overflow-x-auto"
          style={{ color: "var(--text-primary)" }}
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {/* Actions */}
        <div className="flex items-center gap-4 mt-2">
          <button
            onClick={() => onLike(comment.id)}
            className="flex items-center gap-1 text-xs transition-colors"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--brand-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-muted)";
            }}
            aria-label="Like comment"
          >
            <Heart
              className="w-3.5 h-3.5"
              fill={comment.likes > 0 ? "currentColor" : "none"}
            />
            {comment.likes > 0 && <span>{comment.likes}</span>}
          </button>
          {!isReply && (
            <button
              onClick={() =>
                onSetReplyTo(replyTo === comment.id ? null : comment.id)
              }
              className="flex items-center gap-1 text-xs transition-colors"
              style={{ color: "var(--text-muted)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--brand-secondary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-muted)";
              }}
              aria-label="Reply to comment"
            >
              <Reply className="w-3.5 h-3.5" />
              Reply
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (isReply) {
    return (
      <Surface depth="inset" radius="xl" padding="sm">
        {cardContent}
      </Surface>
    );
  }

  return (
    <Surface depth="flat" radius="xl" padding="md">
      {cardContent}

      {/* Replies */}
      {replies && replies.length > 0 && (
        <div
          className="ml-11 mt-3 pl-3 space-y-3"
          style={{ borderLeft: "2px solid var(--brand-secondary)" }}
        >
          {replies.map((r) => (
            <CommentCard
              key={r.id}
              comment={r}
              isReply
              replyTo={replyTo}
              onSetReplyTo={onSetReplyTo}
              onSubmitReply={onSubmitReply}
              onLike={onLike}
            />
          ))}
        </div>
      )}

      {/* Inline reply form */}
      {replyTo === comment.id && (
        <div className="ml-11 mt-3">
          <CommentForm
            onSubmit={(name, body) => onSubmitReply(name, body, comment.id)}
            onCancel={() => onSetReplyTo(null)}
            compact
          />
        </div>
      )}
    </Surface>
  );
}

// ── CommentForm ─────────────────────────────────────────────

function CommentForm({
  onSubmit,
  onCancel,
  compact,
}: {
  onSubmit: (name: string, body: string) => Promise<void>;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const nameId = useId();
  const bodyId = useId();
  const bodyHelpId = useId();
  const errorId = useId();
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Persist name in localStorage
  useEffect(() => {
    const saved = localStorage.getItem("portdaddy-comment-name");
    if (saved) setName(saved);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimName = name.trim();
    const trimBody = body.trim();

    if (!trimName) {
      setError("Please enter your name.");
      return;
    }
    if (!trimBody || trimBody.length < 3) {
      setError("Comment must be at least 3 characters.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      localStorage.setItem("portdaddy-comment-name", trimName);
      await onSubmit(trimName, trimBody);
      setBody("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to post comment.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Name field */}
      <div className={compact ? "mb-2" : "mb-3"}>
        <label
          htmlFor={nameId}
          className="block mb-1 text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          Name
        </label>
        <Surface depth="inset" radius="lg" padding="none" className="max-w-xs">
          <input
            id={nameId}
            name="authorName"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder="Your name"
            className="w-full px-3 py-1.5 text-sm bg-transparent outline-none"
            style={{ color: "var(--text-primary)" }}
            aria-invalid={error && !name.trim() ? "true" : "false"}
          />
        </Surface>
      </div>

      {/* Honeypot -- invisible to humans, bots will fill it */}
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <input type="text" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      {/* Body */}
      <div className={compact ? "mb-2" : "mb-3"}>
        <label
          htmlFor={bodyId}
          className="block mb-1 text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          Comment
        </label>
        <Surface depth="inset" radius="lg" padding="none">
          <textarea
            id={bodyId}
            name="commentBody"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={3000}
            rows={compact ? 3 : 4}
            placeholder="Write a comment..."
            className="w-full px-3 py-2 text-sm bg-transparent outline-none resize-y"
            style={{
              color: "var(--text-primary)",
              minHeight: compact ? "60px" : "80px",
            }}
            aria-describedby={error ? `${bodyHelpId} ${errorId}` : bodyHelpId}
            aria-invalid={error && (!body.trim() || body.trim().length < 3) ? "true" : "false"}
          />
        </Surface>
        <p
          id={bodyHelpId}
          className="text-xs mt-1"
          style={{ color: "var(--text-muted)" }}
        >
          Markdown: **bold** *italic* `code` [link](url)
        </p>
      </div>

      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-xs mb-2 font-medium"
          style={{ color: "var(--status-error)" }}
        >
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: "var(--brand-primary)",
            color: "var(--text-inverse)",
            boxShadow: "var(--shadow-sm)",
          }}
          onMouseEnter={(e) => {
            if (!submitting) {
              e.currentTarget.style.boxShadow = "var(--shadow-flat)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = "var(--shadow-sm)";
          }}
        >
          {submitting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          {compact ? "Reply" : "Post Comment"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 rounded-xl text-xs font-medium transition-colors"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-muted)";
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

// ── JumpToDiscussion ────────────────────────────────────────

export function JumpToDiscussion({ count }: { count?: number }) {
  return (
    <a
      href="#comments"
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all"
      style={{
        background: "var(--surface-sunken)",
        boxShadow: "var(--shadow-pressed)",
        color: "var(--text-secondary)",
      }}
    >
      <MessageCircle className="w-3.5 h-3.5" />
      {count != null ? `Discussion (${count})` : "Jump to Discussion"}
    </a>
  );
}

// ── Main Component ──────────────────────────────────────────

export function BlogComments({ slug }: BlogCommentsProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Lazy load: only fetch when the section scrolls into view
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loaded) {
          setLoaded(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [loaded]);

  // Fetch comments once visible
  useEffect(() => {
    if (!loaded) return;
    setLoading(true);
    fetch(`/api/comments?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((data) => setComments(data.comments ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [loaded, slug]);

  // Thread organization
  const topLevel = comments.filter((c) => !c.parent_id);
  const repliesMap = new Map<string, Comment[]>();
  for (const c of comments) {
    if (c.parent_id) {
      const arr = repliesMap.get(c.parent_id) ?? [];
      arr.push(c);
      repliesMap.set(c.parent_id, arr);
    }
  }

  // Handlers
  const handlePost = useCallback(
    async (name: string, body: string, parentId?: string) => {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          parentId: parentId ?? undefined,
          authorName: name,
          body,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to post comment");
      }

      if (data.comment) {
        setComments((prev) => [...prev, data.comment]);
      }
      setReplyTo(null);
    },
    [slug]
  );

  const handleLike = useCallback(async (commentId: string) => {
    const res = await fetch("/api/comments/like", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId }),
    });

    if (!res.ok) return;
    const data = await res.json();

    setComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, likes: data.likes } : c))
    );
  }, []);

  return (
    <section id="comments" className="mt-16">
      {/* Intersection Observer sentinel */}
      <div ref={sentinelRef} />

      <Surface depth="raised" radius="2xl" padding="none">
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 rounded-t-2xl"
          style={{
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <div className="flex items-center gap-2">
            <MessageCircle
              className="w-5 h-5"
              style={{ color: "var(--brand-secondary)" }}
            />
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              Discussion
              {!loading && loaded ? ` (${comments.length})` : ""}
            </h2>
          </div>
        </div>

        {/* Body */}
        <div className="p-6">
          {loading ? (
            <div
              className="flex items-center justify-center py-8 gap-2"
              style={{ color: "var(--text-muted)" }}
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-xs font-medium">Loading comments...</span>
            </div>
          ) : !loaded ? (
            <div className="py-8 text-center">
              <span
                className="text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                Scroll down to load comments
              </span>
            </div>
          ) : (
            <>
              {/* Comment list */}
              {topLevel.length === 0 ? (
                <Surface depth="inset" radius="xl" padding="md" className="mb-6">
                  <p
                    className="text-sm text-center"
                    style={{ color: "var(--text-muted)" }}
                  >
                    No comments yet. Be the first to share your thoughts.
                  </p>
                </Surface>
              ) : (
                <div className="space-y-4 mb-6">
                  {topLevel.map((c) => (
                    <CommentCard
                      key={c.id}
                      comment={c}
                      replies={repliesMap.get(c.id)}
                      replyTo={replyTo}
                      onSetReplyTo={setReplyTo}
                      onSubmitReply={(name, body, parentId) =>
                        handlePost(name, body, parentId)
                      }
                      onLike={handleLike}
                    />
                  ))}
                </div>
              )}

              {/* Compose form */}
              <div
                className="pt-6"
                style={{ borderTop: "1px solid var(--border-subtle)" }}
              >
                <h3
                  className="text-sm font-semibold mb-4"
                  style={{ color: "var(--text-primary)" }}
                >
                  Leave a comment
                </h3>
                <Surface depth="raised" radius="xl" padding="md">
                  <CommentForm
                    onSubmit={(name, body) => handlePost(name, body)}
                  />
                </Surface>
              </div>
            </>
          )}
        </div>
      </Surface>
    </section>
  );
}
