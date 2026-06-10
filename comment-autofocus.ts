export type CommentAutoFocusMode = "off" | "left" | "right";
export type CommentAutoFocusTrigger = Exclude<CommentAutoFocusMode, "off">;

export const COMMENT_THREAD_DATA_ATTR = "reviewThreadKey";
export const COMMENT_RENDER_SELECTOR = [
  ".review-comment-highlight",
  ".review-comment-point",
  ".review-comment-highlight-live",
  ".review-comment-point-live",
].join(", ");

export function normalizeCommentAutoFocusMode(
  value: string | null | undefined
): CommentAutoFocusMode {
  return value === "left" || value === "right" ? value : "off";
}

export function shouldAutoFocusCommentThread(
  mode: CommentAutoFocusMode,
  trigger: CommentAutoFocusTrigger
): boolean {
  return mode === trigger;
}

export function resolveAutoFocusCommentThreadKey(
  mode: CommentAutoFocusMode,
  trigger: CommentAutoFocusTrigger,
  target: EventTarget | null
): string | null {
  if (!shouldAutoFocusCommentThread(mode, trigger)) {
    return null;
  }
  return getCommentThreadKeyFromTarget(target);
}

export function getCommentThreadKeyFromTarget(
  target: EventTarget | null
): string | null {
  const element = toElement(target);
  if (!element) return null;
  return (
    element.closest<HTMLElement>(COMMENT_RENDER_SELECTOR)?.dataset[
      COMMENT_THREAD_DATA_ATTR
    ] || null
  );
}

function toElement(target: EventTarget | null): Element | null {
  if (isElementLike(target)) return target;
  if (isNodeLike(target)) return target.parentElement;
  return null;
}

function isElementLike(target: EventTarget | null): target is Element {
  return Boolean(target && typeof (target as Element).closest === "function");
}

function isNodeLike(target: EventTarget | null): target is Node {
  return Boolean(target && typeof (target as Node).nodeType === "number");
}
