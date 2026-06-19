import * as React from "react";
import { cn } from "@/lib/utils";
import { Copy, Check } from "lucide-react";

/* ── Syntax highlighting ──────────────────────────────────────────────────── */

function highlightBash(line: string): React.ReactNode {
  if (!line.trim()) return "\u00A0";
  if (line.trimStart().startsWith("#"))
    return <span style={{ color: "var(--code-comment)" }}>{line}</span>;
  if (line.trimStart().startsWith("$")) {
    const indent = line.match(/^(\s*)/)?.[1] ?? "";
    const rest = line.trimStart().slice(2);
    return (
      <>
        {indent}
        <span style={{ color: "var(--code-prompt)", fontWeight: 600 }}>$ </span>
        {highlightArgs(rest)}
      </>
    );
  }
  return <span style={{ color: "var(--code-output)" }}>{line}</span>;
}

/** Color semantic identities: project:stack:context */
function highlightIdentity(id: string): React.ReactNode {
  const parts = id.split(":");
  const colors = [
    "var(--code-channel-scope)",
    "var(--code-channel-topic)",
    "var(--code-channel-qualifier)",
  ];
  return (
    <>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: "var(--code-channel-sep)" }}>:</span>}
          <span
            style={{
              color: colors[i] || colors[colors.length - 1],
              fontWeight: 600,
            }}
          >
            {part}
          </span>
        </React.Fragment>
      ))}
    </>
  );
}

function highlightArgs(text: string): React.ReactNode {
  const tokens: React.ReactNode[] = [];
  const regex =
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(--?[\w-]+)|(&&|\||;)|(\S+)/g;
  let m: RegExpExecArray | null;
  let lastIndex = 0;
  let isFirst = true;

  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) tokens.push(text.slice(lastIndex, m.index));
    lastIndex = m.index + m[0].length;
    const [full, str, flag, op, word] = m;
    if (str)
      tokens.push(
        <span key={m.index} style={{ color: "var(--code-string)" }}>
          {full}
        </span>,
      );
    else if (flag)
      tokens.push(
        <span key={m.index} style={{ color: "var(--code-flag)" }}>
          {full}
        </span>,
      );
    else if (op) {
      tokens.push(
        <span key={m.index} style={{ color: "var(--code-comment)" }}>
          {full}
        </span>,
      );
      isFirst = true;
    } else if (word) {
      if (isFirst)
        tokens.push(
          <span
            key={m.index}
            style={{ color: "var(--code-command)", fontWeight: 600 }}
          >
            {full}
          </span>,
        );
      else if (full.includes(":") && /^[\w.*-]+:[\w.*-]+/.test(full))
        tokens.push(<span key={m.index}>{highlightIdentity(full)}</span>);
      else
        tokens.push(
          <span key={m.index} style={{ color: "var(--code-text)" }}>
            {full}
          </span>,
        );
    }
    if (word || str) isFirst = false;
  }
  if (lastIndex < text.length) tokens.push(text.slice(lastIndex));
  return <>{tokens}</>;
}

function highlightTS(line: string): React.ReactNode {
  if (!line.trim()) return "\u00A0";
  if (line.trimStart().startsWith("//"))
    return <span style={{ color: "var(--code-comment)" }}>{line}</span>;
  const parts: React.ReactNode[] = [];
  const kwRegex =
    /\b(import|export|from|const|let|var|async|await|function|return|if|else|new|typeof|class|interface|type)\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = kwRegex.exec(line)) !== null) {
    if (m.index > last)
      parts.push(highlightTSStrings(line.slice(last, m.index)));
    parts.push(
      <span
        key={m.index}
        style={{ color: "var(--code-command)", fontWeight: 600 }}
      >
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push(highlightTSStrings(line.slice(last)));
  return <>{parts}</>;
}

function highlightTSStrings(text: string): React.ReactNode {
  const strRegex = /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = strRegex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <span key={m.index} style={{ color: "var(--code-string)" }}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/* ── Component ───────────────────────────────────────────────────────────── */

interface CodeBlockProps {
  children: React.ReactNode;
  language?: string;
  filename?: string;
  className?: string;
  copyable?: boolean;
  showHeaderLabel?: boolean;
}

export function CodeBlock({
  children,
  language,
  filename,
  className,
  copyable = true,
  showHeaderLabel = true,
}: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false);
  const headerLabel = filename || language;

  // Extract text content from children, handling JSX whitespace nodes
  const textContent = React.Children.toArray(children)
    .map((c) => (typeof c === "string" ? c : ""))
    .join("")
    .trim();

  const handleCopy = () => {
    navigator.clipboard.writeText(textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className={cn(
        "code-block-wrapper relative w-full max-w-full min-w-0 overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--code-bg)]",
        className,
      )}
    >
      {/* Compact header: dots + filename + copy */}
      <div className="flex min-w-0 items-center gap-[var(--space-1)] border-b-2 border-[var(--border-strong)] bg-[var(--code-header-bg)] px-[var(--space-3)] py-[var(--space-2)]">
        <span
          className="h-1.5 w-1.5"
          style={{ background: "var(--code-dot-red)" }}
          aria-hidden="true"
        />
        <span
          className="h-1.5 w-1.5"
          style={{ background: "var(--code-dot-amber)" }}
          aria-hidden="true"
        />
        <span
          className="h-1.5 w-1.5"
          style={{ background: "var(--code-dot-green)" }}
          aria-hidden="true"
        />
        {showHeaderLabel && headerLabel && (
          <span className="ml-[var(--space-2)] min-w-0 truncate font-mono text-[length:var(--type-meta-size)] uppercase tracking-[var(--tracking-meta)] text-[var(--code-comment)]">
            {headerLabel}
          </span>
        )}
        {copyable && (
          <button
            onClick={handleCopy}
            className="ml-auto flex h-7 min-w-7 shrink-0 cursor-pointer items-center justify-center border border-[var(--border-default)] bg-[var(--surface-raised)] px-2 transition-colors duration-150 hover:bg-[var(--surface-base)]"
            aria-label={copied ? "Copied" : "Copy code"}
          >
            {copied ? (
              <Check size={10} className="text-[var(--status-success)]" />
            ) : (
              <Copy size={10} className="text-[var(--text-primary)]" />
            )}
          </button>
        )}
        <span className="sr-only" aria-live="polite">
          {copied ? "Code copied to clipboard" : ""}
        </span>
      </div>

      {/* Code */}
      <pre
        tabIndex={0}
        aria-label={`${filename || language || "Code sample"} code`}
        className="!m-[var(--space-0)] w-full max-w-full min-w-0 overflow-x-hidden whitespace-pre-wrap break-words bg-[var(--code-bg)] px-[var(--space-3)] py-[var(--space-3)] font-mono text-[length:var(--type-code-size)] leading-[var(--leading-code)] [overflow-wrap:anywhere]"
        style={{ color: "var(--code-text)" }}
      >
        {language === "bash" || language === "shell" || !language
          ? textContent
              .split("\n")
              .map((line, i) => <div key={i}>{highlightBash(line)}</div>)
          : language === "typescript" || language === "javascript"
            ? textContent
                .split("\n")
                .map((line, i) => <div key={i}>{highlightTS(line)}</div>)
            : textContent}
      </pre>
    </div>
  );
}

interface TerminalLineProps {
  prompt?: string;
  command?: string;
  output?: string;
  className?: string;
}

export function TerminalLine({
  prompt = "$",
  command,
  output,
  className,
}: TerminalLineProps) {
  return (
    <div
      className={cn(
        "font-mono text-[length:var(--type-code-size)] leading-[var(--leading-code)]",
        className,
      )}
    >
      {command !== undefined && (
        <div>
          <span style={{ color: "var(--code-prompt)" }}>{prompt} </span>
          <span style={{ color: "var(--code-text)" }}>{command}</span>
        </div>
      )}
      {output !== undefined && (
        <div className="pl-4" style={{ color: "var(--code-output)" }}>
          {output}
        </div>
      )}
    </div>
  );
}
