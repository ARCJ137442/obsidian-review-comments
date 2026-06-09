import { COMMENT_FORMAT } from "./comment-core";

export interface ReviewCommentType {
  id: string;
  tag: string;
  label: string;
  icon: string;
  color: string;
  protected?: boolean;
}

export const DEFAULT_COMMENT_TYPES: ReviewCommentType[] = [
  {
    id: "comment",
    tag: "COMMENT",
    label: "批注",
    icon: "💬",
    color: "#e6be28",
    protected: true,
  },
  { id: "ask", tag: "ASK", label: "提问", icon: "❓", color: "#4a90e2" },
  { id: "edit", tag: "EDIT", label: "修改", icon: "✏️", color: "#f5a623" },
  {
    id: "praise",
    tag: "PRAISE",
    label: "称赞",
    icon: "👍",
    color: "#7ed321",
  },
  { id: "note", tag: "NOTE", label: "备注", icon: "💬", color: "#9b78dc" },
];

const DEFAULT_COMMENT_TYPE =
  DEFAULT_COMMENT_TYPES.find((type) => type.tag === COMMENT_FORMAT.defaultType) ||
  DEFAULT_COMMENT_TYPES[0];

export function normalizeCommentTypes(
  rawTypes: Partial<ReviewCommentType>[] | null | undefined
): ReviewCommentType[] {
  const source =
    Array.isArray(rawTypes) && rawTypes.length > 0
      ? rawTypes
      : DEFAULT_COMMENT_TYPES;
  const defaultsByTag = new Map(
    DEFAULT_COMMENT_TYPES.map((type) => [type.tag, type])
  );
  const usedTags = new Set<string>();
  const usedIds = new Set<string>();
  const normalized: ReviewCommentType[] = [];

  const addType = (
    raw: Partial<ReviewCommentType>,
    fallback: ReviewCommentType
  ) => {
    const tag = sanitizeCommentTypeTag(raw.tag, fallback.tag);
    if (usedTags.has(tag)) return;

    const defaultForTag = defaultsByTag.get(tag) || fallback;
    const id = uniqueCommentTypeId(
      sanitizeCommentTypeId(raw.id, defaultForTag.id),
      usedIds
    );
    const type: ReviewCommentType = {
      id,
      tag,
      label: sanitizeCommentTypeLabel(raw.label, defaultForTag.label),
      icon: sanitizeCommentTypeIcon(raw.icon, defaultForTag.icon),
      color: normalizeHexColor(raw.color, defaultForTag.color),
      protected: tag === COMMENT_FORMAT.defaultType,
    };

    usedTags.add(tag);
    usedIds.add(id);
    normalized.push(type);
  };

  for (const raw of source) {
    const fallback =
      defaultsByTag.get(sanitizeCommentTypeTag(raw.tag, "")) ||
      DEFAULT_COMMENT_TYPE;
    addType(raw, fallback);
  }

  if (!usedTags.has(COMMENT_FORMAT.defaultType)) {
    addType(DEFAULT_COMMENT_TYPE, DEFAULT_COMMENT_TYPE);
  }

  return normalized.sort((a, b) => {
    if (a.tag === COMMENT_FORMAT.defaultType) return -1;
    if (b.tag === COMMENT_FORMAT.defaultType) return 1;
    return 0;
  });
}

export function getReviewCommentType(
  types: ReviewCommentType[],
  tag: string | null | undefined
): ReviewCommentType {
  const normalizedTag = sanitizeCommentTypeTag(
    tag,
    COMMENT_FORMAT.defaultType
  );
  return (
    types.find((type) => type.tag === normalizedTag) || {
      ...DEFAULT_COMMENT_TYPE,
      tag: normalizedTag,
      label: normalizedTag,
      protected: false,
    }
  );
}

export function getCommentTypeColorTriplet(
  types: ReviewCommentType[],
  tag: string | null | undefined
): string {
  return hexToRgbTriplet(getReviewCommentType(types, tag).color);
}

export function sanitizeCommentTypeId(
  id: string | null | undefined,
  fallback = "comment"
): string {
  const source = String(id || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return source || fallback;
}

export function sanitizeCommentTypeTag(
  tag: string | null | undefined,
  fallback = COMMENT_FORMAT.defaultType
): string {
  const source = String(tag || fallback)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return source || fallback;
}

export function sanitizeCommentTypeLabel(
  label: string | null | undefined,
  fallback = "批注"
): string {
  const value = String(label || "").trim();
  return value || fallback;
}

export function sanitizeCommentTypeIcon(
  icon: string | null | undefined,
  fallback = "💬"
): string {
  const value = String(icon || "").trim();
  return value || fallback;
}

export function normalizeHexColor(
  color: string | null | undefined,
  fallback = "#e6be28"
): string {
  const value = String(color || "").trim();
  const match = value.match(/^#?([0-9a-f]{6})$/i);
  if (!match) return fallback;
  return `#${match[1].toLowerCase()}`;
}

export function hexToRgbTriplet(color: string): string {
  const normalized = normalizeHexColor(color);
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

function uniqueCommentTypeId(id: string, usedIds: Set<string>): string {
  if (!usedIds.has(id)) return id;
  let index = 2;
  while (usedIds.has(`${id}-${index}`)) index += 1;
  return `${id}-${index}`;
}
