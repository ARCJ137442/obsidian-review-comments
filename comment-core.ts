export type CommentSyntax =
  | "critic"
  | "hash-anchor"
  | "shift-anchor"
  | "plain-anchor";
export type CommentStatus = "open" | "closed";
export type CommentStatusFilter = "all" | CommentStatus;

export const COMMENT_FORMAT = {
  defaultSyntax: "plain-anchor" as CommentSyntax,
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

export type CommentLintSeverity = "error" | "warning" | "info";

export interface CommentLintIssue {
  code: string;
  severity: CommentLintSeverity;
  message: string;
  offset: number;
  end: number;
  line: number;
  column: number;
  excerpt: string;
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
  if (syntax === "plain-anchor") return { open: "{", close: "}" };
  return { open: "{<<", close: ">>}" };
}

export function parseMeta(meta: string): ParsedMeta {
  const semicolon = parseSemicolonMeta(meta);
  if (semicolon) return semicolon;

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
  delete attrs.author;
  delete attrs.date;
  delete attrs.type;
  if (meta.id) attrs[COMMENT_FORMAT.metadataKeys.id] = meta.id;
  if (meta.status === "closed") {
    attrs[COMMENT_FORMAT.metadataKeys.status] = "closed";
  } else {
    delete attrs[COMMENT_FORMAT.metadataKeys.status];
  }
  if (meta.replyTo) attrs[COMMENT_FORMAT.metadataKeys.replyTo] = meta.replyTo;

  const parts = [`author=${sanitizeAttributeValue(meta.author || "you")}`];
  if (meta.date) parts.push(`date=${sanitizeAttributeValue(meta.date)}`);
  parts.push(`type=${sanitizeAttributeValue(meta.type || COMMENT_FORMAT.defaultType)}`);

  for (const key of orderedAttributeKeys(attrs)) {
    const value = attrs[key];
    if (!value) continue;
    parts.push(`${sanitizeAttributeKey(key)}=${sanitizeAttributeValue(value)}`);
  }

  return `${parts.join(";")}: ${meta.body || ""}`;
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
  const comments: ParsedComment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const anchorMatch = findNextAnchor(text, cursor, codeRanges);
    if (!anchorMatch) break;
    const entries = collectMetaEntries(text, anchorMatch.closeEnd, codeRanges);
    if (entries.length === 0) {
      cursor = anchorMatch.closeEnd;
      continue;
    }

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

    cursor = end;
  }

  return comments;
}

export function lintComments(text: string): CommentLintIssue[] {
  const codeRanges = getFencedCodeRanges(text);
  const comments = findComments(text);
  const issues: CommentLintIssue[] = [];
  const matchedMetaStarts = new Set<number>();
  const matchedMetaCloses = new Set<number>();
  const entriesById = new Map<string, ParsedCommentEntry[]>();

  for (const comment of comments) {
    if (comment.anchor && isHeadingLine(text, comment.offset)) {
      issues.push(
        makeLintIssue(
          text,
          "heading-embedded-comment",
          "warning",
          "标题行里嵌入了范围批注；标题批注应改为标题下方的单点批注，避免干扰 Obsidian 标题索引。",
          comment.offset,
          comment.end
        )
      );
    }

    if (comment.full.includes("\n") && isLineSensitiveRange(text, comment.offset, comment.end)) {
      issues.push(
        makeLintIssue(
          text,
          "multiline-in-line-sensitive-block",
          "warning",
          "批注跨越了列表、表格、引用块或 callout；Agent 回复应尽量保持单行，必要时谨慎维护原 Markdown 前缀。",
          comment.offset,
          comment.end
        )
      );
    }

    for (const entry of comment.entries) {
      matchedMetaStarts.add(entry.offset);
      matchedMetaCloses.add(entry.end - META_CLOSE.length);

      if (entry.meta.id) {
        const bucket = entriesById.get(entry.meta.id) || [];
        bucket.push(entry);
        entriesById.set(entry.meta.id, bucket);
      } else {
        issues.push(
          makeLintIssue(
            text,
            "missing-id",
            "info",
            "批注缺少 id；这对人工草稿是允许的，但会降低 Agent 自动定位、状态更新和迁移的稳定性。",
            entry.offset,
            entry.end
          )
        );
      }

      if (
        entry.meta.replyTo ||
        COMMENT_FORMAT.metadataKeys.replyTo in entry.meta.attrs ||
        COMMENT_FORMAT.metadataKeys.legacyReplyTo in entry.meta.attrs
      ) {
        issues.push(
          makeLintIssue(
            text,
            "legacy-reply-to",
            "warning",
            "发现旧式 replyTo/reply-to；当前批注线程是线性追加，不应在新回复里继续写 replyTo。",
            entry.offset,
            entry.end
          )
        );
      }

      if (entry.metaSource.includes("|") && isTableLine(text, entry.offset)) {
        issues.push(
          makeLintIssue(
            text,
            "pipe-metadata-in-table",
            "warning",
            "表格行里使用了旧式管道元数据；`|` 可能破坏 Markdown 表格，建议改为分号元数据。",
            entry.offset,
            entry.end
          )
        );
      }
    }
  }

  for (const [, entries] of entriesById) {
    if (entries.length <= 1) continue;
    for (const entry of entries) {
      issues.push(
        makeLintIssue(
          text,
          "duplicate-id",
          "error",
          `批注 id 重复：${entry.meta.id}。id 应保持唯一，否则 Agent 无法稳定定位线程。`,
          entry.offset,
          entry.end
        )
      );
    }
  }

  for (const range of codeRanges) {
    const code = text.slice(range.start, range.end);
    if (!containsCommentMarkup(code)) continue;
    issues.push(
      makeLintIssue(
        text,
        "comment-markup-in-code-fence",
        "info",
        "代码块内出现疑似批注标记；插件不会解析 fenced code block 里的批注。",
        range.start,
        range.end
      )
    );
  }

  scanToken(text, META_OPEN, (offset) => {
    if (isInsideRange(offset, codeRanges)) return;
    if (matchedMetaStarts.has(offset)) return;
    issues.push(
      makeLintIssue(
        text,
        "orphan-meta-open",
        "error",
        "发现未能解析的 `{>>`；可能缺少锚点、关闭标记或被其他文本打断。",
        offset,
        offset + META_OPEN.length
      )
    );
  });

  scanToken(text, META_CLOSE, (offset) => {
    if (isInsideRange(offset, codeRanges)) return;
    if (matchedMetaCloses.has(offset)) return;
    issues.push(
      makeLintIssue(
        text,
        "orphan-meta-close",
        "error",
        "发现未能匹配的 `<<}`；可能存在残缺批注或误输入。",
        offset,
        offset + META_CLOSE.length
      )
    );
  });

  scanBareEmptyAnchors(text, codeRanges, (offset, end) => {
    issues.push(
      makeLintIssue(
        text,
        "bare-empty-braces",
        "info",
        "发现裸 `{}` 或连续 `{}`；只有紧跟 `{>>...<<}` 的 `{}{>>...<<}` 才是单点批注。",
        offset,
        end
      )
    );
  });

  return issues.sort((a, b) => a.offset - b.offset || severityRank(a.severity) - severityRank(b.severity));
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

function parseSemicolonMeta(meta: string): ParsedMeta | null {
  const colon = meta.indexOf(":");
  if (colon === -1) return null;

  const head = meta.slice(0, colon);
  if (!/(^|;)\s*[A-Za-z][A-Za-z0-9_-]*\s*=/.test(head)) return null;

  const attrs: Record<string, string> = {};
  for (const part of head.split(";")) {
    if (!part.trim()) continue;
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) attrs[key] = value;
  }

  const body = meta.slice(colon + 1).trim();
  const author = attrs.author || "";
  const date = attrs.date || "";
  const type = attrs.type || COMMENT_FORMAT.defaultType;
  const id = attrs[COMMENT_FORMAT.metadataKeys.id] || findBodyId(body);
  const status =
    attrs[COMMENT_FORMAT.metadataKeys.status] === "closed" ? "closed" : "open";
  const replyTo =
    attrs[COMMENT_FORMAT.metadataKeys.replyTo] ||
    attrs[COMMENT_FORMAT.metadataKeys.legacyReplyTo];

  const rest = { ...attrs };
  delete rest.author;
  delete rest.date;
  delete rest.type;

  return {
    author,
    date,
    type,
    body,
    id,
    status,
    replyTo,
    attrs: rest,
  };
}

function findNextAnchor(
  text: string,
  start: number,
  codeRanges: Range[]
): AnchorMatch | null {
  let cursor = start;

  while (cursor < text.length) {
    const offset = text.indexOf("{", cursor);
    if (offset === -1) return null;

    const range = containingRange(offset, codeRanges);
    if (range) {
      cursor = range.end;
      continue;
    }

    const legacy = parseLegacyAnchorAt(text, offset);
    if (legacy) return legacy;

    const plain = parsePlainAnchorAt(text, offset);
    if (plain) return plain;

    cursor = offset + 1;
  }

  return null;
}

function parseLegacyAnchorAt(text: string, offset: number): AnchorMatch | null {
  const variants: { syntax: CommentSyntax; open: string; close: string }[] = [
    { syntax: "critic", open: "{==", close: "==}" },
    { syntax: "hash-anchor", open: "{=#", close: "#=}" },
    { syntax: "shift-anchor", open: "{<<", close: ">>}" },
  ];

  for (const variant of variants) {
    if (!text.startsWith(variant.open, offset)) continue;
    const anchorStart = offset + variant.open.length;
    const close = text.indexOf(variant.close, anchorStart);
    if (close === -1) return null;
    return {
      anchor: text.slice(anchorStart, close),
      syntax: variant.syntax,
      offset,
      anchorStart,
      anchorEnd: close,
      closeEnd: close + variant.close.length,
    };
  }

  return null;
}

function parsePlainAnchorAt(text: string, offset: number): AnchorMatch | null {
  if (text.startsWith(META_OPEN, offset)) return null;
  const anchorStart = offset + 1;
  const close = text.indexOf("}", anchorStart);
  if (close === -1) return null;
  const closeEnd = close + 1;
  if (!text.startsWith(META_OPEN, closeEnd)) return null;

  return {
    anchor: text.slice(anchorStart, close),
    syntax: "plain-anchor",
    offset,
    anchorStart,
    anchorEnd: close,
    closeEnd,
  };
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
  return value.replace(/[|:<>;{}]/g, "_").trim();
}

function sanitizeAttributeKey(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

function sanitizeAttributeValue(value: string): string {
  return value.replace(/[|:<>;{}]/g, "_").trim();
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

function containingRange(offset: number, ranges: Range[]): Range | undefined {
  return ranges.find((range) => offset >= range.start && offset < range.end);
}

function makeLintIssue(
  text: string,
  code: string,
  severity: CommentLintSeverity,
  message: string,
  offset: number,
  end: number
): CommentLintIssue {
  const position = offsetToLineColumn(text, offset);
  return {
    code,
    severity,
    message,
    offset,
    end,
    line: position.line,
    column: position.column,
    excerpt: getLineAtOffset(text, offset).trim(),
  };
}

function severityRank(severity: CommentLintSeverity): number {
  if (severity === "error") return 0;
  if (severity === "warning") return 1;
  return 2;
}

function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

function getLineAtOffset(text: string, offset: number): string {
  const start = text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const end = text.indexOf("\n", offset);
  return text.slice(start, end === -1 ? text.length : end);
}

function isHeadingLine(text: string, offset: number): boolean {
  return /^\s{0,3}#{1,6}\s+/.test(getLineAtOffset(text, offset));
}

function isTableLine(text: string, offset: number): boolean {
  const line = getLineAtOffset(text, offset).trim();
  return line.startsWith("|") || line.endsWith("|") || /\s\|\s/.test(line);
}

function isLineSensitiveRange(text: string, start: number, end: number): boolean {
  let lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  while (lineStart <= end) {
    const lineEndRaw = text.indexOf("\n", lineStart);
    const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;
    const line = text.slice(lineStart, lineEnd);
    if (isLineSensitiveLine(line)) return true;
    if (lineEndRaw === -1) break;
    lineStart = lineEndRaw + 1;
  }
  return false;
}

function isLineSensitiveLine(line: string): boolean {
  return (
    /^\s{0,3}(?:[-+*]|\d+[.)])\s+/.test(line) ||
    /^\s{0,3}>\s?/.test(line) ||
    /^\s{0,3}>\s?\[!/.test(line) ||
    line.trim().includes("|")
  );
}

function scanToken(
  text: string,
  token: string,
  onMatch: (offset: number) => void
): void {
  let cursor = 0;
  while (cursor < text.length) {
    const offset = text.indexOf(token, cursor);
    if (offset === -1) return;
    onMatch(offset);
    cursor = offset + token.length;
  }
}

function scanBareEmptyAnchors(
  text: string,
  codeRanges: Range[],
  onMatch: (offset: number, end: number) => void
): void {
  const pattern = /(?:\{\})+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const offset = match.index;
    const end = offset + match[0].length;
    if (isInsideRange(offset, codeRanges)) continue;
    if (text.startsWith(META_OPEN, end)) continue;
    onMatch(offset, end);
  }
}
