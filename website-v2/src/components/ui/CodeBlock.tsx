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

type CodeLanguage =
  | "bash"
  | "cli"
  | "shell"
  | "sh"
  | "zsh"
  | "typescript"
  | "ts"
  | "javascript"
  | "js"
  | "json"
  | "yaml"
  | "yml"
  | "text";

function normalizeLanguage(language?: string): CodeLanguage {
  const normalized = language?.toLowerCase();
  if (
    normalized === "cli" ||
    normalized === "shell" ||
    normalized === "sh" ||
    normalized === "zsh" ||
    normalized === "bash"
  ) {
    return normalized;
  }
  if (
    normalized === "typescript" ||
    normalized === "ts" ||
    normalized === "javascript" ||
    normalized === "js" ||
    normalized === "json" ||
    normalized === "yaml" ||
    normalized === "yml" ||
    normalized === "text"
  ) {
    return normalized;
  }
  return language ? "text" : "bash";
}

function splitInlineComment(line: string): [string, string] {
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return [line.slice(0, i), line.slice(i)];
    }
  }

  return [line, ""];
}

function findYamlKeySeparator(text: string): number {
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ":" && (!text[i + 1] || /\s/.test(text[i + 1]))) {
      return i;
    }
  }

  return -1;
}

function highlightScalar(text: string): React.ReactNode {
  if (!text) return null;

  const parts: React.ReactNode[] = [];
  const scalarRegex =
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(true|false|null|yes|no|on|off)\b|(-?\b\d+(?:\.\d+)?\b)|(\[[^\]]*\])|([\w.*-]+:[\w.*:-]+)/gi;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = scalarRegex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const [full, str, boolish, number, inlineList, identity] = match;
    const color = str
      ? "var(--code-string)"
      : boolish || number || inlineList
        ? "var(--code-flag)"
        : identity
          ? "var(--code-channel-topic)"
          : "var(--code-text)";

    parts.push(
      <span key={match.index} style={{ color, fontWeight: boolish ? 600 : undefined }}>
        {full}
      </span>,
    );
    last = match.index + full.length;
  }

  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function highlightYaml(line: string): React.ReactNode {
  if (!line.trim()) return "\u00A0";

  const [content, comment] = splitInlineComment(line);
  if (!content.trim()) {
    return <span style={{ color: "var(--code-comment)" }}>{line}</span>;
  }

  const trimmedStart = content.trimStart();
  if (trimmedStart.startsWith("---") || trimmedStart.startsWith("...")) {
    return (
      <>
        <span style={{ color: "var(--code-comment)" }}>{content}</span>
        {comment ? <span style={{ color: "var(--code-comment)" }}>{comment}</span> : null}
      </>
    );
  }

  const leading = content.match(/^(\s*)/)?.[1] ?? "";
  const afterIndent = content.slice(leading.length);
  const listMatch = afterIndent.match(/^(-\s+)(.*)$/);
  const listMarker = listMatch?.[1] ?? "";
  const body = listMatch?.[2] ?? afterIndent;
  const separatorIndex = findYamlKeySeparator(body);
  const rendered: React.ReactNode[] = [leading];

  if (listMarker) {
    rendered.push(
      <span key="list" style={{ color: "var(--code-prompt)", fontWeight: 600 }}>
        {listMarker}
      </span>,
    );
  }

  if (separatorIndex >= 0) {
    const key = body.slice(0, separatorIndex);
    const separatorMatch = body.slice(separatorIndex).match(/^(:\s*)/)?.[1] ?? ":";
    const value = body.slice(separatorIndex + separatorMatch.length);
    rendered.push(
      <span key="key" style={{ color: "var(--code-command)", fontWeight: 700 }}>
        {key}
      </span>,
      <span key="colon" style={{ color: "var(--code-channel-sep)" }}>
        {separatorMatch}
      </span>,
      <React.Fragment key="value">{highlightScalar(value)}</React.Fragment>,
    );
  } else {
    rendered.push(<React.Fragment key="scalar">{highlightScalar(body)}</React.Fragment>);
  }

  if (comment) {
    rendered.push(
      <span key="comment" style={{ color: "var(--code-comment)" }}>
        {comment}
      </span>,
    );
  }

  return <>{rendered}</>;
}

function highlightJson(line: string): React.ReactNode {
  if (!line.trim()) return "\u00A0";

  const parts: React.ReactNode[] = [];
  const jsonRegex =
    /("(?:[^"\\]|\\.)*")|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|\b(true|false|null)\b|([\][{}:,])/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = jsonRegex.exec(line)) !== null) {
    if (match.index > last) parts.push(line.slice(last, match.index));

    const [full, str, number, literal, punctuation] = match;
    const isKey = Boolean(str && line.slice(match.index + full.length).trimStart().startsWith(":"));
    const color = isKey
      ? "var(--code-command)"
      : str
        ? "var(--code-string)"
        : number || literal
          ? "var(--code-flag)"
          : punctuation
            ? "var(--code-channel-sep)"
            : "var(--code-text)";

    parts.push(
      <span key={match.index} style={{ color, fontWeight: isKey || literal ? 600 : undefined }}>
        {full}
      </span>,
    );
    last = match.index + full.length;
  }

  if (last < line.length) parts.push(line.slice(last));
  return <>{parts}</>;
}

function highlightCodeLine(line: string, language?: string): React.ReactNode {
  const normalized = normalizeLanguage(language);

  if (normalized === "bash" || normalized === "cli" || normalized === "shell" || normalized === "sh" || normalized === "zsh") {
    return highlightBash(line);
  }
  if (
    normalized === "typescript" ||
    normalized === "ts" ||
    normalized === "javascript" ||
    normalized === "js"
  ) {
    return highlightTS(line);
  }
  if (normalized === "yaml" || normalized === "yml") return highlightYaml(line);
  if (normalized === "json") return highlightJson(line);
  if (!line.trim()) return "\u00A0";
  return line;
}

/* ── Component ───────────────────────────────────────────────────────────── */

interface CodeBlockProps {
  children?: React.ReactNode;
  code?: string;
  output?: string;
  language?: string;
  filename?: string;
  className?: string;
  copyable?: boolean;
  showHeaderLabel?: boolean;
}

export function CodeBlock({
  children,
  code,
  output,
  language,
  filename,
  className,
  copyable = true,
  showHeaderLabel = true,
}: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false);
  const headerLabel = filename || language;

  // Extract text content from children, handling JSX whitespace nodes.
  const sourceText =
    code ??
    React.Children.toArray(children)
      .map((c) => (typeof c === "string" ? c : ""))
      .join("");
  const textContent = [sourceText, output].filter(Boolean).join("\n").trim();

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
        {textContent
          .split("\n")
          .map((line, i) => (
            <div key={i} className="min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
              {highlightCodeLine(line, language)}
            </div>
          ))}
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
