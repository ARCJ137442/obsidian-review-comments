export type CommentSyntax = "critic" | "hash-anchor" | "shift-anchor";
export type CommentStatus = "open" | "closed";
export type CommentStatusFilter = "all" | CommentStatus;

export const COMMENT_FORMAT = {
  defaultSyntax: "shift-anchor" as CommentSyntax,
  defaultType: "NOTE",
  metadataKeys: {
    id: "id",
    status: "status",
    replyTo: "replyTo",
    legacyReplyTo: "reply-to",
  },
};

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

export interface ParsedCommentEntry {
  metaSource: string;
  meta: ParsedMeta;
  offset: number;
  end: number;
  full: string;
  metaStart: number;
  index: number;
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
  entries: ParsedCommentEntry[];
}

export interface CommentFilters {
  status: CommentStatusFilter;
  type: string;
}

export interface CommentSummary {
  total: number;
  open: number;
  closed: number;
  byType: Record<string, number>;
}

interface AnchorMatch {
  anchor: string;
  syntax: CommentSyntax;
  offset: number;
  anchorStart: number;
  anchorEnd: number;
  closeEnd: number;
}

interface Range {
  start: number;
  end: number;
}

const ANCHOR_REGEX = /\{(?:==([\s\S]+?)==|=#([\s\S]+?)#=|<<([\s\S]*?)>>)\}/g;
const META_OPEN = "{>>";
const META_CLOSE = "<<}";

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
    /^([^|]+)\|([^|]*)\|([^|:]+)((?:\|[^|:]+=[^|:]*)*):\s*([\s\S]*)$/
  );
  if (modern) {
    const attrs = parseAttributes(modern[4]);
    const body = modern[5].trim();
    return {
      author: modern[1].trim(),
      date: modern[2].trim(),
      type: modern[3].trim(),
      body,
      id: attrs[COMMENT_FORMAT.metadataKeys.id] || findBodyId(body),
      status:
        attrs[COMMENT_FORMAT.metadataKeys.status] === "closed"
          ? "closed"
          : "open",
      replyTo:
        attrs[COMMENT_FORMAT.metadataKeys.replyTo] ||
        attrs[COMMENT_FORMAT.metadataKeys.legacyReplyTo],
      attrs,
    };
  }

  const oldFmt = meta.match(/^([^|]+)\|([^|:]+):\s*([\s\S]*)$/);
  if (oldFmt) {
    const body = oldFmt[3].trim();
    return {
      author: oldFmt[1].trim(),
      date: oldFmt[2].trim(),
      type: COMMENT_FORMAT.defaultType,
      body,
      id: findBodyId(body),
      status: "open",
      attrs: {},
    };
  }

  return {
    author: "",
    date: "",
    type: COMMENT_FORMAT.defaultType,
    body: meta,
    id: findBodyId(meta),
    status: "open",
    attrs: {},
  };
}

export function serializeMeta(meta: ParsedMeta): string {
  if (isMinimalDraftMeta(meta)) return meta.body || "";

  const attrs: Record<string, string> = { ...meta.attrs };
  if (meta.id) attrs[COMMENT_FORMAT.metadataKeys.id] = meta.id;
  attrs[COMMENT_FORMAT.metadataKeys.status] = meta.status || "open";
  if (meta.replyTo) attrs[COMMENT_FORMAT.metadataKeys.replyTo] = meta.replyTo;

  const parts = [
    sanitizeMetaPart(meta.author || "you"),
    sanitizeMetaPart(meta.date || ""),
    sanitizeMetaPart(meta.type || COMMENT_FORMAT.defaultType),
  ];

  for (const key of orderedAttributeKeys(attrs)) {
    const value = attrs[key];
    if (!value) continue;
    parts.push(`${sanitizeAttributeKey(key)}=${sanitizeAttributeValue(value)}`);
  }

  return `${parts.join("|")}: ${meta.body || ""}`;
}

export function formatMetaEntry(meta: ParsedMeta): string {
  return `${META_OPEN}${serializeMeta(meta)}${META_CLOSE}`;
}

export function formatComment(
  anchor: string,
  meta: ParsedMeta,
  syntax: CommentSyntax = COMMENT_FORMAT.defaultSyntax
): string {
  const delimiters = getAnchorDelimiters(syntax);
  return `${delimiters.open}${anchor}${delimiters.close}${formatMetaEntry(
    meta
  )}`;
}

export function findComments(text: string): ParsedComment[] {
  if (!containsCommentMarkup(text)) return [];

  const codeRanges = getFencedCodeRanges(text);
  const regex = new RegExp(ANCHOR_REGEX);
  const comments: ParsedComment[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text))) {
    if (isInsideRange(match.index, codeRanges)) continue;

    const anchorMatch = parseAnchorMatch(match);
    const entries = collectMetaEntries(text, anchorMatch.closeEnd, codeRanges);
    if (entries.length === 0) continue;

    const end = entries[entries.length - 1].end;
    const full = text.slice(anchorMatch.offset, end);
    const [firstEntry] = entries;

    comments.push({
      anchor: anchorMatch.anchor,
      metaSource: firstEntry.metaSource,
      meta: firstEntry.meta,
      syntax: anchorMatch.syntax,
      offset: anchorMatch.offset,
      end,
      full,
      anchorStart: anchorMatch.anchorStart,
      anchorEnd: anchorMatch.anchorEnd,
      metaStart: firstEntry.offset,
      entries,
    });

    regex.lastIndex = end;
  }

  return comments;
}

export function summarizeComments(comments: ParsedComment[]): CommentSummary {
  return comments.reduce<CommentSummary>(
    (summary, comment) => {
      summary.total += comment.entries.length;
      for (const entry of comment.entries) {
        if (entry.meta.status === "closed") {
          summary.closed += 1;
        } else {
          summary.open += 1;
        }

        const type = entry.meta.type || COMMENT_FORMAT.defaultType;
        summary.byType[type] = (summary.byType[type] || 0) + 1;
      }
      return summary;
    },
    { total: 0, open: 0, closed: 0, byType: {} }
  );
}

export function filterComments(
  comments: ParsedComment[],
  filters: CommentFilters
): ParsedComment[] {
  return comments
    .map((comment) => ({
      ...comment,
      entries: comment.entries.filter((entry) => {
        const statusMatches =
          filters.status === "all" || entry.meta.status === filters.status;
        const typeMatches =
          filters.type === "all" || entry.meta.type === filters.type;
        return statusMatches && typeMatches;
      }),
    }))
    .filter((comment) => comment.entries.length > 0)
    .map((comment) => ({
      ...comment,
      metaSource: comment.entries[0].metaSource,
      meta: comment.entries[0].meta,
    }));
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
  const entries = getAllThreadEntries(comment);
  return replaceCommentEntries(
    text,
    comment,
    entries.map((entry) => ({
      ...entry.meta,
      status,
    }))
  );
}

export function replaceCommentMeta(
  text: string,
  comment: ParsedComment,
  meta: ParsedMeta
): string {
  assertCommentSlice(text, comment);
  const entries = getAllThreadEntries(comment);
  const metas = entries.map((entry, index) =>
    index === 0 ? meta : entry.meta
  );
  return replaceCommentEntries(text, comment, metas);
}

export function replaceCommentEntryMeta(
  text: string,
  comment: ParsedComment,
  entryIndex: number,
  meta: ParsedMeta
): string {
  assertCommentSlice(text, comment);
  const entries = getAllThreadEntries(comment);
  if (entryIndex < 0 || entryIndex >= entries.length) {
    throw new Error("Comment entry not found; refresh comments before editing.");
  }

  const metas = entries.map((entry, index) =>
    index === entryIndex ? meta : entry.meta
  );
  return replaceCommentEntries(text, comment, metas);
}

export function appendReplyComment(
  text: string,
  comment: ParsedComment,
  reply: ParsedMeta
): string {
  assertCommentSlice(text, comment);
  return (
    text.slice(0, comment.end) + formatMetaEntry(reply) + text.slice(comment.end)
  );
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

function parseAnchorMatch(match: RegExpExecArray): AnchorMatch {
  const syntax =
    match[1] !== undefined
      ? "critic"
      : match[2] !== undefined
        ? "hash-anchor"
        : "shift-anchor";
  const anchor = match[1] ?? match[2] ?? match[3] ?? "";
  const delimiters = getAnchorDelimiters(syntax);
  const anchorStart = match.index + delimiters.open.length;
  const anchorEnd = anchorStart + anchor.length;

  return {
    anchor,
    syntax,
    offset: match.index,
    anchorStart,
    anchorEnd,
    closeEnd: match.index + match[0].length,
  };
}

function collectMetaEntries(
  text: string,
  start: number,
  codeRanges: Range[]
): ParsedCommentEntry[] {
  const entries: ParsedCommentEntry[] = [];
  let cursor = start;

  while (text.startsWith(META_OPEN, cursor)) {
    if (isInsideRange(cursor, codeRanges)) break;
    const metaStart = cursor + META_OPEN.length;
    const close = text.indexOf(META_CLOSE, metaStart);
    if (close === -1) break;

    const end = close + META_CLOSE.length;
    const metaSource = text.slice(metaStart, close);
    entries.push({
      metaSource,
      meta: parseMeta(metaSource),
      offset: cursor,
      end,
      full: text.slice(cursor, end),
      metaStart,
      index: entries.length,
    });
    cursor = end;
  }

  return entries;
}

function replaceCommentEntries(
  text: string,
  comment: ParsedComment,
  metas: ParsedMeta[]
): string {
  const delimiters = getAnchorDelimiters(comment.syntax);
  const next =
    `${delimiters.open}${comment.anchor}${delimiters.close}` +
    metas.map((meta) => formatMetaEntry(meta)).join("");
  return text.slice(0, comment.offset) + next + text.slice(comment.end);
}

function getAllThreadEntries(comment: ParsedComment): ParsedCommentEntry[] {
  const reparsed = findComments(comment.full)[0];
  return reparsed?.entries ?? comment.entries;
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

function isMinimalDraftMeta(meta: ParsedMeta): boolean {
  return (
    !meta.author &&
    !meta.date &&
    !meta.id &&
    !meta.replyTo &&
    meta.type === COMMENT_FORMAT.defaultType &&
    meta.status === "open" &&
    Object.keys(meta.attrs).length === 0
  );
}

function orderedAttributeKeys(attrs: Record<string, string>): string[] {
  const preferred = [
    COMMENT_FORMAT.metadataKeys.id,
    COMMENT_FORMAT.metadataKeys.status,
    COMMENT_FORMAT.metadataKeys.replyTo,
  ];
  const rest = Object.keys(attrs)
    .filter(
      (key) =>
        !preferred.includes(key) &&
        key !== COMMENT_FORMAT.metadataKeys.legacyReplyTo
    )
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
