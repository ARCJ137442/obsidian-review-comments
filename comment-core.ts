export type CommentSyntax = "critic" | "hash-anchor" | "shift-anchor";
export type CommentStatus = "open" | "closed";

export interface ParsedMeta {
  author: string;
  date: string;
  type: string;
  body: string;
  id?: string;
  status: CommentStatus;
  replyTo?: string;
  attrs: Record<string, string>;
}

export interface ParsedComment {
  anchor: string;
  metaSource: string;
  meta: ParsedMeta;
  syntax: CommentSyntax;
  offset: number;
  end: number;
  full: string;
  anchorStart: number;
  anchorEnd: number;
  metaStart: number;
}

interface ParsedCommentMatch {
  anchor: string;
  metaSource: string;
  syntax: CommentSyntax;
}

interface Range {
  start: number;
  end: number;
}

export const COMMENT_REGEX =
  /\{(?:==([\s\S]+?)==|=#([\s\S]+?)#=|<<([\s\S]+?)>>)\}\{>>([\s\S]+?)<<\}/g;

export function containsCommentMarkup(text: string): boolean {
  return (
    text.includes("{==") ||
    text.includes("==}") ||
    text.includes("{=#") ||
    text.includes("#=}") ||
    text.includes("{<<") ||
    text.includes(">>}") ||
    text.includes("{>>") ||
    text.includes("<<}")
  );
}

export function getAnchorDelimiters(
  syntax: CommentSyntax
): { open: string; close: string } {
  if (syntax === "critic") return { open: "{==", close: "==}" };
  if (syntax === "hash-anchor") return { open: "{=#", close: "#=}" };
  return { open: "{<<", close: ">>}" };
}

export function parseMeta(meta: string): ParsedMeta {
  const modern = meta.match(
    /^([^|]+)\|([^|]+)\|([^|:]+)((?:\|[^|:]+=[^|:]*)*):\s*([\s\S]*)$/
  );
  if (modern) {
    const attrs = parseAttributes(modern[4]);
    const body = modern[5].trim();
    return {
      author: modern[1].trim(),
      date: modern[2].trim(),
      type: modern[3].trim(),
      body,
      id: attrs.id || findBodyId(body),
      status: attrs.status === "closed" ? "closed" : "open",
      replyTo: attrs.replyTo || attrs["reply-to"],
      attrs,
    };
  }

  const oldFmt = meta.match(/^([^|]+)\|([^|:]+):\s*([\s\S]*)$/);
  if (oldFmt) {
    const body = oldFmt[3].trim();
    return {
      author: oldFmt[1].trim(),
      date: oldFmt[2].trim(),
      type: "NOTE",
      body,
      id: findBodyId(body),
      status: "open",
      attrs: {},
    };
  }

  return {
    author: "",
    date: "",
    type: "NOTE",
    body: meta,
    id: findBodyId(meta),
    status: "open",
    attrs: {},
  };
}

export function serializeMeta(meta: ParsedMeta): string {
  const attrs: Record<string, string> = { ...meta.attrs };
  if (meta.id) attrs.id = meta.id;
  attrs.status = meta.status || "open";
  if (meta.replyTo) attrs.replyTo = meta.replyTo;

  const parts = [
    sanitizeMetaPart(meta.author || "you"),
    sanitizeMetaPart(meta.date || ""),
    sanitizeMetaPart(meta.type || "NOTE"),
  ];

  for (const key of orderedAttributeKeys(attrs)) {
    const value = attrs[key];
    if (!value) continue;
    parts.push(`${sanitizeAttributeKey(key)}=${sanitizeAttributeValue(value)}`);
  }

  return `${parts.join("|")}: ${meta.body || ""}`;
}

export function formatComment(
  anchor: string,
  meta: ParsedMeta,
  syntax: CommentSyntax = "shift-anchor"
): string {
  const delimiters = getAnchorDelimiters(syntax);
  return `${delimiters.open}${anchor}${delimiters.close}{>>${serializeMeta(
    meta
  )}<<}`;
}

export function findComments(text: string): ParsedComment[] {
  if (!containsCommentMarkup(text)) return [];

  const codeRanges = getFencedCodeRanges(text);
  const regex = new RegExp(COMMENT_REGEX);
  const comments: ParsedComment[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text))) {
    if (isInsideRange(match.index, codeRanges)) continue;

    const parsed = parseCommentMatch(match);
    const delimiters = getAnchorDelimiters(parsed.syntax);
    const anchorStart = match.index + delimiters.open.length;
    const anchorEnd = anchorStart + parsed.anchor.length;
    const metaStart = anchorEnd + delimiters.close.length;
    const end = match.index + match[0].length;

    comments.push({
      anchor: parsed.anchor,
      metaSource: parsed.metaSource,
      meta: parseMeta(parsed.metaSource),
      syntax: parsed.syntax,
      offset: match.index,
      end,
      full: match[0],
      anchorStart,
      anchorEnd,
      metaStart,
    });
  }

  return comments;
}

export function replaceCommentStatus(
  text: string,
  comment: ParsedComment,
  status: CommentStatus
): string {
  return replaceCommentMeta(text, comment, {
    ...comment.meta,
    status,
  });
}

export function replaceCommentThreadStatus(
  text: string,
  comment: ParsedComment,
  status: CommentStatus
): string {
  assertCommentSlice(text, comment);

  const comments = findComments(text);
  const targetIds = new Set<string>();
  if (comment.meta.id) targetIds.add(comment.meta.id);

  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of comments) {
      if (
        candidate.meta.replyTo &&
        targetIds.has(candidate.meta.replyTo) &&
        candidate.meta.id &&
        !targetIds.has(candidate.meta.id)
      ) {
        targetIds.add(candidate.meta.id);
        changed = true;
      }
    }
  }

  const affected = comments.filter((candidate) => {
    if (candidate.offset === comment.offset && candidate.full === comment.full) {
      return true;
    }
    return Boolean(candidate.meta.id && targetIds.has(candidate.meta.id));
  });

  return affected
    .sort((a, b) => b.offset - a.offset)
    .reduce((next, candidate) => {
      assertCommentSlice(next, candidate);
      const replacement = formatComment(
        candidate.anchor,
        { ...candidate.meta, status },
        candidate.syntax
      );
      return next.slice(0, candidate.offset) + replacement + next.slice(candidate.end);
    }, text);
}

export function replaceCommentMeta(
  text: string,
  comment: ParsedComment,
  meta: ParsedMeta
): string {
  assertCommentSlice(text, comment);
  const next = formatComment(comment.anchor, meta, comment.syntax);
  return text.slice(0, comment.offset) + next + text.slice(comment.end);
}

export function appendReplyComment(
  text: string,
  comment: ParsedComment,
  reply: ParsedMeta
): string {
  assertCommentSlice(text, comment);
  const replyMarkup = formatComment(comment.anchor, reply, "shift-anchor");
  return text.slice(0, comment.end) + " " + replyMarkup + text.slice(comment.end);
}

export function removeComment(text: string, comment: ParsedComment): string {
  assertCommentSlice(text, comment);
  return text.slice(0, comment.offset) + comment.anchor + text.slice(comment.end);
}

export function generateCommentId(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RC-${y}${m}${d}-${hh}${mm}${ss}-${suffix}`;
}

function parseCommentMatch(match: RegExpExecArray): ParsedCommentMatch {
  const syntax =
    match[1] !== undefined
      ? "critic"
      : match[2] !== undefined
        ? "hash-anchor"
        : "shift-anchor";

  return {
    anchor: match[1] ?? match[2] ?? match[3] ?? "",
    metaSource: match[4] ?? "",
    syntax,
  };
}

function parseAttributes(attrsSource: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const part of attrsSource.split("|")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) attrs[key] = value;
  }
  return attrs;
}

function orderedAttributeKeys(attrs: Record<string, string>): string[] {
  const preferred = ["id", "status", "replyTo"];
  const rest = Object.keys(attrs)
    .filter((key) => !preferred.includes(key) && key !== "reply-to")
    .sort();
  return [...preferred, ...rest].filter((key) => key in attrs);
}

function sanitizeMetaPart(value: string): string {
  return value.replace(/[|:<>]/g, "_").trim();
}

function sanitizeAttributeKey(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

function sanitizeAttributeValue(value: string): string {
  return value.replace(/[|:<>]/g, "_").trim();
}

function findBodyId(body: string): string | undefined {
  const match = body.match(/\[(RC-[A-Za-z0-9_-]+)\]/);
  return match?.[1];
}

function assertCommentSlice(text: string, comment: ParsedComment): void {
  if (text.slice(comment.offset, comment.end) !== comment.full) {
    throw new Error("Comment source changed; refresh comments before editing.");
  }
}

function getFencedCodeRanges(text: string): Range[] {
  const ranges: Range[] = [];
  let inFence = false;
  let fenceStart = 0;
  let fenceMarker = "";
  let lineStart = 0;

  while (lineStart <= text.length) {
    const lineEndRaw = text.indexOf("\n", lineStart);
    const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw + 1;
    const line = text.slice(lineStart, lineEnd);
    const fence = line.match(/^\s*(```+|~~~+)/);

    if (fence && !inFence) {
      inFence = true;
      fenceStart = lineStart;
      fenceMarker = fence[1][0];
    } else if (fence && inFence && fence[1][0] === fenceMarker) {
      ranges.push({ start: fenceStart, end: lineEnd });
      inFence = false;
      fenceMarker = "";
    }

    if (lineEndRaw === -1) break;
    lineStart = lineEnd;
  }

  if (inFence) ranges.push({ start: fenceStart, end: text.length });
  return ranges;
}

function isInsideRange(offset: number, ranges: Range[]): boolean {
  return ranges.some((range) => offset >= range.start && offset < range.end);
}
